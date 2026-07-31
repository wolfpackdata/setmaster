"""Backend file browser + reveal-in-file-manager."""
from __future__ import annotations

import stat as _stat
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException

from ..config import downloads_dir
from ..util import mtime_iso

router = APIRouter(prefix="/api/fs", tags=["fs"])

# Windows keeps legacy per-user junctions ("My Documents", "Application Data",
# "Cookies", "NetHood", …) purely for backward compat. They are flagged
# Hidden+System and *deny enumeration*, so listing one raises PermissionError.
# Explorer hides them; we do too, so a user never lands on an unusable 403.
_WIN_HIDDEN = getattr(_stat, "FILE_ATTRIBUTE_HIDDEN", 0x2) | getattr(
    _stat, "FILE_ATTRIBUTE_SYSTEM", 0x4
)


def _is_hidden(p: Path) -> bool:
    """Dotfiles everywhere; Hidden/System entries on Windows (matches Explorer)."""
    if p.name.startswith("."):
        return True
    if sys.platform == "win32":
        try:
            attrs = p.lstat().st_file_attributes  # no reparse-point follow
        except OSError:
            return False
        return bool(attrs & _WIN_HIDDEN)
    return False


def _entry(p: Path) -> dict:
    try:
        st = p.stat()
        return {
            "name": p.name,
            "path": str(p),
            "is_dir": p.is_dir(),
            "mtime_iso": mtime_iso(p),
            "size": 0 if p.is_dir() else st.st_size,
        }
    except OSError:
        return {"name": p.name, "path": str(p), "is_dir": p.is_dir(), "mtime_iso": None, "size": 0}


@router.get("/list")
def fs_list(path: str = "") -> dict:
    base = Path(path) if path else Path.home()
    if not base.is_dir():
        raise HTTPException(status_code=404, detail=f"Not a directory: {base}")
    try:
        children = [c for c in base.iterdir() if not _is_hidden(c)]
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Permission denied: {base}") from None
    children.sort(key=lambda c: (not c.is_dir(), c.name.casefold()))
    entries = [_entry(c) for c in children]
    if not path:
        # empty path -> OS home + quick link to Downloads first
        dl = downloads_dir()
        if dl.is_dir():
            entries = [e for e in entries if e["path"] != str(dl)]
            entries.insert(0, _entry(dl))
    parent = str(base.parent) if base.parent != base else None
    return {"path": str(base), "parent": parent, "entries": entries}


@router.post("/reveal")
def fs_reveal(body: dict = Body(...)) -> dict:
    path = body.get("path") or ""
    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {path}")
    if sys.platform == "win32":
        subprocess.Popen(["explorer", f"/select,{p}"])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(p.parent if p.is_file() else p)])
    return {"ok": True}
