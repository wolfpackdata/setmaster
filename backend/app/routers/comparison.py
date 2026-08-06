"""Exportify import + comparison endpoints (S8, S5)."""
from __future__ import annotations

import datetime

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import exportify as exp
from .. import pipeline_data
from ..config import downloads_dir
from ..pipeline_data import FLAG_GO_GET
from ..state import AppState
from ..util import (
    mtime_iso,
    normalize_playlist_name,
    now_iso,
    parse_iso,
)
from .deps import get_state

router = APIRouter(prefix="/api", tags=["comparison"])

STALE_AFTER_DAYS = 30


# --- exportify ---

@router.get("/exportify/candidates")
def candidates(state: AppState = Depends(get_state)) -> list[dict]:
    return exp.scan_candidates(downloads_dir(), state.pipeline_data.collection_playlists())


@router.post("/exportify/import")
def import_exportify(body: dict = Body(...), state: AppState = Depends(get_state)) -> dict:
    paths = body.get("paths")
    if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
        raise HTTPException(status_code=400, detail="body must be { paths: [str] }")
    try:
        return exp.import_files(state, paths)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.get("/exportify/imports")
def list_imports(state: AppState = Depends(get_state)) -> list[dict]:
    conn = state.db()
    try:
        return [
            dict(r)
            for r in conn.execute(
                "SELECT slug, display_name, original_filename, imported_at,"
                " source_mtime, row_count FROM exportify_imports ORDER BY imported_at DESC"
            )
        ]
    finally:
        conn.close()


# --- comparison overview / config ---

def _age_days(source_mtime_iso: str) -> int | None:
    dt = parse_iso(source_mtime_iso)
    if dt is None:
        return None
    now = datetime.datetime.now(datetime.timezone.utc)
    return max((now - dt).days, 0)


@router.get("/comparison/overview")
def overview(state: AppState = Depends(get_state)) -> dict:
    playlists = state.pipeline_data.collection_playlists() or []
    index = exp.traktor_name_index(playlists)
    conn = state.db()
    try:
        checked = {
            r["playlist_path"]
            for r in conn.execute("SELECT playlist_path FROM comparison_config")
        }
        imports = [
            dict(r)
            for r in conn.execute(
                "SELECT slug, display_name, original_filename, imported_at,"
                " source_mtime, row_count FROM exportify_imports ORDER BY display_name"
            )
        ]
    finally:
        conn.close()

    imports_by_norm: dict[str, dict] = {}
    for imp in imports:
        imports_by_norm.setdefault(normalize_playlist_name(imp["display_name"]), imp)
        imports_by_norm.setdefault(normalize_playlist_name(imp["slug"]), imp)

    traktor_out = []
    for p in playlists:
        is_checked = p["path"] in checked
        imp = imports_by_norm.get(normalize_playlist_name(p["name"]))
        if imp is None:
            coverage = {"state": "none", "text": "no Spotify data"}
        else:
            days = _age_days(imp["source_mtime"])
            if days is None:
                coverage = {"state": "stale", "text": "data age unknown"}
            else:
                coverage = {
                    "state": "fresh" if days <= STALE_AFTER_DAYS else "stale",
                    "text": "imported today" if days == 0 else f"data {days} days old",
                }
        traktor_out.append(
            {"path": p["path"], "name": p["name"], "checked": is_checked, "coverage": coverage}
        )

    spotify_out = []
    for imp in imports:
        m_state, hit, cands = exp.match_traktor(imp["slug"], index)
        if m_state == "none":  # also try the display name
            m_state, hit, cands = exp.match_traktor(imp["display_name"], index)
        match: dict = {"state": m_state}
        if m_state == "matched":
            match["traktor_path"] = hit["path"]
        elif m_state == "conflict":
            match["candidates"] = [c["path"] for c in cands]
        spotify_out.append(
            {
                "slug": imp["slug"],
                "display_name": imp["display_name"],
                "filename": imp["original_filename"],
                "imported_at": imp["imported_at"],
                "match": match,
            }
        )
    return {"traktor": traktor_out, "spotify": spotify_out}


@router.put("/comparison/config")
def put_config(body: dict = Body(...), state: AppState = Depends(get_state)) -> dict:
    paths = body.get("checked_paths")
    if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
        raise HTTPException(status_code=400, detail="body must be { checked_paths: [str] }")
    playlists = state.pipeline_data.collection_playlists() or []
    by_path = {p["path"]: p for p in playlists}
    conn = state.db()
    try:
        existing = {
            r["playlist_path"]: r["checked_at"]
            for r in conn.execute("SELECT playlist_path, checked_at FROM comparison_config")
        }
        ts = now_iso()
        with conn:
            conn.execute("DELETE FROM comparison_config")
            for path in dict.fromkeys(paths):  # de-dupe, keep order
                p = by_path.get(path)
                name = p["name"] if p else path.rsplit("/", 1)[-1]
                conn.execute(
                    "INSERT INTO comparison_config(playlist_path, display_name, checked_at)"
                    " VALUES (?,?,?)",
                    (path, name, existing.get(path, ts)),
                )
        return {"checked_paths": list(dict.fromkeys(paths))}
    finally:
        conn.close()


