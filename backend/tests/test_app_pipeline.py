"""Pipeline run orchestration + the comparison-notes snapshot-merge.

Hard requirement under test (comparison-output-table.md §5, 01-data-model §6.3):
a note on a row whose gap persists survives every pipeline run of any kind;
if the merge fails in ANY way, every note is kept (fail safe — never
regenerate-and-drop). run_pipeline is stubbed via the
app.pipeline_runner.run_pipeline_impl seam (synthetic joined CSVs).
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

from app import pipeline_data as pd_mod
from app import pipeline_runner

from test_app_helpers import (
    app_client,
    configure_collection,
    joined_row,
    wait_pipeline,
    write_collection_playlists,
    write_csv,
    write_exportify_csv,
    write_joined,
    write_matrix,
)

SLUG = "disco_cosmic"
DISPLAY = "Disco Cosmic"
PLAYLIST_PATH = "$ROOT/Disco Cosmic"


def _db_notes(data_dir: Path) -> set[tuple]:
    conn = sqlite3.connect(str(data_dir / "setmaster3.db"))
    try:
        return set(
            conn.execute("SELECT slug, side, join_key, text FROM comparison_notes")
        )
    finally:
        conn.close()


def _db_config_paths(data_dir: Path) -> set[str]:
    conn = sqlite3.connect(str(data_dir / "setmaster3.db"))
    try:
        return {r[0] for r in conn.execute("SELECT playlist_path FROM comparison_config")}
    finally:
        conn.close()


def _setup(c, tmp_path, downloads):
    """Configure collection + import one Exportify CSV (auto-adds to config)."""
    configure_collection(c, tmp_path)
    c.put("/api/settings", json={"super_playlist_folder": "$ROOT",
                                 "exclude_prefixes": ["zz_"]})
    write_collection_playlists(c.sm3_data_dir / "pipeline-work", [
        (PLAYLIST_PATH, DISPLAY, "$ROOT"),
    ])
    f = write_exportify_csv(downloads / f"{SLUG}.csv")
    r = c.post("/api/exportify/import", json={"paths": [str(f)]})
    assert r.json()["imported"][0]["added_to_config"] is True


def _put_note(c, slug, side, join_key, text):
    r = c.put("/api/comparison/notes",
              json={"slug": slug, "side": side, "join_key": join_key, "text": text})
    assert r.status_code == 200


@pytest.fixture
def downloads(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "Downloads"
    d.mkdir()
    monkeypatch.setenv("SM3_DOWNLOADS_DIR", str(d))
    return d


def _stub_writing(joined_rows_by_slug: dict[str, list], playlists=None,
                  tracks_rows: int = 2, captured: dict | None = None):
    """Build a run_pipeline stub that writes synthetic pipeline outputs."""

    def stub(nml_path, exportify_dir, work_dir, root_folder_name,
             playlists_to_sync, exclude_prefixes, progress=None):
        if captured is not None:
            captured.update(
                nml_path=Path(nml_path), exportify_dir=Path(exportify_dir),
                work_dir=Path(work_dir), root_folder_name=root_folder_name,
                playlists_to_sync=list(playlists_to_sync),
                exclude_prefixes=list(exclude_prefixes),
            )
        work_dir = Path(work_dir)
        if progress:
            progress("stage1_load", "Reading Traktor collection…")
        write_collection_playlists(
            work_dir, playlists or [(PLAYLIST_PATH, DISPLAY, "$ROOT")]
        )
        write_csv(
            work_dir / "Traktor" / "traktor_collection_tracks.csv",
            ["track_key", "title"],
            [[f"K:/:t{i}.mp3", f"T{i}"] for i in range(tracks_rows)],
        )
        if progress:
            progress("stage2_playlists", "Building matrix…")
        write_matrix(work_dir, [DISPLAY], [
            {"track_key": "K:/:t0.mp3", "name": "T0", "artist": "A",
             "member_of": [DISPLAY]},
        ])
        if progress:
            progress("stage4_join", "Joining…")
        for slug, rows in joined_rows_by_slug.items():
            write_joined(work_dir, slug, rows)
        return SimpleNamespace(ok=True, stages=[], error=None)

    return stub


def test_run_preflight_errors(tmp_path):
    with app_client(tmp_path) as c:
        # no collection configured
        assert c.post("/api/pipeline/run").status_code == 400
        # configured but the file is missing
        c.put("/api/settings",
              json={"collection_nml_path": str(tmp_path / "nope" / "collection.nml")})
        assert c.post("/api/pipeline/run").status_code == 400


def test_happy_path_notes_merge_gap_counts_and_status(tmp_path, downloads, monkeypatch):
    with app_client(tmp_path) as c:
        _setup(c, tmp_path, downloads)

        # notes before the run:
        _put_note(c, SLUG, "traktor", "beta", "go buy beta")        # gap persists
        _put_note(c, SLUG, "traktor", "gamma", "organize gamma")    # gap resolves
        _put_note(c, SLUG, "traktor", "zeta", "row disappears")     # row gone
        _put_note(c, SLUG, "spotify", "delta", "traktor only fyi")  # gap persists
        _put_note(c, "other_playlist", "traktor", "omega", "untouched")  # not re-run

        new_rows = [
            joined_row("Not-Trak-Collection", spotify_join="beta", spotify_name="Beta"),
            joined_row("Yes-Trak-Playlist", spotify_join="gamma", trak_join="gamma",
                       spotify_name="Gamma", traktor_title="Gamma"),
            joined_row("Not-Spotify / Yes-Trak-Playlist", trak_join="delta",
                       traktor_title="Delta"),
            joined_row("Not-Trak-Playlist / Yes-Trak-Collection", spotify_join="eps",
                       spotify_name="Epsilon", file_path="C:\\m\\e.mp3"),
        ]
        captured: dict = {}
        monkeypatch.setattr(
            pipeline_runner, "run_pipeline_impl",
            _stub_writing({SLUG: new_rows}, captured=captured),
        )

        r = c.post("/api/pipeline/run")
        assert r.status_code == 202
        assert r.json()["run_id"]

        st = wait_pipeline(c)
        assert st["state"] == "completed", st
        assert st["started_at"] and st["finished_at"]
        assert st["error"] is None

        # settings-derived args reached run_pipeline
        assert captured["work_dir"] == c.sm3_data_dir / "pipeline-work"
        assert captured["exportify_dir"] == c.sm3_data_dir / "raw-data" / "exportify"
        assert captured["root_folder_name"] == "$ROOT"
        assert captured["playlists_to_sync"] == [DISPLAY]  # display names of checked
        assert captured["exclude_prefixes"] == ["zz_"]
        assert captured["nml_path"].name == "collection.nml"

        # stage progress surfaced (snapshot + callback stages + merge + finalize)
        stage_ids = [s["stage"] for s in st["stages"]]
        assert stage_ids[0] == "snapshot"
        assert "stage1_load" in stage_ids and "stage2_playlists" in stage_ids
        assert stage_ids[-2:] == ["notes_merge", "finalize"]
        assert all(s["state"] == "completed" for s in st["stages"])
        assert all(s["label"] for s in st["stages"])

        # notes summary: beta + delta + other_playlist survive; gamma + zeta drop
        assert st["notes_summary"] == {"restored": 3, "dropped": 2}

        # per-playlist gap counts
        assert st["gap_counts"] == [
            {"slug": SLUG, "display_name": DISPLAY, "go_get": 1, "organize": 1}
        ]

        # surviving notes, exactly
        assert _db_notes(c.sm3_data_dir) == {
            (SLUG, "traktor", "beta", "go buy beta"),
            (SLUG, "spotify", "delta", "traktor only fyi"),
            ("other_playlist", "traktor", "omega", "untouched"),
        }

        # notes reappear in the right cells of the results view
        rows = c.get(f"/api/comparison/results/{SLUG}").json()["rows"]
        notes = {r["flag"]: r["note"] for r in rows}
        assert notes["Not-Trak-Collection"] == {"text": "go buy beta", "side": "traktor"}
        assert notes["Not-Spotify / Yes-Trak-Playlist"] == \
            {"text": "traktor only fyi", "side": "spotify"}
        assert notes["Yes-Trak-Playlist"] is None

        # collection meta refreshed (2 tracks in the synthetic tracks CSV)
        col = c.get("/api/status").json()["collection"]
        assert col["last_read_iso"] is not None
        assert col["track_count"] == 2

        # matrix cache refreshed from the new run
        m = c.get("/api/matrix").json()
        assert [p["name"] for p in m["playlists"]] == [DISPLAY]
        assert m["playlists"][0]["is_root"] is True
        assert len(m["rows"]) == 1


def test_merge_failure_keeps_every_note(tmp_path, downloads, monkeypatch):
    """THE fail-safe test: the pipeline succeeds but the notes merge errors
    mid-merge — every snapshotted note must survive untouched, even though the
    new data says the gaps were all resolved."""
    with app_client(tmp_path) as c:
        _setup(c, tmp_path, downloads)
        _put_note(c, SLUG, "traktor", "beta", "note 1")
        _put_note(c, SLUG, "traktor", "gamma", "note 2")
        _put_note(c, SLUG, "spotify", "delta", "note 3")
        before = _db_notes(c.sm3_data_dir)
        assert len(before) == 3

        # new joined data would resolve ALL gaps -> a successful merge would
        # drop every note; the injected failure must prevent that
        resolved = [
            joined_row("Yes-Trak-Playlist", spotify_join=k, trak_join=k,
                       spotify_name=k, traktor_title=k)
            for k in ("beta", "gamma", "delta")
        ]
        monkeypatch.setattr(pipeline_runner, "run_pipeline_impl",
                            _stub_writing({SLUG: resolved}))

        def boom(path):
            raise RuntimeError("simulated mid-merge failure")

        monkeypatch.setattr(pd_mod, "load_joined_rows", boom)

        assert c.post("/api/pipeline/run").status_code == 202
        st = wait_pipeline(c)

        # run completed; the merge failed safe
        assert st["state"] == "completed"
        merge_stage = next(s for s in st["stages"] if s["stage"] == "notes_merge")
        assert merge_stage["state"] == "warning"
        assert "fail safe" in merge_stage["message"]
        assert st["notes_summary"] == {"restored": 3, "dropped": 0}

        # every note survives, byte-identical
        assert _db_notes(c.sm3_data_dir) == before


def test_merge_crash_outside_failsafe_still_keeps_notes(tmp_path, downloads, monkeypatch):
    """Even if the merge machinery itself crashes (outside merge_notes'
    internal catch), the worker's outer handler must leave notes untouched."""
    with app_client(tmp_path) as c:
        _setup(c, tmp_path, downloads)
        _put_note(c, SLUG, "traktor", "beta", "precious")
        before = _db_notes(c.sm3_data_dir)

        monkeypatch.setattr(pipeline_runner, "run_pipeline_impl",
                            _stub_writing({SLUG: [
                                joined_row("Yes-Trak-Playlist", spotify_join="beta",
                                           trak_join="beta", spotify_name="B",
                                           traktor_title="B")]}))

        def explode(*a, **k):
            raise RuntimeError("merge machinery exploded")

        monkeypatch.setattr(pipeline_runner.notes_merge, "merge_notes", explode)

        c.post("/api/pipeline/run")
        st = wait_pipeline(c)
        assert st["state"] == "error"
        assert "exploded" in st["error"]
        assert _db_notes(c.sm3_data_dir) == before


