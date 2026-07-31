"""Matrix (S3) + track-search endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_settings
from ..state import AppState
from ..util import mtime_iso
from .deps import get_state

router = APIRouter(prefix="/api", tags=["matrix"])


@router.get("/matrix")
def matrix(state: AppState = Depends(get_state)) -> dict:
    data = state.pipeline_data.matrix()
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="No matrix data yet — run the pipeline (Read Collection & Remake Tables) first",
        )
    conn = state.db()
    try:
        root_folder = get_settings(conn)["super_playlist_folder"]
    finally:
        conn.close()
    playlists = state.pipeline_data.collection_playlists() or []
    by_path = {p["path"]: p for p in playlists}
    by_name: dict[str, dict] = {}
    for p in playlists:
        by_name.setdefault(p["name"], p)

    root_cf = root_folder.casefold()
    playlist_out = []
    for col in data["playlist_columns"]:
        # matrix columns may carry either the playlist path or (SM2-style) name
        p = by_path.get(col) or by_name.get(col)
        if p is not None:
            is_root = bool(root_cf) and p["folder"].casefold() == root_cf
            playlist_out.append({"path": p["path"], "name": p["name"], "is_root": is_root})
        else:
            playlist_out.append({"path": col, "name": col, "is_root": False})

    return {
        "generated_at": mtime_iso(state.pipeline_data.matrix_csv),
        "playlists": playlist_out,
        "rows": data["rows"],
    }


@router.get("/search/tracks")
def search_tracks(q: str = "", state: AppState = Depends(get_state)) -> list[dict]:
    if not q.strip():
        return []
    data = state.pipeline_data.matrix()
    if data is None:
        return []
    needle = q.strip().casefold()
    out = []
    seen: set[tuple[str, str]] = set()
    for row in data["rows"]:
        name, artist = row["name"], row["artist"]
        if needle in name.casefold() or needle in artist.casefold():
            key = (name, artist)
            if key in seen:
                continue
            seen.add(key)
            out.append({"name": name, "artist": artist})
            if len(out) >= 20:
                break
    return out
