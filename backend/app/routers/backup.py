"""Backup (zip download of the whole data dir) and restore (atomic swap)."""
from __future__ import annotations

import datetime
import os
import shutil
import sqlite3
import tempfile
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..config import DB_FILENAME
from ..instance import INSTANCE_FILENAME
from ..state import AppState
from .deps import get_state

router = APIRouter(prefix="/api", tags=["backup"])

_SQLITE_MAGIC = b"SQLite format 3\x00"
# transient files that must not be captured: WAL sidecars (checkpointed first)
# and the running server's identity file, which belongs to a process, not to a
# backup — restoring someone else's would leave the stopper unable to prove us
_SKIP_NAMES = {
    f"{DB_FILENAME}-wal",
    f"{DB_FILENAME}-shm",
    f"{DB_FILENAME}-journal",
    INSTANCE_FILENAME,
}
# tables every SetMaster 3 database has carried since build #1 — their absence
# means the upload is some other program's SQLite file, not an SM3 backup
_CORE_TABLES = ("sets", "set_rows", "kv")


def _checkpoint(state: AppState) -> None:
    """Fold the WAL into the main db file so the zipped .db is complete."""
    conn = state.db()
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()


@router.get("/backup")
def backup(state: AppState = Depends(get_state)) -> FileResponse:
    _checkpoint(state)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    fd, tmp_name = tempfile.mkstemp(prefix="sm3-backup-", suffix=".zip")
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp_name, "w", zipfile.ZIP_DEFLATED) as zf:
            for p in sorted(state.data_dir.rglob("*")):
                if not p.is_file() or p.name in _SKIP_NAMES:
                    continue
                zf.write(p, p.relative_to(state.data_dir).as_posix())
    except BaseException:
        os.unlink(tmp_name)
        raise
    return FileResponse(
        tmp_name,
        media_type="application/zip",
        filename=f"setmaster3-backup-{stamp}.zip",
        background=BackgroundTask(os.unlink, tmp_name),
    )


def _safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    """Extract with zip-slip protection (no absolute paths, no `..` escapes)."""
    dest_resolved = dest.resolve()
    for info in zf.infolist():
        name = info.filename.replace("\\", "/")
        if not name or name.endswith("/"):
            continue
        target = (dest / name).resolve()
        if dest_resolved != target and dest_resolved not in target.parents:
            raise HTTPException(status_code=400, detail=f"Unsafe zip entry: {info.filename}")
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)


def _validate_backup_db(db_file: Path) -> None:
    """Prove the staged database is a healthy SM3 db *before* it goes live.

    The magic prefix alone says nothing about the rest of the file, so a
    truncated or corrupt db would otherwise pass validation and become the live
    database.
    """
    with open(db_file, "rb") as f:
        if f.read(len(_SQLITE_MAGIC)) != _SQLITE_MAGIC:
            raise HTTPException(
                status_code=400,
                detail=f"Not a SetMaster 3 backup: {DB_FILENAME} is not a SQLite database",
            )

    bad_db = HTTPException(
        status_code=400,
        detail=f"Not a usable backup: {DB_FILENAME} is damaged or unreadable",
    )
    try:
        conn = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        raise bad_db from None
    try:
        row = conn.execute("PRAGMA integrity_check").fetchone()
        if not row or str(row[0]).lower() != "ok":
            raise bad_db
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        missing = [t for t in _CORE_TABLES if t not in tables]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Not a SetMaster 3 backup: {DB_FILENAME} is missing "
                    f"{', '.join(missing)}"
                ),
            )
    except sqlite3.DatabaseError:
        raise bad_db from None
    finally:
        conn.close()


def _rollback_swap(state: AppState, old: Path, token: str) -> str:
    """Undo a failed swap: failed restore aside, original back, original reopened.

    Returns the error detail to report — the message differs when the rollback
    itself could not complete, because then only the user can recover the dir.
    """
    data_dir = state.data_dir
    failed = data_dir.parent / f".{data_dir.name}.failed-{token}"
    try:
        if data_dir.exists():
            os.rename(data_dir, failed)
        os.rename(old, data_dir)
        state.reopen()
    except Exception:
        return (
            "Restore failed and could not be undone automatically. Your original data "
            f"is intact in the folder {old.name} beside the data folder: stop SetMaster 3, "
            f"rename that folder back to {data_dir.name}, and start it again."
        )
    finally:
        shutil.rmtree(failed, ignore_errors=True)
    return (
        "Restore failed: the backup could not be opened, so your existing data was "
        "kept and nothing was changed."
    )


@router.post("/restore")
async def restore(file: UploadFile, state: AppState = Depends(get_state)) -> dict:
    if state.pipeline.is_running():
        raise HTTPException(status_code=409, detail="Cannot restore while a pipeline run is in progress")

    data_dir = state.data_dir
    token = uuid.uuid4().hex[:8]
    staging = data_dir.parent / f".{data_dir.name}.restore-{token}"

    # 1. save the upload to a temp file, then unpack + validate into staging
    fd, tmp_name = tempfile.mkstemp(prefix="sm3-restore-", suffix=".zip")
    try:
        with os.fdopen(fd, "wb") as out:
            shutil.copyfileobj(file.file, out)
        try:
            with zipfile.ZipFile(tmp_name) as zf:
                staging.mkdir(parents=True, exist_ok=True)
                _safe_extract(zf, staging)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Upload is not a valid zip file") from None

        db_file = staging / DB_FILENAME
        if not db_file.is_file():
            raise HTTPException(
                status_code=400,
                detail=f"Not a SetMaster 3 backup: zip does not contain {DB_FILENAME}",
            )
        _validate_backup_db(db_file)

        # 2. atomic swap: current dir aside -> staging in -> reopen; roll back on
        # failure. reopen() is *inside* the guarded block on purpose: a staged db
        # that validates but still fails to open must not be left live.
        _checkpoint(state)  # leave no dangling WAL in the outgoing dir
        old = data_dir.parent / f".{data_dir.name}.old-{token}"
        os.rename(data_dir, old)
        try:
            os.rename(staging, data_dir)
            state.reopen()
        except Exception:
            raise HTTPException(
                status_code=500, detail=_rollback_swap(state, old, token)
            ) from None
        except BaseException:
            _rollback_swap(state, old, token)
            raise
        shutil.rmtree(old, ignore_errors=True)
        return {"ok": True}
    finally:
        os.unlink(tmp_name)
        shutil.rmtree(staging, ignore_errors=True)
