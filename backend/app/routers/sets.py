"""Sets (S2) endpoints: lifecycle, rows, formatting, archive.

Seam note: POST /api/sets/{id}/export (three-format export) is a phase-3
module — it will mount on this router next to export-filename below.
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, HTTPException
from starlette.responses import Response

from ..defaults import EXPORT_FORMATS, KEY_DISPLAY_VALUES, ROW_FIELDS
from ..export import MEDIA_TYPE, export_filename_for, render_export
from ..state import AppState
from ..util import now_iso
from .deps import get_state

router = APIRouter(prefix="/api/sets", tags=["sets"])

MAX_NAME_LEN = 100


def _validate_name(name) -> str:
    if not isinstance(name, str):
        raise HTTPException(status_code=400, detail="Set name must be a string")
    trimmed = name.strip()
    if not trimmed:
        raise HTTPException(status_code=400, detail="Set name must not be empty")
    if len(trimmed) > MAX_NAME_LEN:
        raise HTTPException(status_code=400, detail=f"Set name exceeds {MAX_NAME_LEN} characters")
    return trimmed


def _active_name_taken(conn: sqlite3.Connection, name: str, exclude_id: str | None = None) -> bool:
    q = "SELECT 1 FROM sets WHERE archived = 0 AND name = ?"
    args: list = [name]
    if exclude_id:
        q += " AND id != ?"
        args.append(exclude_id)
    return conn.execute(q, args).fetchone() is not None


def _get_set(conn: sqlite3.Connection, set_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM sets WHERE id = ?", (set_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Set not found: {set_id}")
    return row


def _track_count(conn: sqlite3.Connection, set_id: str) -> int:
    # SM2 semantics: '# Tracks' counts rows with a non-empty In-Track name
    return conn.execute(
        "SELECT COUNT(*) FROM set_rows WHERE set_id = ? AND TRIM(in_name) != ''",
        (set_id,),
    ).fetchone()[0]


def _meta(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "folder": row["folder"],
        "created_at": row["created_at"],
        "modified_at": row["modified_at"],
        "archived": bool(row["archived"]),
        "archived_at": row["archived_at"],
        "track_count": _track_count(conn, row["id"]),
    }


def _rows(conn: sqlite3.Connection, set_id: str) -> list[dict]:
    out = []
    for r in conn.execute(
        "SELECT * FROM set_rows WHERE set_id = ? ORDER BY position", (set_id,)
    ):
        d = {"id": r["row_id"]}
        for f in ROW_FIELDS:
            d[f] = r[f]
        out.append(d)
    return out


def _formatting(conn: sqlite3.Connection, set_id: str) -> dict:
    row = conn.execute("SELECT data FROM set_formatting WHERE set_id = ?", (set_id,)).fetchone()
    return json.loads(row["data"]) if row else {"fills": [], "boxes": []}


def _require_active(row: sqlite3.Row) -> None:
    if row["archived"]:
        raise HTTPException(status_code=409, detail="Set is archived — restore it first")


@router.get("")
def list_sets(archived: bool = False, state: AppState = Depends(get_state)) -> list[dict]:
    conn = state.db()
    try:
        order = "archived_at DESC" if archived else "name COLLATE NOCASE"
        rows = conn.execute(
            f"SELECT * FROM sets WHERE archived = ? ORDER BY {order}", (1 if archived else 0,)
        ).fetchall()
        return [_meta(conn, r) for r in rows]
    finally:
        conn.close()


@router.post("", status_code=201)
def create_set(body: dict = Body(...), state: AppState = Depends(get_state)) -> dict:
    name = _validate_name(body.get("name"))
    folder = body.get("folder")
    if folder is not None and not isinstance(folder, str):
        raise HTTPException(status_code=400, detail="folder must be a string")
    conn = state.db()
    try:
        if _active_name_taken(conn, name):
            raise HTTPException(status_code=409, detail=f"An active set named '{name}' already exists")
        set_id = uuid.uuid4().hex
        ts = now_iso()
        with conn:
            conn.execute(
                "INSERT INTO sets(id, name, folder, created_at, modified_at, archived) "
                "VALUES (?,?,?,?,?,0)",
                (set_id, name, folder, ts, ts),
            )
        return _meta(conn, _get_set(conn, set_id))
    finally:
        conn.close()


@router.get("/{set_id}")
def read_set(set_id: str, state: AppState = Depends(get_state)) -> dict:
    conn = state.db()
    try:
        row = _get_set(conn, set_id)
        out = _meta(conn, row)
        out["rows"] = _rows(conn, set_id)
        out["formatting"] = _formatting(conn, set_id)
        out["export_filename"] = row["export_filename"]
        return out
    finally:
        conn.close()


@router.patch("/{set_id}")
def patch_set(set_id: str, body: dict = Body(...), state: AppState = Depends(get_state)) -> dict:
    conn = state.db()
    try:
        row = _get_set(conn, set_id)
        _require_active(row)
        updates: dict = {}
        if "name" in body:
            name = _validate_name(body["name"])
            if _active_name_taken(conn, name, exclude_id=set_id):
                raise HTTPException(
                    status_code=409, detail=f"An active set named '{name}' already exists"
                )
            updates["name"] = name
        if "folder" in body:
            folder = body["folder"]
            if folder is not None and not isinstance(folder, str):
                raise HTTPException(status_code=400, detail="folder must be a string")
            updates["folder"] = folder
        if updates:
            updates["modified_at"] = now_iso()
            cols = ", ".join(f"{k} = ?" for k in updates)
            with conn:
                conn.execute(f"UPDATE sets SET {cols} WHERE id = ?", (*updates.values(), set_id))
        return _meta(conn, _get_set(conn, set_id))
    finally:
        conn.close()


@router.post("/{set_id}/duplicate", status_code=201)
def duplicate_set(set_id: str, state: AppState = Depends(get_state)) -> dict:
    conn = state.db()
    try:
        row = _get_set(conn, set_id)
        _require_active(row)
        base = row["name"]
        n = 2
        name = f"{base} ({n})"
        while _active_name_taken(conn, name) or len(name) > MAX_NAME_LEN:
            if len(name) > MAX_NAME_LEN:
                base = base[: MAX_NAME_LEN - 8]
            n += 1
            name = f"{base} ({n})"
        new_id = uuid.uuid4().hex
        ts = now_iso()
        with conn:
            conn.execute(
                "INSERT INTO sets(id, name, folder, created_at, modified_at, archived, export_filename)"
                " VALUES (?,?,?,?,?,0,?)",
                (new_id, name, row["folder"], ts, ts, row["export_filename"]),
            )
            conn.execute(
                "INSERT INTO set_rows SELECT ?, row_id, position, bpm, key, in_name, in_delta,"
                " m_num, t_num, a_num, lows, level, swap_lows, i_like, notes, start, transition"
                " FROM set_rows WHERE set_id = ?",
                (new_id, set_id),
            )
            fmt = conn.execute(
                "SELECT data FROM set_formatting WHERE set_id = ?", (set_id,)
            ).fetchone()
            if fmt:
                conn.execute(
                    "INSERT INTO set_formatting(set_id, data) VALUES (?,?)", (new_id, fmt["data"])
                )
        return _meta(conn, _get_set(conn, new_id))
    finally:
        conn.close()


@router.put("/{set_id}/rows")
def put_rows(set_id: str, rows: list = Body(...), state: AppState = Depends(get_state)) -> dict:
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="Body must be the full ordered row list")
    conn = state.db()
    try:
        row = _get_set(conn, set_id)
        _require_active(row)
        seen: set[str] = set()
        records = []
        for pos, r in enumerate(rows):
            if not isinstance(r, dict):
                raise HTTPException(status_code=400, detail=f"Row {pos} must be an object")
            rid = r.get("id")
            if not isinstance(rid, str) or not rid:
                raise HTTPException(status_code=400, detail=f"Row {pos} is missing a string id")
            if rid in seen:
                raise HTTPException(status_code=400, detail=f"Duplicate row id: {rid}")
            seen.add(rid)
            values = [str(r.get(f, "") if r.get(f) is not None else "") for f in ROW_FIELDS]
            records.append((set_id, rid, pos, *values))
        ts = now_iso()
        with conn:
            conn.execute("DELETE FROM set_rows WHERE set_id = ?", (set_id,))
            conn.executemany(
                "INSERT INTO set_rows(set_id, row_id, position, "
                + ", ".join(ROW_FIELDS)
                + ") VALUES (" + ",".join("?" * (3 + len(ROW_FIELDS))) + ")",
                records,
            )
            conn.execute("UPDATE sets SET modified_at = ? WHERE id = ?", (ts, set_id))
        return {"ok": True, "row_count": len(records), "track_count": _track_count(conn, set_id), "modified_at": ts}
    finally:
        conn.close()


@router.put("/{set_id}/formatting")
def put_formatting(set_id: str, body: dict = Body(...), state: AppState = Depends(get_state)) -> dict:
    fills = body.get("fills", [])
    boxes = body.get("boxes", [])
    if not isinstance(fills, list) or not isinstance(boxes, list):
        raise HTTPException(status_code=400, detail="formatting must have list fields 'fills' and 'boxes'")
    for f in fills:
        if (
            not isinstance(f, dict)
            or not isinstance(f.get("row_id"), str)
            or not isinstance(f.get("col"), str)
            or f.get("color") not in ("red", "yellow")
        ):
            raise HTTPException(
                status_code=400,
                detail="each fill needs row_id: str, col: str, color: 'red'|'yellow'",
            )
    for b in boxes:
        if (
            not isinstance(b, dict)
            or not isinstance(b.get("row_ids"), list)
            or not isinstance(b.get("cols"), list)
            or not all(isinstance(x, str) for x in b["row_ids"] + b["cols"])
        ):
            raise HTTPException(
                status_code=400, detail="each box needs row_ids: [str] and cols: [str]"
            )
    conn = state.db()
    try:
        row = _get_set(conn, set_id)
        _require_active(row)
        ts = now_iso()
        with conn:
            conn.execute(
                "INSERT INTO set_formatting(set_id, data) VALUES (?,?)"
                " ON CONFLICT(set_id) DO UPDATE SET data = excluded.data",
                (set_id, json.dumps({"fills": fills, "boxes": boxes})),
            )
            conn.execute("UPDATE sets SET modified_at = ? WHERE id = ?", (ts, set_id))
        return {"ok": True, "modified_at": ts}
    finally:
        conn.close()


@router.patch("/{set_id}/export-filename")
def patch_export_filename(
    set_id: str, body: dict = Body(...), state: AppState = Depends(get_state)
) -> dict:
    filename = body.get("filename")
    if not isinstance(filename, str) or not filename.strip():
        raise HTTPException(status_code=400, detail="filename must be a non-empty string")
    conn = state.db()
    try:
        _get_set(conn, set_id)
        with conn:
            conn.execute(
                "UPDATE sets SET export_filename = ? WHERE id = ?", (filename.strip(), set_id)
            )
        return {"ok": True, "export_filename": filename.strip()}
    finally:
        conn.close()


@router.post("/{set_id}/export")
def export_set(
    set_id: str, body: dict = Body(...), state: AppState = Depends(get_state)
) -> Response:
    # Seam note (top of file): three-format export mounts here, next to
    # export-filename above. Generation is server-side (app/export.py).
    fmt = body.get("format")
    if fmt not in EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail=f"format must be one of {list(EXPORT_FORMATS)}")
    key_display_as = body.get("key_display_as")
    if key_display_as not in KEY_DISPLAY_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"key_display_as must be one of {list(KEY_DISPLAY_VALUES)}",
        )
    conn = state.db()
    try:
        row = _get_set(conn, set_id)
        name = row["name"]
        export_filename = row["export_filename"]
        rows = _rows(conn, set_id)
        formatting = _formatting(conn, set_id)
    finally:
        conn.close()

    content = render_export(fmt, name, rows, formatting, key_display_as)
    filename = export_filename_for(export_filename, name, fmt)
    # latin-1-safe ASCII fallback + RFC 5987 filename* for non-ASCII names.
    ascii_name = re.sub(r"[^\x20-\x7e]", "_", filename).replace('"', "'")
    disposition = (
        f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
    )
    return Response(
        content=content,
        media_type=MEDIA_TYPE[fmt],
        headers={"Content-Disposition": disposition},
    )


@router.post("/{set_id}/archive")
def archive_set(set_id: str, state: AppState = Depends(get_state)) -> dict:
    conn = state.db()
    try:
        row = _get_set(conn, set_id)
        if row["archived"]:
            raise HTTPException(status_code=409, detail="Set is already archived")
        with conn:
            conn.execute(
                "UPDATE sets SET archived = 1, archived_at = ? WHERE id = ?",
                (now_iso(), set_id),
            )
        return _meta(conn, _get_set(conn, set_id))
    finally:
        conn.close()


@router.post("/{set_id}/restore")
def restore_set(
    set_id: str, body: dict | None = Body(None), state: AppState = Depends(get_state)
) -> dict:
    body = body or {}
    conn = state.db()
    try:
        row = _get_set(conn, set_id)
        if not row["archived"]:
            raise HTTPException(status_code=409, detail="Set is not archived")
        name = row["name"]
        new_name = body.get("new_name")
        if new_name is not None:
            name = _validate_name(new_name)
        if _active_name_taken(conn, name):
            raise HTTPException(
                status_code=409,
                detail=f"An active set named '{name}' already exists — restore with new_name",
            )
        with conn:
            conn.execute(
                "UPDATE sets SET archived = 0, archived_at = NULL, name = ?, modified_at = ?"
                " WHERE id = ?",
                (name, now_iso(), set_id),
            )
        return _meta(conn, _get_set(conn, set_id))
    finally:
        conn.close()


@router.delete("/{set_id}")
def delete_set(set_id: str, state: AppState = Depends(get_state)) -> dict:
    conn = state.db()
    try:
        row = _get_set(conn, set_id)
        if not row["archived"]:
            raise HTTPException(
                status_code=409, detail="Only archived sets can be permanently deleted"
            )
        with conn:  # atomic: rows + formatting cascade with the set
            conn.execute("DELETE FROM sets WHERE id = ?", (set_id,))
        return {"ok": True}
    finally:
        conn.close()
