"""Golden-master tests: the ported pipeline must reproduce the legacy SM2
pipeline's outputs byte-for-byte on Ry's real test data.

Prerequisite (built once by the build agent; see backend/tests/golden-cache/):
- backend/tests/golden-cache/setmaster/ is a copy of the legacy SM2 public
  release folder, with testdata Exportify CSVs and a filled
  config__traktor_playlists_to_sync.csv, after a full legacy
  run_all_scripts.py run against testdata/collection.nml with
  --playlist-arg "RML root". Its Traktor/, Joined/ and
  traktor_spotify_playlist_compare.csv are the golden reference.

The port then runs run_pipeline() into golden-cache/port-run/ and every
output CSV is compared whole-file. ANY diff is a port bug — fix the port,
never the expectation.
"""

import shutil
from pathlib import Path

import pandas as pd
import pytest

from pipeline import run_pipeline

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
GOLDEN_DIR = BACKEND_DIR / "tests" / "golden-cache" / "setmaster"
PORT_RUN_DIR = BACKEND_DIR / "tests" / "golden-cache" / "port-run"
NML_PATH = REPO_ROOT / "testdata" / "collection.nml"
ROOT_FOLDER_NAME = "RML root"  # Ry's Super Playlist root folder in testdata

pytestmark = pytest.mark.golden

_missing = [
    p for p in (
        NML_PATH,
        GOLDEN_DIR / "traktor_spotify_playlist_compare.csv",
        GOLDEN_DIR / "Traktor" / "traktor_track_playlist_matrix.csv",
        GOLDEN_DIR / "config__traktor_playlists_to_sync.csv",
    ) if not p.exists()
]
if _missing:
    pytest.skip(
        "golden-cache not prepared (run the legacy pipeline into "
        f"backend/tests/golden-cache/setmaster first); missing: {_missing}",
        allow_module_level=True,
    )


def _playlists_to_sync() -> list[str]:
    """The exact playlist names the golden run was configured with."""
    cfg = pd.read_csv(GOLDEN_DIR / "config__traktor_playlists_to_sync.csv",
                      encoding="utf-8-sig")
    col = cfg["playlist_name_in_both_spotify_and_traktor"].dropna().str.strip()
    return col[col != ""].tolist()


@pytest.fixture(scope="module")
def port_run():
    """Run the ported pipeline once into a fresh work_dir."""
    if PORT_RUN_DIR.exists():
        shutil.rmtree(PORT_RUN_DIR)
    PORT_RUN_DIR.mkdir(parents=True)

    progress_calls: list[tuple[str, str]] = []
    result = run_pipeline(
        nml_path=NML_PATH,
        exportify_dir=GOLDEN_DIR / "Exportify",
        work_dir=PORT_RUN_DIR,
        root_folder_name=ROOT_FOLDER_NAME,
        playlists_to_sync=_playlists_to_sync(),
        exclude_prefixes=[],
        progress=lambda stage, msg: progress_calls.append((stage, msg)),
    )
    return result, progress_calls


def test_pipeline_ran_ok(port_run):
    result, _ = port_run
    assert result.ok, f"pipeline failed: {result.error}"
    assert [s.stage for s in result.stages] == [
        "stage1_load", "stage2_playlists", "stage3_compare", "stage4_join",
    ]
    assert all(s.ok for s in result.stages)


def test_progress_called_per_stage(port_run):
    _, progress_calls = port_run
    stages_seen = [s for s, _ in progress_calls]
    for stage in ("stage1_load", "stage2_playlists", "stage3_compare", "stage4_join"):
        assert stages_seen.count(stage) >= 2, f"progress not called for {stage}"


def _relative_output_files(base: Path) -> set[str]:
    """All pipeline output CSVs under a run dir, as relative POSIX paths."""
    files = set()
    for sub in ("Traktor", "Joined"):
        d = base / sub
        if d.exists():
            for f in d.glob("*.csv"):
                files.add(f.relative_to(base).as_posix())
    compare = base / "traktor_spotify_playlist_compare.csv"
    if compare.exists():
        files.add(compare.name)
    return files


def test_same_output_file_set(port_run):
    golden_files = _relative_output_files(GOLDEN_DIR)
    port_files = _relative_output_files(PORT_RUN_DIR)
    assert port_files == golden_files, (
        f"missing from port: {sorted(golden_files - port_files)}; "
        f"extra in port: {sorted(port_files - golden_files)}"
    )


def _diff_report(golden_path: Path, port_path: Path) -> str:
    """Build a human-useful report of where two CSVs differ."""
    try:
        g = pd.read_csv(golden_path, encoding="utf-8-sig", dtype=str, keep_default_na=False)
        p = pd.read_csv(port_path, encoding="utf-8-sig", dtype=str, keep_default_na=False)
    except Exception as exc:  # fall back to raw notice
        return f"(could not parse for diff: {exc})"
    lines = []
    if list(g.columns) != list(p.columns):
        lines.append(f"columns differ:\n golden={list(g.columns)}\n   port={list(p.columns)}")
    if len(g) != len(p):
        lines.append(f"row counts differ: golden={len(g)} port={len(p)}")
    if not lines:
        neq = (g != p)
        bad_cols = [c for c in g.columns if neq[c].any()]
        for c in bad_cols[:5]:
            idx = neq[c][neq[c]].index[:3]
            for i in idx:
                lines.append(f"col {c!r} row {i}: golden={g.at[i, c]!r} port={p.at[i, c]!r}")
    return "\n".join(lines) or "(byte-level difference only, parsed data equal)"


def test_all_outputs_byte_identical(port_run):
    golden_files = sorted(_relative_output_files(GOLDEN_DIR))
    assert golden_files, "golden run produced no outputs?"
    failures = []
    for rel in golden_files:
        golden_path = GOLDEN_DIR / rel
        port_path = PORT_RUN_DIR / rel
        if not port_path.exists():
            failures.append(f"{rel}: missing from port run")
            continue
        if golden_path.read_bytes() != port_path.read_bytes():
            failures.append(f"{rel}: bytes differ ->\n{_diff_report(golden_path, port_path)}")
    assert not failures, "output files differ from golden:\n\n" + "\n\n".join(failures)


def test_matrix_shape_sanity(port_run):
    """Sanity anchor on the real-data matrix (guards against a silently
    empty-but-identical comparison ever passing)."""
    m = pd.read_csv(PORT_RUN_DIR / "Traktor" / "traktor_track_playlist_matrix.csv",
                    encoding="utf-8-sig")
    fixed = ["Track Key", "Import Date", "Release Date", "Last Played", "Play Count",
             "BPM", "Key", "Album Title", "Artist Name", "Track Name",
             "On Root PL", "On Non-Root PL"]
    assert list(m.columns[:12]) == fixed
    assert len(m) > 5000  # tens of thousands of membership rows -> thousands of tracks
    assert (m["On Root PL"] > 0).any(), "root counting produced all zeros"
    assert (m["On Non-Root PL"] > 0).any()
