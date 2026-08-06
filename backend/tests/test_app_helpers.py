"""Shared helpers for the app test suite (no tests in this module).

Each test spins up the FastAPI app against a throwaway data dir under
tmp_path; the pipeline is never actually run — tests monkeypatch
`app.pipeline_runner.run_pipeline_impl` with synthetic-output stubs.
"""
from __future__ import annotations

import csv
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

# --- app / client -----------------------------------------------------------


@contextmanager
def app_client(tmp_path: Path):
    """TestClient bound to a fresh data dir at <tmp_path>/appdata."""
    data_dir = Path(tmp_path) / "appdata"
    app = create_app(data_dir=data_dir)
    with TestClient(app) as client:
        client.sm3_data_dir = data_dir  # type: ignore[attr-defined]
        yield client


def configure_collection(client: TestClient, tmp_path: Path) -> Path:
    """Point settings at a dummy collection.nml so /api/pipeline/run passes preflight."""
    nml = Path(tmp_path) / "collection.nml"
    nml.write_text("<NML></NML>", encoding="utf-8")
    r = client.put("/api/settings", json={"collection_nml_path": str(nml)})
    assert r.status_code == 200, r.text
    return nml


def wait_pipeline(client: TestClient, timeout: float = 15.0) -> dict:
    """Poll /api/pipeline/status until the run finishes; return final status."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = client.get("/api/pipeline/status").json()
        if st["state"] in ("completed", "error"):
            return st
        time.sleep(0.02)
    raise TimeoutError("pipeline run did not finish within timeout")


# --- synthetic pipeline-output CSV writers (all utf-8-sig, like the pipeline) ---


def write_csv(path: Path, header: list[str], rows: list[list]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def write_collection_playlists(
    work_dir: Path, playlists: list[tuple[str, str, str]]
) -> Path:
    """playlists: [(playlist_path, playlist_name, playlist_folder)] — one
    membership row each (track_key is irrelevant to the app-side readers)."""
    path = work_dir / "Traktor" / "traktor_collection_playlists.csv"
    write_csv(
        path,
        ["playlist_path", "playlist_name", "playlist_folder", "track_key"],
        [[p, n, f, f"K:/:{n}/:t.mp3"] for (p, n, f) in playlists],
    )
    return path


MATRIX_FIXED = [
    "Track Key", "Import Date", "Release Date", "Last Played", "Play Count",
    "BPM", "Key", "Album Title", "Artist Name", "Track Name",
    "On Root PL", "On Non-Root PL",
]


def write_matrix(work_dir: Path, playlist_names: list[str], tracks: list[dict]) -> Path:
    """tracks: dicts with keys track_key, name, artist, bpm, key, playcount,
    root, nonroot, member_of (list of playlist names)."""
    path = work_dir / "Traktor" / "traktor_track_playlist_matrix.csv"
    header = MATRIX_FIXED + playlist_names
    rows = []
    for t in tracks:
        row = [
            t["track_key"], t.get("import_date", ""), t.get("release_date", ""),
            t.get("last_played", ""), t.get("playcount", 0), t.get("bpm", ""),
            t.get("key", ""), t.get("album", ""), t.get("artist", ""), t["name"],
            t.get("root", 0), t.get("nonroot", 0),
        ]
        for pl in playlist_names:
            row.append(t["name"] if pl in t.get("member_of", ()) else "")
        rows.append(row)
    write_csv(path, header, rows)
    return path


JOINED_HEADER = [
    "presence_flag", "spotify_trackjoin", "trak_trackjoin", "artist_collate",
    "track_collate", "trak_collection_file_paths", "spotify_track_name",
    "traktor_title", "spotify_artists", "traktor_artists", "spotify_album_name",
    "traktor_release_name", "spotify_bpm", "traktor_bpm", "spotify_trackkey",
    "traktor_trackkey", "spotify_uri", "key_formatted",
]


def joined_row(
    flag: str,
    spotify_join: str = "",
    trak_join: str = "",
    spotify_name: str = "",
    traktor_title: str = "",
    file_path: str = "",
    spotify_uri: str = "",
    spotify_artists: str = "",
    traktor_artists: str = "",
    spotify_album_name: str = "",
    traktor_release_name: str = "",
) -> list[str]:
    row = {h: "" for h in JOINED_HEADER}
    row.update(
        presence_flag=flag,
        spotify_trackjoin=spotify_join,
        trak_trackjoin=trak_join,
        spotify_track_name=spotify_name,
        traktor_title=traktor_title,
        trak_collection_file_paths=file_path,
        spotify_uri=spotify_uri,
        spotify_artists=spotify_artists,
        traktor_artists=traktor_artists,
        spotify_album_name=spotify_album_name,
        traktor_release_name=traktor_release_name,
        track_collate=spotify_name or traktor_title,
    )
    return [row[h] for h in JOINED_HEADER]


def write_joined(work_dir: Path, slug: str, rows: list[list[str]]) -> Path:
    path = work_dir / "Joined" / f"joined_{slug}.csv"
    write_csv(path, JOINED_HEADER, rows)
    return path


# --- exportify fixture CSVs ---------------------------------------------------

EXPORTIFY_HEADER = [
    "Track URI", "Track Name", "Artist Name(s)", "Album Name", "Added At",
]


def write_exportify_csv(path: Path, n_rows: int = 3) -> Path:
    rows = [
        [f"spotify:track:{i:04d}", f"Track {i}", f"Artist {i}", f"Album {i}",
         "2026-01-01T00:00:00Z"]
        for i in range(n_rows)
    ]
    write_csv(path, EXPORTIFY_HEADER, rows)
    return path