# --- comparison results (S5) ---

@router.get("/comparison/results/{slug}")
def results(slug: str, state: AppState = Depends(get_state)) -> dict:
    joined = pipeline_data.find_joined_file(state.work_dir, slug)
    if joined is None:
        raise HTTPException(
            status_code=404,
            detail=f"No comparison data for '{slug}' yet — run the pipeline first",
        )
    rows = pipeline_data.load_joined_rows(joined)

    conn = state.db()
    try:
        imp = conn.execute(
            "SELECT display_name, imported_at FROM exportify_imports WHERE slug = ?", (slug,)
        ).fetchone()
        notes = {
            (r["side"], r["join_key"]): r["text"]
            for r in conn.execute(
                "SELECT side, join_key, text FROM comparison_notes WHERE slug = ?", (slug,)
            )
        }
    finally:
        conn.close()

    stale = False
    if imp is not None:
        imported_at = parse_iso(imp["imported_at"])
        joined_at = parse_iso(mtime_iso(joined))
        if imported_at and joined_at and joined_at < imported_at:
            stale = True

    out_rows = []
    not_matched = 0
    for r in rows:
        flag = (r.get("presence_flag") or "").strip()
        if flag == FLAG_GO_GET:
            not_matched += 1
        spotify_join = (r.get("spotify_trackjoin") or "").strip()
        trak_join = (r.get("trak_trackjoin") or "").strip()
        traktor_title = (r.get("traktor_title") or "").strip()
        spotify_name = (r.get("spotify_track_name") or "").strip()
        # note lives on the blank cell; its key is the populated side's join key
        note = None
        if not traktor_title and spotify_join and ("traktor", spotify_join) in notes:
            note = {"text": notes[("traktor", spotify_join)], "side": "traktor"}
        elif not spotify_name and trak_join and ("spotify", trak_join) in notes:
            note = {"text": notes[("spotify", trak_join)], "side": "spotify"}
        file_paths = [
            p for p in (r.get("trak_collection_file_paths") or "").split("|") if p.strip()
        ]
        out_rows.append(
            {
                "flag": flag,
                "traktor_title": traktor_title,
                "spotify_track_name": spotify_name,
                # Additive pass-through of the joined-CSV artist/album fields
                # (issue #20) — the frontend "Columns" menu opts these in. All
                # four are already present in the stage-4 joined CSV header.
                "traktor_artists": (r.get("traktor_artists") or "").strip(),
                "spotify_artists": (r.get("spotify_artists") or "").strip(),
                "traktor_release_name": (r.get("traktor_release_name") or "").strip(),
                "spotify_album_name": (r.get("spotify_album_name") or "").strip(),
                "file_paths": file_paths,
                "spotify_uri": (r.get("spotify_uri") or "").strip(),
                "spotify_trackjoin": spotify_join,
                "trak_trackjoin": trak_join,
                "note": note,
            }
        )

    return {
        "display_name": imp["display_name"] if imp else slug,
        "generated_at": mtime_iso(joined),
        "stale": stale,
        "summary": {"total": len(out_rows), "not_matched": not_matched},
        "rows": out_rows,
    }


# --- comparison notes ---

@router.put("/comparison/notes")
def put_note(body: dict = Body(...), state: AppState = Depends(get_state)) -> dict:
    slug = body.get("slug")
    join_key = body.get("join_key")
    side = body.get("side")
    text = body.get("text", "")
    if not isinstance(slug, str) or not slug.strip():
        raise HTTPException(status_code=400, detail="slug must be a non-empty string")
    if not isinstance(join_key, str) or not join_key.strip():
        raise HTTPException(status_code=400, detail="join_key must be a non-empty string")
    if side not in ("traktor", "spotify"):
        raise HTTPException(status_code=400, detail="side must be 'traktor' or 'spotify'")
    if not isinstance(text, str):
        raise HTTPException(status_code=400, detail="text must be a string")
    conn = state.db()
    try:
        with conn:
            if text == "":
                conn.execute(
                    "DELETE FROM comparison_notes WHERE slug=? AND side=? AND join_key=?",
                    (slug, side, join_key),
                )
                return {"ok": True, "deleted": True}
            conn.execute(
                "INSERT INTO comparison_notes(slug, side, join_key, text, updated_at)"
                " VALUES (?,?,?,?,?)"
                " ON CONFLICT(slug, side, join_key) DO UPDATE SET"
                " text = excluded.text, updated_at = excluded.updated_at",
                (slug, side, join_key, text, now_iso()),
            )
            return {"ok": True, "deleted": False}
    finally:
        conn.close()
