"""Issue #5 — the Track-Playlist Matrix must build even when the Exportify
folder is empty or missing.

The two Spotify-comparison stages (stage3_compare, stage4_join) read Exportify
CSVs; with none present they are skipped *gracefully* (ok=True, skipped=True,
friendly warning) instead of raising ExportifyDirError and aborting the run.
stage1/stage2 still run, so the matrix is written and the pipeline reports ok.

The full-data path is exercised too (regression guard): with real testdata
Exportify present, all four stages run, nothing is skipped, and the compare CSV
is written exactly as before.

These use the real ported pipeline against testdata/collection.nml (read-only);
all outputs go to a temp work_dir. Skips cleanly if testdata is absent.
"""

import shutil
import tempfile
from pathlib import Path

import pandas as pd
import pytest

from pipeline import run_pipeline
from pipeline.api import (
    _EXPORTIFY_EMPTY_MESSAGE,
    _SPOTIFY_DEPENDENT_STAGES,
    _exportify_has_data,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
NML_PATH = REPO_ROOT / "testdata" / "collection.nml"
EXPORTIFY_DIR = REPO_ROOT / "testdata" / "Exportify"
ROOT_FOLDER_NAME = "RML root"

_MATRIX_REL = Path("Traktor") / "traktor_track_playlist_matrix.csv"
_COMPARE_REL = Path("traktor_spotify_playlist_compare.csv")

if not NML_PATH.exists():
    pytest.skip(
        f"testdata not present (missing {NML_PATH})", allow_module_level=True
    )


# ---------------------------------------------------------------------------
# _exportify_has_data — the single up-front detection (mirrors stage3's guard)
# ---------------------------------------------------------------------------

class TestExportifyHasData:
    def test_missing_dir(self, tmp_path):
        assert _exportify_has_data(tmp_path / "nope") is False

    def test_empty_dir(self, tmp_path):
        d = tmp_path / "empty"
        d.mkdir()
        assert _exportify_has_data(d) is False

    def test_dir_with_a_csv(self, tmp_path):
        d = tmp_path / "has"
        d.mkdir()
        (d / "playlist.csv").write_text("Track URI\n", encoding="utf-8")
        assert _exportify_has_data(d) is True

    def test_dir_with_only_non_csv_is_still_data(self, tmp_path):
        # Mirrors stage3's own guard: ANY entry counts, so a junk-only folder
        # is NOT skipped (its full-data behavior stays byte-identical).
        d = tmp_path / "junk"
        d.mkdir()
        (d / "readme.txt").write_text("hi", encoding="utf-8")
        assert _exportify_has_data(d) is True


# ---------------------------------------------------------------------------
# graceful skip on empty / missing Exportify
# ---------------------------------------------------------------------------

def _run(exportify_dir: Path):
    work_dir = Path(tempfile.mkdtemp(prefix="sm3_empty_exp_"))
    progress_calls: list[tuple[str, str]] = []
    try:
        result = run_pipeline(
            nml_path=NML_PATH,
            exportify_dir=exportify_dir,
            work_dir=work_dir,
            root_folder_name=ROOT_FOLDER_NAME,
            playlists_to_sync=[],
            exclude_prefixes=[],
            progress=lambda s, m: progress_calls.append((s, m)),
        )
        return result, progress_calls, work_dir
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise


def _assert_graceful_skip(result, work_dir):
    assert result.ok is True, f"run should succeed, got error: {result.error}"
    assert result.error is None
    by_stage = {s.stage: s for s in result.stages}

    # all four stages reported, in order
    assert [s.stage for s in result.stages] == [
        "stage1_load", "stage2_playlists", "stage3_compare", "stage4_join",
    ]
    # collection + matrix stages actually ran
    for sid in ("stage1_load", "stage2_playlists"):
        assert by_stage[sid].ok is True
        assert by_stage[sid].skipped is False
    # Spotify stages skipped gracefully with a friendly warning
    for sid in _SPOTIFY_DEPENDENT_STAGES:
        s = by_stage[sid]
        assert s.ok is True, f"{sid} must not fail the run"
        assert s.skipped is True
        assert s.message == _EXPORTIFY_EMPTY_MESSAGE
        assert s.warnings == [_EXPORTIFY_EMPTY_MESSAGE]
        assert s.outputs == []

    # the matrix built on the Exportify-less path (6,810 real-data tracks)
    matrix = work_dir / _MATRIX_REL
    assert matrix.is_file(), "matrix must be written when Exportify is empty"
    m = pd.read_csv(matrix, encoding="utf-8-sig", low_memory=False)
    assert len(m) == 6810
    assert list(m.columns[:12]) == [
        "Track Key", "Import Date", "Release Date", "Last Played", "Play Count",
        "BPM", "Key", "Album Title", "Artist Name", "Track Name",
        "On Root PL", "On Non-Root PL",
    ]

    # the Spotify-dependent outputs were NOT produced
    assert not (work_dir / _COMPARE_REL).exists()
    joined = work_dir / "Joined"
    assert not joined.exists() or not any(joined.glob("joined_*.csv"))


def test_empty_exportify_skips_compare_and_join(tmp_path):
    empty = tmp_path / "exportify_empty"
    empty.mkdir()
    result, progress_calls, work_dir = _run(empty)
    try:
        _assert_graceful_skip(result, work_dir)
        # progress still surfaced the skip for the two stages
        seen = {s: msg for s, msg in progress_calls}
        assert seen["stage3_compare"] == _EXPORTIFY_EMPTY_MESSAGE
        assert seen["stage4_join"] == _EXPORTIFY_EMPTY_MESSAGE
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def test_missing_exportify_skips_compare_and_join(tmp_path):
    missing = tmp_path / "exportify_missing"  # never created
    result, _progress, work_dir = _run(missing)
    try:
        _assert_graceful_skip(result, work_dir)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# regression: the full-data path is unchanged
# ---------------------------------------------------------------------------

@pytest.mark.skipif(
    not EXPORTIFY_DIR.exists() or not any(EXPORTIFY_DIR.glob("*.csv")),
    reason="testdata/Exportify not present",
)
def test_full_data_path_runs_all_stages(tmp_path):
    result, _progress, work_dir = _run(EXPORTIFY_DIR)
    try:
        assert result.ok is True
        # nothing skipped when Exportify has data
        assert all(s.skipped is False for s in result.stages)
        assert all(s.ok for s in result.stages)
        # compare CSV written (full pipeline ran)
        assert (work_dir / _COMPARE_REL).is_file()
        m = pd.read_csv(work_dir / _MATRIX_REL, encoding="utf-8-sig",
                        low_memory=False)
        assert len(m) == 6810
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
