"""Data-dir resolution and filesystem layout for SetMaster 3.

Layout under the app-data dir:
    setmaster3.db          -- SQLite store (WAL mode)
    raw-data/exportify/    -- imported Exportify CSVs, <slug>.csv, newest-only
    pipeline-work/         -- pipeline output dir (Traktor/, Joined/, ...)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

DB_FILENAME = "setmaster3.db"


def default_data_dir() -> Path:
    """Platform app-data dir, overridable via SM3_DATA_DIR (tests use tmp dirs)."""
    env = os.environ.get("SM3_DATA_DIR")
    if env:
        return Path(env)
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "SetMaster3"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "SetMaster3"
    # Linux/other fallback (not first-class, but don't break)
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "SetMaster3"


def downloads_dir() -> Path:
    """OS Downloads dir; overridable via SM3_DOWNLOADS_DIR (test seam)."""
    env = os.environ.get("SM3_DOWNLOADS_DIR")
    if env:
        return Path(env)
    return Path.home() / "Downloads"


def ensure_layout(data_dir: Path) -> None:
    (data_dir / "raw-data" / "exportify").mkdir(parents=True, exist_ok=True)
    (data_dir / "pipeline-work").mkdir(parents=True, exist_ok=True)


def db_path(data_dir: Path) -> Path:
    return data_dir / DB_FILENAME


def exportify_dir(data_dir: Path) -> Path:
    return data_dir / "raw-data" / "exportify"


def work_dir(data_dir: Path) -> Path:
    return data_dir / "pipeline-work"
