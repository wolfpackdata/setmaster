"""Exportify import service (exportify-import.md §3-5, §7).

Downloads scan, header validation, slug derivation, newest-wins dedup, copy
into raw-data/exportify/<slug>.csv, metadata records, normalized-name matching
against the current Traktor collection, and comparison-config auto-add.
"""
from __future__ import annotations

import csv
import shutil
from pathlib import Path

from .util import (
    display_name_from_slug,
    mtime_iso,
    normalize_playlist_name,
    now_iso,
    slug_from_filename,
)

# minimal required header set (confirmed by Ry 2026-07-06)
REQUIRED_COLUMNS = {"Track URI", "Track Name", "Artist Name(s)", "Album Name", "Added At"}

# Batch-summary field separator, written as an explicit unicode escape so this
# source file stays pure ASCII and can never be re-saved in a non-UTF-8 encoding
# that would double-encode U+00B7 (the middle dot) into the mojibake seen by the
# frontend. The API emits clean UTF-8 bytes (0xC2 0xB7) regardless of tooling.
DOT = "\u00b7"  # MIDDLE DOT (U+00B7)


def read_header(path: Path) -> list[str] | None:
    try:
        with open(path, encoding="utf-8-sig", newline="") as f:
            return next(csv.reader(f), None)
    except (OSError, UnicodeDecodeError, csv.Error):
        return None


def is_exportify_csv(path: Path) -> bool:
    header = read_header(path)
    return header is not None and REQUIRED_COLUMNS.issubset(set(h.strip() for h in header))


def count_data_rows(path: Path) -> int:
    with open(path, encoding="utf-8-sig", newline="") as f:
        n = sum(1 for row in csv.reader(f) if row)
    return max(n - 1, 0)


def traktor_name_index(collection_playlists: list[dict] | None) -> dict[str, list[dict]]:
    """normalized playlist name -> [playlist dicts] (len>1 == conflict)."""
    index: dict[str, list[dict]] = {}
    for p in collection_playlists or []:
        index.setdefault(normalize_playlist_name(p["name"]), []).append(p)
    return index


def match_traktor(slug_or_name: str, index: dict[str, list[dict]]):
    """Returns (state, playlist|None, candidates). state: matched|none|conflict."""
    hits = index.get(normalize_playlist_name(slug_or_name), [])
    if len(hits) == 1:
        return "matched", hits[0], hits
    if len(hits) > 1:
        return "conflict", None, hits
    return "none", None, []


def scan_candidates(downloads: Path, collection_playlists: list[dict] | None) -> list[dict]:
    """Exportify-shaped CSV candidates in the Downloads dir, newest first."""
    if not downloads.is_dir():
        return []
    index = traktor_name_index(collection_playlists)
    out = []
    for p in downloads.iterdir():
        if not (p.is_file() and p.suffix.lower() == ".csv"):
            continue
        slug = slug_from_filename(p.name)
        state, hit, _cands = match_traktor(slug, index)
        display = hit["name"] if state == "matched" else display_name_from_slug(slug)
        st = p.stat()
        out.append(
            {
                "path": str(p),
                "filename": p.name,
                "mtime_iso": mtime_iso(p),
                "size": st.st_size,
                "slug": slug,
                "display_name": display,
                "valid": is_exportify_csv(p),
                "_mtime": st.st_mtime,
            }
        )
    out.sort(key=lambda c: c["_mtime"], reverse=True)
    for c in out:
        c.pop("_mtime")
    return out


def import_files(state, paths: list[str]) -> dict:
    """Import a batch of Exportify CSVs. Raises ValueError if zero valid files."""
    skipped: list[dict] = []
    valid: list[Path] = []
    for raw in paths:
        p = Path(raw)
        if not p.is_file():
            skipped.append({"path": raw, "reason": "file not found"})
        elif not is_exportify_csv(p):
            skipped.append({"path": raw, "reason": "not a valid Exportify CSV (header check failed)"})
        else:
            valid.append(p)

    # newest-wins dedup among same-slug selections
    by_slug: dict[str, Path] = {}
    for p in valid:
        slug = slug_from_filename(p.name)
        prev = by_slug.get(slug)
        if prev is None or p.stat().st_mtime > prev.stat().st_mtime:
            if prev is not None:
                skipped.append(
                    {"path": str(prev), "reason": f"older duplicate of '{slug}'"}
                )
            by_slug[slug] = p
        else:
            skipped.append({"path": str(p), "reason": f"older duplicate of '{slug}'"})

    if not by_slug:
        raise ValueError("No valid Exportify CSV files in the selection.")

    playlists = state.pipeline_data.collection_playlists()  # None -> no collection yet
    index = traktor_name_index(playlists)

    imported: list[dict] = []
    already_configured = 0
    not_found = 0
    conn = state.db()
    try:
        for slug in sorted(by_slug):
            src = by_slug[slug]
            dest = state.exportify_dir / f"{slug}.csv"
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)  # overwrite, keep latest only

            match_state, hit, _cands = match_traktor(slug, index)
            display = hit["name"] if match_state == "matched" else display_name_from_slug(slug)

            with conn:
                conn.execute(
                    "INSERT INTO exportify_imports"
                    "(slug, display_name, original_filename, imported_at, source_mtime, row_count)"
                    " VALUES (?,?,?,?,?,?)"
                    " ON CONFLICT(slug) DO UPDATE SET display_name=excluded.display_name,"
                    " original_filename=excluded.original_filename,"
                    " imported_at=excluded.imported_at, source_mtime=excluded.source_mtime,"
                    " row_count=excluded.row_count",
                    (slug, display, src.name, now_iso(), mtime_iso(src), count_data_rows(dest)),
                )

            added = False
            matched_path = None
            if match_state == "matched":
                matched_path = hit["path"]
                exists = conn.execute(
                    "SELECT 1 FROM comparison_config WHERE playlist_path=?", (matched_path,)
                ).fetchone()
                if exists:
                    already_configured += 1
                else:
                    with conn:
                        conn.execute(
                            "INSERT INTO comparison_config(playlist_path, display_name, checked_at)"
                            " VALUES (?,?,?)",
                            (matched_path, hit["name"], now_iso()),
                        )
                    added = True
            elif match_state == "none":
                not_found += 1
            # conflict: flagged in S8 (overview), never silently picked

            imported.append(
                {
                    "slug": slug,
                    "display_name": display,
                    "added_to_config": added,
                    "matched_traktor": matched_path,
                }
            )
    finally:
        conn.close()

    added_count = sum(1 for i in imported if i["added_to_config"])
    summary = (
        f"Imported {len(imported)} playlist{'s' if len(imported) != 1 else ''}"
        f" {DOT} {added_count} added to comparison"
        f" {DOT} {already_configured} already configured"
        f" {DOT} {not_found} not found in Traktor."
    )
    return {
        "imported": imported,
        "skipped": skipped,
        "already_configured": already_configured,
        "summary": summary,
    }
