"""Pipeline package public interface.

The app layer (backend/app) imports only this module. Contract:
build-notes/api-contract.md, "Pipeline package interface".

Restructuring vs SM2's run_all_scripts.py (plumbing only — outputs and
matching behavior are identical):
- direct function calls instead of subprocess per stage;
- config CSVs replaced by list parameters;
- SM2's Excel-era file-lock preflight and repo-path-suffix
  ("playlist-dev"/"setmaster") validation are dropped — the web app
  owns its work_dir and never has Excel holding the CSVs open;
- console tee/log file replaced by the progress callback (stage prints
  still go to stdout for server logs).
"""

from __future__ import annotations

import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from . import stage1_load, stage2_playlists, stage3_compare, stage4_join

__all__ = ["StageResult", "PipelineResult", "run_pipeline", "STAGES"]

# (stage id, human label) in run order
STAGES = [
    ("stage1_load", "Reading Traktor collection"),
    ("stage2_playlists", "Exporting playlists & building matrix"),
    ("stage3_compare", "Comparing Traktor vs Spotify playlists"),
    ("stage4_join", "Joining playlist pairs"),
]

# Stages that read Spotify (Exportify) CSV exports. With no Exportify data
# there is nothing for them to do, and the Track-Playlist Matrix (stage 2) is
# built entirely from the Traktor collection — so both are skipped together
# rather than crashing the run (issue #5). stage4 must be skipped alongside
# stage3: it reads the compare CSV stage3 would have written, so skipping only
# stage3 just moves the crash to stage4.
_SPOTIFY_DEPENDENT_STAGES = frozenset({"stage3_compare", "stage4_join"})

# Friendly, non-alarming notice shown for the skipped Spotify stages.
_EXPORTIFY_EMPTY_MESSAGE = (
    "No Spotify data found — matrix built; comparison skipped. "
    "Add your Spotify CSV exports to the Exportify folder to compare."
)


def _exportify_has_data(exportify_dir: Path) -> bool:
    """True when the Exportify folder exists and holds at least one entry.

    Mirrors stage3's own missing/empty guard exactly (existence + at least one
    directory entry), so the full-data path — and even a folder that holds only
    non-CSV files — is byte-for-byte unchanged; only a truly missing or empty
    folder triggers the graceful skip.
    """
    if not exportify_dir.exists():
        return False
    try:
        next(iter(exportify_dir.iterdir()))
    except StopIteration:
        return False
    return True


@dataclass
class StageResult:
    stage: str
    ok: bool
    message: str
    outputs: list[Path] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    # True when the stage was deliberately not run (e.g. the Spotify-comparison
    # stages when the Exportify folder is empty/missing — issue #5). Additive,
    # default False, so a skip is `ok=True` yet distinguishable from a stage
    # that actually ran. The app layer maps skipped stages to a non-alarming
    # 'warning' state instead of a red failure.
    skipped: bool = False


@dataclass
class PipelineResult:
    ok: bool
    stages: list[StageResult] = field(default_factory=list)
    error: Optional[str] = None


def run_pipeline(
    nml_path: Path,
    exportify_dir: Path,
    work_dir: Path,
    root_folder_name: str,
    playlists_to_sync: list[str],
    exclude_prefixes: list[str],
    progress: Optional[Callable[[str, str], None]] = None,
) -> PipelineResult:
    """Run the four SM2 pipeline stages against `nml_path` + `exportify_dir`,
    writing all outputs under `work_dir` (Traktor/, Joined/,
    traktor_spotify_playlist_compare.csv — all utf-8-sig, schemas identical
    to SM2). `collection.nml` is only ever read.

    A stage failure stops the pipeline (as SM2's runner did on a non-zero
    exit); already-completed stage results are returned. `progress` is
    called as progress(stage_id, message) at stage start and completion.

    When `exportify_dir` is missing or empty the two Spotify-comparison stages
    (stage3_compare, stage4_join) are skipped gracefully — each returns an
    ok=True StageResult with `skipped=True` and a friendly warning — so the
    matrix still builds and the run finishes successfully (issue #5).
    """
    nml_path = Path(nml_path)
    exportify_dir = Path(exportify_dir)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    def _notify(stage: str, message: str) -> None:
        if progress is not None:
            progress(stage, message)

    runners = {
        "stage1_load": lambda: stage1_load.run_stage1(nml_path, work_dir),
        "stage2_playlists": lambda: stage2_playlists.run_stage2(
            work_dir, root_folder_name or "", playlists_to_sync, exclude_prefixes
        ),
        "stage3_compare": lambda: stage3_compare.run_stage3(work_dir, exportify_dir),
        "stage4_join": lambda: stage4_join.run_stage4(work_dir, exportify_dir),
    }

    result = PipelineResult(ok=True)

    # SM2 preflight (minus Excel-era checks): required inputs must exist.
    if not nml_path.exists():
        result.ok = False
        result.error = f"Collection file not found: {nml_path}"
        return result

    # Detected once, up front: no Exportify data -> skip the Spotify stages.
    skip_spotify_stages = not _exportify_has_data(exportify_dir)

    for stage_id, label in STAGES:
        if skip_spotify_stages and stage_id in _SPOTIFY_DEPENDENT_STAGES:
            _notify(stage_id, _EXPORTIFY_EMPTY_MESSAGE)
            result.stages.append(
                StageResult(
                    stage=stage_id,
                    ok=True,
                    message=_EXPORTIFY_EMPTY_MESSAGE,
                    outputs=[],
                    warnings=[_EXPORTIFY_EMPTY_MESSAGE],
                    skipped=True,
                )
            )
            continue

        _notify(stage_id, f"{label}…")
        try:
            outputs, warnings = runners[stage_id]()
        except Exception as exc:  # stage failure stops the pipeline
            message = f"{type(exc).__name__}: {exc}"
            traceback.print_exc()
            stage_result = StageResult(
                stage=stage_id, ok=False, message=message, outputs=[], warnings=[]
            )
            result.stages.append(stage_result)
            result.ok = False
            result.error = f"{stage_id} failed: {message}"
            _notify(stage_id, f"{label} failed: {message}")
            return result

        stage_result = StageResult(
            stage=stage_id,
            ok=True,
            message=f"{label} — done",
            outputs=list(outputs),
            warnings=list(warnings),
        )
        result.stages.append(stage_result)
        _notify(stage_id, f"{label} — done")

    return result
