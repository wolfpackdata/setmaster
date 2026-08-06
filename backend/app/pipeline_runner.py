"""Pipeline run orchestration: worker thread + status + notes snapshot-merge.

The pipeline package (backend/pipeline/) is built by a parallel workstream, so
it is imported lazily and defensively; tests monkeypatch `run_pipeline_impl`.
"""
from __future__ import annotations

import threading
import uuid
from pathlib import Path

from . import db as dbmod
from . import notes_merge, pipeline_data
from .pipeline_data import FLAG_GO_GET, FLAG_ORGANIZE
from .util import normalize_playlist_name, now_iso

# Test seam / lazy import: when None, `pipeline.api.run_pipeline` is imported
# at call time (the pipeline package is being built in parallel).
run_pipeline_impl = None


def _resolve_run_pipeline():
    if run_pipeline_impl is not None:
        return run_pipeline_impl
    try:
        from pipeline.api import run_pipeline  # type: ignore[import-not-found]
        return run_pipeline
    except Exception as exc:  # pragma: no cover - environment-dependent
        raise RuntimeError(
            f"pipeline package unavailable: {type(exc).__name__}: {exc}"
        ) from exc


STAGE_LABELS = {
    "snapshot": "Snapshot comparison notes",
    "load": "Read Traktor collection",
    "collection": "Read Traktor collection",
    "playlists": "Build playlists & matrix",
    "matrix": "Build playlists & matrix",
    "compare": "Compare playlist files",
    "join": "Join Spotify & Traktor tracks",
    "notes_merge": "Merge comparison notes",
    "finalize": "Refresh caches",
}


def _label(stage: str) -> str:
    return STAGE_LABELS.get(stage, stage.replace("_", " ").capitalize())


def _idle_status() -> dict:
    return {
        "state": "idle",
        "stages": [],
        "started_at": None,
        "finished_at": None,
        "error": None,
        "notes_summary": None,
        "gap_counts": None,
    }