def test_pipeline_stage_failure_keeps_notes(tmp_path, downloads, monkeypatch):
    with app_client(tmp_path) as c:
        _setup(c, tmp_path, downloads)
        _put_note(c, SLUG, "traktor", "beta", "still here")
        before = _db_notes(c.sm3_data_dir)

        def failing(nml_path, exportify_dir, work_dir, root_folder_name,
                    playlists_to_sync, exclude_prefixes, progress=None):
            if progress:
                progress("stage1_load", "Reading…")
            return SimpleNamespace(ok=False, stages=[], error="stage1_load failed: bad XML")

        monkeypatch.setattr(pipeline_runner, "run_pipeline_impl", failing)
        c.post("/api/pipeline/run")
        st = wait_pipeline(c)
        assert st["state"] == "error"
        assert "bad XML" in st["error"]
        assert st["notes_summary"] is None
        # stage marked errored
        s1 = next(s for s in st["stages"] if s["stage"] == "stage1_load")
        assert s1["state"] == "error"
        assert _db_notes(c.sm3_data_dir) == before


def test_run_pipeline_exception_is_an_error_status(tmp_path, downloads, monkeypatch):
    with app_client(tmp_path) as c:
        _setup(c, tmp_path, downloads)

        def raising(*a, **k):
            raise OSError("disk on fire")

        monkeypatch.setattr(pipeline_runner, "run_pipeline_impl", raising)
        c.post("/api/pipeline/run")
        st = wait_pipeline(c)
        assert st["state"] == "error"
        assert "disk on fire" in st["error"]


