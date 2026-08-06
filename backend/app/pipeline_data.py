"""Readers over pipeline output CSVs (BOM-tolerant), with mtime-keyed caches.

The pipeline regenerates these files; the app only reads them. Caches key on
(path, mtime_ns, size) so a new pipeline run invalidates automatically and
tens of thousands of matrix rows are parsed once, not per request.
"""
from __future__ import annotations

import csv
import threading
from pathlib import Path

from .util import normalize_playlist_name

MATRIX_FIXED_COLUMNS = [
    "Track Key", "Import Date", "Release Date", "Last Played", "Play Count",
    "BPM", "Key", "Album Title", "Artist Name", "Track Name",
    "On Root PL", "On Non-Root PL",
]

GAP_RESOLVED_FLAG = "Yes-Trak-Playlist"
FLAG_GO_GET = "Not-Trak-Collection"
FLAG_ORGANIZE = "Not-Trak-Playlist / Yes-Trak-Collection"


def _file_sig(path: Path):
    st = path.stat()
    return (str(path), st.st_mtime_ns, st.st_size)


class _MtimeCache:
    """One-slot cache: (signature, value)."""

    def __init__(self, loader):
        self._loader = loader
        self._lock = threading.Lock()
        self._sig = None
        self._value = None

    def get(self, path: Path):
        if not path.is_file():
            return None
        sig = _file_sig(path)
        with self._lock:
            if sig == self._sig:
                return self._value
        value = self._loader(path)
        with self._lock:
            self._sig = sig
            self._value = value
        return value

    def invalidate(self):
        with self._lock:
            self._sig = None
            self._value = None


# --- collection playlists (Traktor/traktor_collection_playlists.csv) ---

def _load_playlists(path: Path) -> list[dict]:
    """Unique playlists (path/name/folder) in first-appearance order."""
    seen: dict[str, dict] = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            p = (row.get("playlist_path") or "").strip()
            if not p or p in seen:
                continue
            seen[p] = {
                "path": p,
                "name": (row.get("playlist_name") or "").strip(),
                "folder": (row.get("playlist_folder") or "").strip(),
            }
    return list(seen.values())


# --- matrix (Traktor/traktor_track_playlist_matrix.csv) ---

def _num(s: str, cast):
    try:
        return cast(s)
    except (ValueError, TypeError):
        return None


def _load_matrix(path: Path) -> dict:
    """Parse the matrix CSV into {playlist_columns: [str], rows: [dict]}."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if header is None:
            return {"playlist_columns": [], "rows": []}
        idx: dict[str, int] = {}
        for col in MATRIX_FIXED_COLUMNS:
            if col not in header:
                raise ValueError(f"matrix CSV missing column {col!r}")
            idx[col] = header.index(col)
        fixed_idx = set(idx.values())
        playlist_cols = [(i, h) for i, h in enumerate(header) if i not in fixed_idx]

        rows = []
        for rec in reader:
            if not rec:
                continue

            def g(col: str) -> str:
                i = idx[col]
                return rec[i] if i < len(rec) else ""

            track_key = g("Track Key")
            membership = [
                pi for pi, (ci, _h) in enumerate(playlist_cols)
                if ci < len(rec) and rec[ci].strip()
            ]
            key = g("Key").strip()
            rows.append({
                "tk": track_key,
                "name": g("Track Name"),
                "artist": g("Artist Name"),
                "album": g("Album Title"),
                "bpm": _num(g("BPM"), float),
                "key": key or None,
                "import_date": g("Import Date"),
                "release_date": g("Release Date"),
                "last_played": g("Last Played"),
                "playcount": _num(g("Play Count"), lambda s: int(float(s))) or 0,
                "root": _num(g("On Root PL"), lambda s: int(float(s))) or 0,
                "nonroot": _num(g("On Non-Root PL"), lambda s: int(float(s))) or 0,
                # full_path derivation mirrors SM2 stage 1: '/:' separators -> '\'
                "file_path": track_key.replace("/:", "\\"),
                "m": membership,
            })
    return {"playlist_columns": [h for _i, h in playlist_cols], "rows": rows}


# --- joined CSVs (Joined/joined_<name>.csv) ---

def load_joined_rows(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [dict(r) for r in csv.DictReader(f)]


def find_joined_file(work_dir: Path, slug: str) -> Path | None:
    """Locate the joined CSV for an Exportify slug (filenames use normalized names)."""
    joined = work_dir / "Joined"
    direct = joined / f"joined_{slug}.csv"
    if direct.is_file():
        return direct
    if not joined.is_dir():
        return None
    want = normalize_playlist_name(slug)
    for p in sorted(joined.glob("joined_*.csv")):
        stem = p.stem[len("joined_"):]
        if normalize_playlist_name(stem) == want:
            return p
    return None


class PipelineData:
    """Facade over the pipeline-work dir with caches."""

    def __init__(self, work_dir: Path):
        self.work_dir = work_dir
        self._playlists_cache = _MtimeCache(_load_playlists)
        self._matrix_cache = _MtimeCache(_load_matrix)

    @property
    def playlists_csv(self) -> Path:
        return self.work_dir / "Traktor" / "traktor_collection_playlists.csv"

    @property
    def tracks_csv(self) -> Path:
        return self.work_dir / "Traktor" / "traktor_collection_tracks.csv"

    @property
    def matrix_csv(self) -> Path:
        return self.work_dir / "Traktor" / "traktor_track_playlist_matrix.csv"

    def collection_playlists(self) -> list[dict] | None:
        """None when no collection has been read yet."""
        return self._playlists_cache.get(self.playlists_csv)

    def matrix(self) -> dict | None:
        return self._matrix_cache.get(self.matrix_csv)

    def invalidate(self) -> None:
        self._playlists_cache.invalidate()
        self._matrix_cache.invalidate()
