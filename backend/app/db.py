"""SQLite storage: schema, connection helpers, settings accessors.

WAL mode; short-lived connections per operation; every multi-statement write
runs in a single transaction so a crash mid-write never half-applies.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from .defaults import DEFAULT_SETTINGS, FACTORY_VALIDATION_LISTS

SCHEMA = """
CREATE TABLE IF NOT EXISTS sets (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    folder        TEXT,
    created_at    TEXT NOT NULL,
    modified_at   TEXT NOT NULL,
    archived      INTEGER NOT NULL DEFAULT 0,
    archived_at   TEXT,
    export_filename TEXT
);

CREATE TABLE IF NOT EXISTS set_rows (
    set_id     TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
    row_id     TEXT NOT NULL,
    position   INTEGER NOT NULL,
    bpm        TEXT NOT NULL DEFAULT '',
    key        TEXT NOT NULL DEFAULT '',
    in_name    TEXT NOT NULL DEFAULT '',
    in_delta   TEXT NOT NULL DEFAULT '---',
    m_num      TEXT NOT NULL DEFAULT '---',
    t_num      TEXT NOT NULL DEFAULT '---',
    a_num      TEXT NOT NULL DEFAULT '---',
    lows       TEXT NOT NULL DEFAULT '',
    level      TEXT NOT NULL DEFAULT '',
    swap_lows  TEXT NOT NULL DEFAULT '---',
    i_like     TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    start      TEXT NOT NULL DEFAULT '',
    transition TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (set_id, row_id)
);
CREATE INDEX IF NOT EXISTS idx_set_rows_order ON set_rows(set_id, position);

CREATE TABLE IF NOT EXISTS set_formatting (
    set_id TEXT PRIMARY KEY REFERENCES sets(id) ON DELETE CASCADE,
    data   TEXT NOT NULL  -- JSON {fills:[{row_id,col,color}], boxes:[{row_ids,cols}]}
);

CREATE TABLE IF NOT EXISTS validation_lists (
    field    TEXT NOT NULL,
    position INTEGER NOT NULL,
    value    TEXT NOT NULL,
    PRIMARY KEY (field, value)
);

-- provenance of renamed factory values, so Reset can propagate factory
-- labels back into rows (advanced-settings spec §3 Reset semantics)
CREATE TABLE IF NOT EXISTS validation_renames (
    field         TEXT NOT NULL,
    factory_value TEXT NOT NULL,
    current_value TEXT NOT NULL,
    PRIMARY KEY (field, factory_value)
);

CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL  -- JSON
);

CREATE TABLE IF NOT EXISTS comparison_config (
    playlist_path TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    checked_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exportify_imports (
    slug              TEXT PRIMARY KEY,
    display_name      TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    imported_at       TEXT NOT NULL,
    source_mtime      TEXT NOT NULL,
    row_count         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comparison_notes (
    slug       TEXT NOT NULL,
    side       TEXT NOT NULL CHECK (side IN ('traktor','spotify')),
    join_key   TEXT NOT NULL,
    text       TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (slug, side, join_key)
);
"""


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        with conn:
            # seed factory validation lists on first run only
            for field, values in FACTORY_VALIDATION_LISTS.items():
                n = conn.execute(
                    "SELECT COUNT(*) FROM validation_lists WHERE field = ?", (field,)
                ).fetchone()[0]
                if n == 0:
                    conn.executemany(
                        "INSERT INTO validation_lists(field, position, value) VALUES (?,?,?)",
                        [(field, i, v) for i, v in enumerate(values)],
                    )
            if conn.execute("SELECT 1 FROM kv WHERE key='settings'").fetchone() is None:
                conn.execute(
                    "INSERT INTO kv(key, value) VALUES ('settings', ?)",
                    (json.dumps(DEFAULT_SETTINGS),),
                )
            # A short-lived first attempt at #163 seeded the full -12…+12
            # semitone range into EXISTING databases on startup. The ruling was
            # the opposite — the wide range is what a user MAY add, while the
            # factory default stays narrow — so the migration is gone. Only its
            # marker is cleaned up here: the values it added are user data now
            # and are never removed automatically. `Reset to factory` on the Δ
            # list is the user-initiated way back to the seven.
            conn.execute("DELETE FROM kv WHERE key = 'migration:delta_semitone_range'")
    finally:
        conn.close()


# --- kv helpers ---

def kv_get(conn: sqlite3.Connection, key: str, default=None):
    row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def kv_set(conn: sqlite3.Connection, key: str, value) -> None:
    with conn:
        conn.execute(
            "INSERT INTO kv(key, value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )


def _migrate_display(display: dict) -> dict:
    """Issue #78 / ruling R3: the legacy inverse `text_zoom` key becomes a direct
    `line_spacing` percentage. On first load of a pre-#78 settings file, convert
    (`spacing ≈ 10000 / text_zoom`, snapped to step 10, clamped 70–150) so the
    grid keeps roughly its old visual density — never-lose-user-data. Idempotent:
    a file that already carries `line_spacing` is returned untouched, and the
    stray `text_zoom` key is dropped so it can never resurface.
    """
    if "line_spacing" in display or "text_zoom" not in display:
        out = {k: v for k, v in display.items() if k != "text_zoom"}
        return out
    out = {k: v for k, v in display.items() if k != "text_zoom"}
    z = display.get("text_zoom")
    if isinstance(z, (int, float)) and z:
        spacing = round(10000 / z / 10) * 10  # snap to the 10% step grid
        spacing = max(70, min(150, spacing))  # clamp to the 70–150 range
        out["line_spacing"] = int(spacing)
    return out


def get_settings(conn: sqlite3.Connection) -> dict:
    s = kv_get(conn, "settings") or {}
    # deep-fill defaults so schema growth never breaks readers
    merged = json.loads(json.dumps(DEFAULT_SETTINGS))
    for k, v in s.items():
        if k == "display" and isinstance(v, dict):
            merged["display"].update(_migrate_display(v))
        else:
            merged[k] = v
    return merged


def get_validation_lists(conn: sqlite3.Connection) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {f: [] for f in FACTORY_VALIDATION_LISTS}
    for row in conn.execute(
        "SELECT field, value FROM validation_lists ORDER BY field, position"
    ):
        out.setdefault(row["field"], []).append(row["value"])
    return out
