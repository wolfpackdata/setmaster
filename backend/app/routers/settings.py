"""Settings + status endpoints (api-contract.md 'Settings & status')."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import APP_VERSION, instance
from ..db import get_settings, kv_get, kv_set
from ..defaults import EXPORT_FORMATS, KEY_DISPLAY_VALUES
from ..state import AppState
from ..util import mtime_iso
from .deps import get_state

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/settings")
def read_settings(state: AppState = Depends(get_state)) -> dict:
    conn = state.db()
    try:
        return get_settings(conn)
    finally:
        conn.close()


def _bad(msg: str):
    raise HTTPException(status_code=400, detail=msg)


@router.put("/settings")
def update_settings(body: dict = Body(...), state: AppState = Depends(get_state)) -> dict:
    if not isinstance(body, dict):
        _bad("settings body must be an object")
    conn = state.db()
    try:
        current = get_settings(conn)

        if "collection_nml_path" in body:
            p = body["collection_nml_path"]
            if not isinstance(p, str):
                _bad("collection_nml_path must be a string")
            if p and os.path.basename(p) != "collection.nml":
                _bad("collection_nml_path must point at a file named exactly 'collection.nml'")
            current["collection_nml_path"] = p

        if "super_playlist_folder" in body:
            v = body["super_playlist_folder"]
            if not isinstance(v, str):
                _bad("super_playlist_folder must be a string")
            current["super_playlist_folder"] = v

        if "exclude_prefixes" in body:
            v = body["exclude_prefixes"]
            if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
                _bad("exclude_prefixes must be a list of strings")
            current["exclude_prefixes"] = v

        if "display" in body:
            d = body["display"]
            if not isinstance(d, dict):
                _bad("display must be an object")
            disp = current["display"]
            if "line_spacing" in d:
                z = d["line_spacing"]
                if not isinstance(z, int) or not (70 <= z <= 150):
                    _bad("display.line_spacing must be an integer 70–150")
                disp["line_spacing"] = z
            if "font_size" in d:
                fs = d["font_size"]
                if not isinstance(fs, int) or not (10 <= fs <= 20):
                    _bad("display.font_size must be an integer 10–20")
                disp["font_size"] = fs
            if "key_display_as" in d:
                k = d["key_display_as"]
                if k not in KEY_DISPLAY_VALUES:
                    _bad(f"display.key_display_as must be one of {list(KEY_DISPLAY_VALUES)}")
                disp["key_display_as"] = k
            if "colorful_keys" in d:
                c = d["colorful_keys"]
                if not isinstance(c, bool):
                    _bad("display.colorful_keys must be a boolean")
                disp["colorful_keys"] = c
            if "matrix_zoom" in d:
                # Issue #81: grid-only matrix zoom, 50–150 (step 10 is a UI
                # concern; the API accepts any integer in range).
                mz = d["matrix_zoom"]
                if not isinstance(mz, int) or isinstance(mz, bool) or not (50 <= mz <= 150):
                    _bad("display.matrix_zoom must be an integer 50–150")
                disp["matrix_zoom"] = mz
            # Issue #140: S2 column visibility, app-wide alongside Spacing /
            # Font Size.
            for flag in (
                "show_timing_columns",
                "show_mix_timer_column",
                "loud_t_column",       # issue #145
                "loud_m_column",       # issue #145
            ):
                if flag in d:
                    v = d[flag]
                    if not isinstance(v, bool):
                        _bad(f"display.{flag} must be a boolean")
                    disp[flag] = v

        if "last_export_format" in body:
            f = body["last_export_format"]
            if f not in EXPORT_FORMATS:
                _bad(f"last_export_format must be one of {list(EXPORT_FORMATS)}")
            current["last_export_format"] = f

        kv_set(conn, "settings", current)
        return current
    finally:
        conn.close()


@router.get("/status")
def status(state: AppState = Depends(get_state)) -> dict:
    conn = state.db()
    try:
        settings = get_settings(conn)
        meta = kv_get(conn, "collection_meta") or {}
    finally:
        conn.close()
    path = settings["collection_nml_path"]
    p = Path(path) if path else None
    exists = bool(p and p.is_file())
    return {
        "app_version": APP_VERSION,
        "app_data_dir": str(state.data_dir),
        # identity of this server process, so a stopper can prove ownership
        # before terminating anything (#181)
        "instance": instance.info(),
        "collection": {
            "path": path,
            "exists": exists,
            "mtime_iso": mtime_iso(p) if exists else None,
            "last_read_iso": meta.get("last_read_iso"),
            "track_count": meta.get("track_count"),
        },
        "pipeline": state.pipeline.status(),
    }
