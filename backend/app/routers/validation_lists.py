"""Validation-list endpoints (S6 Advanced)."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Body, Depends, HTTPException

from ..db import get_validation_lists
from ..defaults import FACTORY_VALIDATION_LISTS, FIELD_TO_ROW_COLUMN, VALIDATION_FIELDS
from ..state import AppState
from ..util import now_iso
from ..validation import validate_value, validate_values
from .deps import get_state

router = APIRouter(prefix="/api/validation-lists", tags=["validation-lists"])


def _check_field(field: str) -> None:
    if field not in VALIDATION_FIELDS:
        raise HTTPException(status_code=404, detail=f"Unknown validation-list field: {field}")


def _replace_list(conn: sqlite3.Connection, field: str, values: list[str]) -> None:
    conn.execute("DELETE FROM validation_lists WHERE field = ?", (field,))
    conn.executemany(
        "INSERT INTO validation_lists(field, position, value) VALUES (?,?,?)",
        [(field, i, v) for i, v in enumerate(values)],
    )


@router.get("")
def all_lists(state: AppState = Depends(get_state)) -> dict:
    conn = state.db()
    try:
        return get_validation_lists(conn)
    finally:
        conn.close()


@router.put("/{field}")
def put_list(field: str, body: dict = Body(...), state: AppState = Depends(get_state)) -> dict:
    _check_field(field)
    values = body.get("values")
    if not isinstance(values, list):
        raise HTTPException(status_code=400, detail="body must be { values: [str] }")
    try:
        canonical = validate_values(field, values)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    conn = state.db()
    try:
        with conn:
            _replace_list(conn, field, canonical)
        return {"field": field, "values": canonical}
    finally:
        conn.close()


@router.post("/{field}/rename")
def rename_value(field: str, body: dict = Body(...), state: AppState = Depends(get_state)) -> dict:
    _check_field(field)
    old = body.get("old")
    new = body.get("new")
    if not isinstance(old, str) or not isinstance(new, str):
        raise HTTPException(status_code=400, detail="body must be { old: str, new: str }")
    try:
        new_c = validate_value(field, new)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if new_c == old:
        raise HTTPException(status_code=400, detail="new value equals old value")
    col = FIELD_TO_ROW_COLUMN[field]
    conn = state.db()
    try:
        current = conn.execute(
            "SELECT position FROM validation_lists WHERE field = ? AND value = ?", (field, old)
        ).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail=f"Value not in {field} list: {old!r}")
        dup = conn.execute(
            "SELECT 1 FROM validation_lists WHERE field = ? AND value = ?", (field, new_c)
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail=f"Value already in {field} list: {new_c!r}")
        ts = now_iso()
        # one transaction: list label + every row in every set (active + archived)
        with conn:
            conn.execute(
                "UPDATE validation_lists SET value = ? WHERE field = ? AND value = ?",
                (new_c, field, old),
            )
            cur = conn.execute(
                f"UPDATE set_rows SET {col} = ? WHERE {col} = ?", (new_c, old)
            )
            rows_updated = cur.rowcount
            conn.execute(
                f"UPDATE sets SET modified_at = ? WHERE id IN "
                f"(SELECT DISTINCT set_id FROM set_rows WHERE {col} = ?)",
                (ts, new_c),
            )
            # track factory-value rename chains so Reset can revert them
            chained = conn.execute(
                "SELECT factory_value FROM validation_renames"
                " WHERE field = ? AND current_value = ?",
                (field, old),
            ).fetchone()
            factory_origin = None
            if chained:
                factory_origin = chained["factory_value"]
            elif old in FACTORY_VALIDATION_LISTS[field]:
                factory_origin = old
            if factory_origin is not None:
                if new_c == factory_origin:  # renamed back to its factory label
                    conn.execute(
                        "DELETE FROM validation_renames WHERE field = ? AND factory_value = ?",
                        (field, factory_origin),
                    )
                else:
                    conn.execute(
                        "INSERT INTO validation_renames(field, factory_value, current_value)"
                        " VALUES (?,?,?) ON CONFLICT(field, factory_value)"
                        " DO UPDATE SET current_value = excluded.current_value",
                        (field, factory_origin, new_c),
                    )
        return {"rows_updated": rows_updated, "old": old, "new": new_c}
    finally:
        conn.close()


@router.post("/{field}/reset")
def reset_list(field: str, state: AppState = Depends(get_state)) -> dict:
    _check_field(field)
    factory = FACTORY_VALIDATION_LISTS[field]
    col = FIELD_TO_ROW_COLUMN[field]
    conn = state.db()
    try:
        ts = now_iso()
        with conn:
            # renamed factory values revert per Rename semantics: the factory
            # label propagates back into every row (spec §3 Reset)
            renames = conn.execute(
                "SELECT factory_value, current_value FROM validation_renames WHERE field = ?",
                (field,),
            ).fetchall()
            for r in renames:
                conn.execute(
                    f"UPDATE set_rows SET {col} = ? WHERE {col} = ?",
                    (r["factory_value"], r["current_value"]),
                )
                conn.execute(
                    f"UPDATE sets SET modified_at = ? WHERE id IN "
                    f"(SELECT DISTINCT set_id FROM set_rows WHERE {col} = ?)",
                    (ts, r["factory_value"]),
                )
            conn.execute("DELETE FROM validation_renames WHERE field = ?", (field,))
            _replace_list(conn, field, factory)
        return {"field": field, "values": list(factory)}
    finally:
        conn.close()


@router.get("/{field}/usage")
def value_usage(field: str, value: str = "", state: AppState = Depends(get_state)) -> dict:
    _check_field(field)
    col = FIELD_TO_ROW_COLUMN[field]
    conn = state.db()
    try:
        count = conn.execute(
            f"SELECT COUNT(*) FROM set_rows WHERE {col} = ?", (value,)
        ).fetchone()[0]
        return {"count": count}
    finally:
        conn.close()