def test_second_run_while_running_is_409(tmp_path, downloads, monkeypatch):
    with app_client(tmp_path) as c:
        _setup(c, tmp_path, downloads)
        release = threading.Event()

        def slow(*a, **k):
            release.wait(timeout=10)
            return SimpleNamespace(ok=True, stages=[], error=None)

        monkeypatch.setattr(pipeline_runner, "run_pipeline_impl", slow)
        assert c.post("/api/pipeline/run").status_code == 202
        try:
            assert c.post("/api/pipeline/run").status_code == 409
            assert c.get("/api/pipeline/status").json()["state"] == "running"
        finally:
            release.set()
        st = wait_pipeline(c)
        assert st["state"] == "completed"


def _stub_skip():
    """run_pipeline stub simulating the empty/missing-Exportify graceful skip
    (issue #5): stage1/stage2 run and write the matrix; stage3_compare and
    stage4_join return skipped StageResults (ok=True) and NO joined CSV is
    regenerated — exactly like the real pipeline with no Exportify data."""
    from pipeline.api import StageResult

    def stub(nml_path, exportify_dir, work_dir, root_folder_name,
             playlists_to_sync, exclude_prefixes, progress=None):
        work_dir = Path(work_dir)
        if progress:
            progress("stage1_load", "Reading Traktor collection…")
        write_collection_playlists(work_dir, [(PLAYLIST_PATH, DISPLAY, "$ROOT")])
        write_csv(
            work_dir / "Traktor" / "traktor_collection_tracks.csv",
            ["track_key", "title"], [["K:/:t0.mp3", "T0"]],
        )
        if progress:
            progress("stage2_playlists", "Building matrix…")
        write_matrix(work_dir, [DISPLAY], [
            {"track_key": "K:/:t0.mp3", "name": "T0", "artist": "A",
             "member_of": [DISPLAY]},
        ])
        msg = "No Spotify data found — matrix built; comparison skipped."
        if progress:
            progress("stage3_compare", msg)
            progress("stage4_join", msg)
        # NB: deliberately does NOT write any Joined/joined_*.csv
        return SimpleNamespace(ok=True, error=None, stages=[
            StageResult("stage1_load", True, "done"),
            StageResult("stage2_playlists", True, "done"),
            StageResult("stage3_compare", True, msg, skipped=True),
            StageResult("stage4_join", True, msg, skipped=True),
        ])

    return stub