class PipelineManager:
    def __init__(self, state):
        self.state = state
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._status = _idle_status()

    # --- status ---

    def status(self) -> dict:
        with self._lock:
            import copy
            return copy.deepcopy(self._status)

    def is_running(self) -> bool:
        with self._lock:
            return self._status["state"] == "running"

    # --- stage bookkeeping ---

    def _begin_stage(self, stage: str, message: str = "") -> None:
        with self._lock:
            stages = self._status["stages"]
            for s in stages:
                if s["state"] == "running":
                    s["state"] = "completed"
            for s in stages:
                if s["stage"] == stage:
                    s["state"] = "running"
                    s["message"] = message
                    return
            stages.append(
                {"stage": stage, "label": _label(stage), "state": "running", "message": message}
            )

    def _finish_stage(self, stage: str, state: str = "completed", message: str | None = None) -> None:
        with self._lock:
            for s in self._status["stages"]:
                if s["stage"] == stage:
                    s["state"] = state
                    if message is not None:
                        s["message"] = message

    def _progress(self, stage: str, message: str) -> None:
        """Progress callback handed to run_pipeline (Callable[[str, str], None])."""
        self._begin_stage(stage, message)

    # --- launch ---

    def start(self) -> str:
        with self._lock:
            if self._status["state"] == "running":
                raise RuntimeError("pipeline already running")
            run_id = uuid.uuid4().hex
            self._status = _idle_status()
            self._status.update(state="running", started_at=now_iso())
            self._status["run_id"] = run_id
            self._thread = threading.Thread(
                target=self._run, name=f"sm3-pipeline-{run_id[:8]}", daemon=True
            )
            self._thread.start()
            return run_id

    # --- worker ---

    def _run(self) -> None:
        state = self.state
        # signatures of joined CSVs before the run: "regenerated" is decided by
        # file-content signature, not wall-clock (Windows mtime can lag time.time())
        pre_run_sigs = notes_merge.joined_signatures(state.work_dir)
        try:
            conn = state.db()
            try:
                settings = dbmod.get_settings(conn)
                config_rows = [
                    dict(r)
                    for r in conn.execute(
                        "SELECT playlist_path, display_name FROM comparison_config "
                        "ORDER BY display_name"
                    )
                ]
                # 1. snapshot comparison notes (fail-safe basis)
                self._begin_stage("snapshot")
                snapshot = [
                    dict(r)
                    for r in conn.execute(
                        "SELECT slug, side, join_key, text FROM comparison_notes"
                    )
                ]
                self._finish_stage(
                    "snapshot", message=f"{len(snapshot)} note(s) snapshotted"
                )
            finally:
                conn.close()

            # 2. run the pipeline with settings-derived args
            run_pipeline = _resolve_run_pipeline()
            result = run_pipeline(
                nml_path=Path(settings["collection_nml_path"]),
                exportify_dir=state.exportify_dir,
                work_dir=state.work_dir,
                root_folder_name=settings["super_playlist_folder"],
                playlists_to_sync=[r["display_name"] for r in config_rows],
                exclude_prefixes=list(settings["exclude_prefixes"]),
                progress=self._progress,
            )

            ok = bool(getattr(result, "ok", False))
            if not ok:
                # pipeline failed -> notes untouched (snapshot intact by design)
                error = getattr(result, "error", None) or "pipeline failed"
                with self._lock:
                    for s in self._status["stages"]:
                        if s["state"] == "running":
                            s["state"] = "error"
                    self._status.update(
                        state="error", error=str(error), finished_at=now_iso()
                    )
                return

            with self._lock:
                for s in self._status["stages"]:
                    if s["state"] == "running":
                        s["state"] = "completed"

            # Gracefully-skipped Spotify stages (empty/missing Exportify ->
            # compare+join skipped, issue #5) surface as a non-alarming
            # 'warning', NOT a red error. Address each status entry by the SAME
            # stage id the pipeline used for its progress callback
            # (e.g. "stage3_compare"): STAGE_LABELS is keyed by the app's short
            # stage names ("compare"/"join"/…), which never match the
            # pipeline's ids, so `_label()` already falls back for these and the
            # status entries live under the pipeline id — using "compare" here
            # would silently match nothing. We touch state+message only.
            for sr in getattr(result, "stages", None) or []:
                if getattr(sr, "skipped", False):
                    self._finish_stage(
                        getattr(sr, "stage", ""),
                        state="warning",
                        message=getattr(sr, "message", "") or "Skipped",
                    )

            # 3. merge notes (fail safe: keeps snapshot on ANY failure)
            self._begin_stage("notes_merge")
            conn = state.db()
            try:
                summary = notes_merge.merge_notes(
                    conn, state.work_dir, snapshot, pre_run_sigs
                )
            finally:
                conn.close()
            if summary["failed"]:
                self._finish_stage(
                    "notes_merge",
                    state="warning",
                    message=(
                        "merge failed — all notes kept (fail safe): "
                        + str(summary["error"])
                    ),
                )
            else:
                self._finish_stage(
                    "notes_merge",
                    message=f"{summary['restored']} restored, {summary['dropped']} dropped",
                )

            # 4. finalize: refresh caches + collection metadata + config prune
            self._begin_stage("finalize")
            state.pipeline_data.invalidate()
            gap_counts = self._collect_gap_counts(config_rows, pre_run_sigs)
            self._update_collection_meta()
            self._prune_config()
            state.pipeline_data.matrix()  # warm the matrix cache (best effort)
            self._finish_stage("finalize")

            with self._lock:
                self._status.update(
                    state="completed",
                    finished_at=now_iso(),
                    notes_summary={
                        "restored": summary["restored"],
                        "dropped": summary["dropped"],
                    },
                    gap_counts=gap_counts,
                )
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                for s in self._status["stages"]:
                    if s["state"] == "running":
                        s["state"] = "error"
                self._status.update(
                    state="error",
                    error=f"{type(exc).__name__}: {exc}",
                    finished_at=now_iso(),
                )

    # --- helpers ---

    def _collect_gap_counts(
        self, config_rows: list[dict], pre_run_sigs: dict[str, tuple]
    ) -> list[dict]:
        conn = self.state.db()
        try:
            imports = {
                normalize_playlist_name(r["display_name"]): r["slug"]
                for r in conn.execute("SELECT slug, display_name FROM exportify_imports")
            }
            for r in conn.execute("SELECT slug FROM exportify_imports"):
                imports.setdefault(normalize_playlist_name(r["slug"]), r["slug"])
        finally:
            conn.close()
        out = []
        for row in config_rows:
            joined = pipeline_data.find_joined_file(self.state.work_dir, row["display_name"])
            if joined is None or not notes_merge.was_regenerated(joined, pre_run_sigs):
                continue
            try:
                rows = pipeline_data.load_joined_rows(joined)
            except Exception:  # noqa: BLE001 — one bad file must not kill the run
                continue
            go_get = sum(1 for r in rows if (r.get("presence_flag") or "").strip() == FLAG_GO_GET)
            organize = sum(
                1 for r in rows if (r.get("presence_flag") or "").strip() == FLAG_ORGANIZE
            )
            norm = normalize_playlist_name(row["display_name"])
            out.append(
                {
                    "slug": imports.get(norm, norm),
                    "display_name": row["display_name"],
                    "go_get": go_get,
                    "organize": organize,
                }
            )
        return out

    def _update_collection_meta(self) -> None:
        tracks_csv = self.state.pipeline_data.tracks_csv
        track_count = None
        if tracks_csv.is_file():
            try:
                with open(tracks_csv, encoding="utf-8-sig", newline="") as f:
                    track_count = max(sum(1 for _ in f) - 1, 0)
            except OSError:
                track_count = None
        conn = self.state.db()
        try:
            dbmod.kv_set(
                conn,
                "collection_meta",
                {"last_read_iso": now_iso(), "track_count": track_count},
            )
        finally:
            conn.close()

    def _prune_config(self) -> None:
        """Drop config entries whose Traktor playlist no longer exists
        (exportify-import.md §7: renamed/deleted playlists lose their entry)."""
        playlists = self.state.pipeline_data.collection_playlists()
        if playlists is None:
            return
        valid = {p["path"] for p in playlists}
        conn = self.state.db()
        try:
            stale = [
                r["playlist_path"]
                for r in conn.execute("SELECT playlist_path FROM comparison_config").fetchall()
                if r["playlist_path"] not in valid
            ]
            with conn:
                for path in stale:
                    conn.execute(
                        "DELETE FROM comparison_config WHERE playlist_path=?", (path,)
                    )
        finally:
            conn.close()