def test_notes_survive_empty_exportify_skip(tmp_path, downloads, monkeypatch):
    """CLAUDE.md hard constraint: comparison notes must survive a run where the
    Exportify folder went empty. Run 1 builds the comparison (joined CSVs) with
    notes on persisting gaps; Run 2 has no Exportify data, so compare+join are
    skipped, the joined CSVs are NOT regenerated, and every note is kept."""
    with app_client(tmp_path) as c:
        _setup(c, tmp_path, downloads)

        # notes on gaps that persist in the run-1 comparison
        _put_note(c, SLUG, "traktor", "beta", "go buy beta")
        _put_note(c, SLUG, "spotify", "delta", "traktor only fyi")

        run1_rows = [
            joined_row("Not-Trak-Collection", spotify_join="beta", spotify_name="Beta"),
            joined_row("Not-Spotify / Yes-Trak-Playlist", trak_join="delta",
                       traktor_title="Delta"),
        ]
        monkeypatch.setattr(pipeline_runner, "run_pipeline_impl",
                            _stub_writing({SLUG: run1_rows}))
        assert c.post("/api/pipeline/run").status_code == 202
        st1 = wait_pipeline(c)
        assert st1["state"] == "completed", st1
        after_run1 = _db_notes(c.sm3_data_dir)
        assert after_run1 == {
            (SLUG, "traktor", "beta", "go buy beta"),
            (SLUG, "spotify", "delta", "traktor only fyi"),
        }

        # Run 2: Exportify empty -> compare + join skipped gracefully
        monkeypatch.setattr(pipeline_runner, "run_pipeline_impl", _stub_skip())
        assert c.post("/api/pipeline/run").status_code == 202
        st2 = wait_pipeline(c)

        # run succeeds (not a red error), notes summary shows nothing dropped
        assert st2["state"] == "completed", st2
        assert st2["error"] is None
        assert st2["notes_summary"] == {"restored": 2, "dropped": 0}

        # EVERY note survives the skip, byte-identical to before
        assert _db_notes(c.sm3_data_dir) == after_run1

        # skipped Spotify stages surface as non-alarming 'warning', not error
        by_stage = {s["stage"]: s for s in st2["stages"]}
        assert by_stage["stage3_compare"]["state"] == "warning"
        assert by_stage["stage4_join"]["state"] == "warning"
        assert "comparison skipped" in by_stage["stage3_compare"]["message"]
        assert by_stage["stage3_compare"]["label"]  # a human label exists
        # collection/matrix stages and finalize completed normally
        assert by_stage["stage1_load"]["state"] == "completed"
        assert by_stage["stage2_playlists"]["state"] == "completed"
        assert by_stage["finalize"]["state"] == "completed"
        assert by_stage["notes_merge"]["state"] == "completed"

        # matrix rebuilt + served on the Exportify-less path
        m = c.get("/api/matrix").json()
        assert [p["name"] for p in m["playlists"]] == [DISPLAY]
        assert len(m["rows"]) == 1


def test_config_pruned_when_playlist_disappears(tmp_path, downloads, monkeypatch):
    with app_client(tmp_path) as c:
        _setup(c, tmp_path, downloads)
        # a second checked playlist that the new collection no longer has
        c.put("/api/comparison/config",
              json={"checked_paths": [PLAYLIST_PATH, "$ROOT/Ghost"]})
        assert _db_config_paths(c.sm3_data_dir) == {PLAYLIST_PATH, "$ROOT/Ghost"}

        monkeypatch.setattr(
            pipeline_runner, "run_pipeline_impl",
            _stub_writing({SLUG: [joined_row(
                "Not-Trak-Collection", spotify_join="x", spotify_name="X")]}),
        )
        c.post("/api/pipeline/run")
        st = wait_pipeline(c)
        assert st["state"] == "completed"
        # renamed/deleted Traktor playlist loses its config entry
        assert _db_config_paths(c.sm3_data_dir) == {PLAYLIST_PATH}
