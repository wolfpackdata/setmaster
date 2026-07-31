"""Comparison notes CRUD + the S5 results endpoint (5-column view fields,
summary counts, notes merged in, staleness flag)."""
from __future__ import annotations

import os
import time

from test_app_helpers import (
    app_client,
    joined_row,
    write_exportify_csv,
    write_joined,
)

SLUG = "disco_cosmic"


def _seed_joined(work_dir):
    write_joined(work_dir, SLUG, [
        joined_row("Yes-Trak-Playlist", spotify_join="alpha", trak_join="alpha",
                   spotify_name="Alpha", traktor_title="Alpha (Original Mix)",
                   file_path="C:\\music\\alpha.mp3", spotify_uri="spotify:track:aaa",
                   spotify_artists="Alpha Spotify Artist",
                   traktor_artists="Alpha Traktor Artist",
                   spotify_album_name="Alpha Spotify Album",
                   traktor_release_name="Alpha Traktor Album"),
        joined_row("Not-Trak-Collection", spotify_join="beta",
                   spotify_name="Beta", spotify_uri="spotify:track:bbb",
                   spotify_artists="Beta Spotify Artist",
                   spotify_album_name="Beta Spotify Album"),
        joined_row("Not-Trak-Playlist / Yes-Trak-Collection", spotify_join="gamma",
                   spotify_name="Gamma", file_path="C:\\music\\gamma.mp3",
                   spotify_uri="spotify:track:ccc"),
        joined_row("Not-Spotify / Yes-Trak-Playlist", trak_join="delta",
                   traktor_title="Delta", file_path="C:\\music\\delta.mp3",
                   traktor_artists="Delta Traktor Artist",
                   traktor_release_name="Delta Traktor Album"),
    ])


def test_notes_crud(tmp_path):
    with app_client(tmp_path) as c:
        # validation
        assert c.put("/api/comparison/notes", json={"slug": "", "join_key": "k",
                     "side": "traktor", "text": "x"}).status_code == 400
        assert c.put("/api/comparison/notes", json={"slug": "s", "join_key": "",
                     "side": "traktor", "text": "x"}).status_code == 400
        assert c.put("/api/comparison/notes", json={"slug": "s", "join_key": "k",
                     "side": "both", "text": "x"}).status_code == 400

        # create + update
        body = {"slug": SLUG, "join_key": "beta", "side": "traktor", "text": "buy this"}
        assert c.put("/api/comparison/notes", json=body).json() == {"ok": True, "deleted": False}
        body["text"] = "bought it"
        assert c.put("/api/comparison/notes", json=body).status_code == 200

        # visible in results
        _seed_joined(c.sm3_data_dir / "pipeline-work")
        rows = c.get(f"/api/comparison/results/{SLUG}").json()["rows"]
        noted = [r for r in rows if r["note"]]
        assert len(noted) == 1
        assert noted[0]["note"] == {"text": "bought it", "side": "traktor"}
        assert noted[0]["spotify_track_name"] == "Beta"

        # empty text deletes
        body["text"] = ""
        assert c.put("/api/comparison/notes", json=body).json() == {"ok": True, "deleted": True}
        rows = c.get(f"/api/comparison/results/{SLUG}").json()["rows"]
        assert all(r["note"] is None for r in rows)


def test_results_shape_and_summary(tmp_path):
    with app_client(tmp_path) as c:
        # 404 before a pipeline run produced the joined CSV
        assert c.get(f"/api/comparison/results/{SLUG}").status_code == 404

        _seed_joined(c.sm3_data_dir / "pipeline-work")
        # spotify-side note on the Traktor-only row (blank Spotify cell)
        c.put("/api/comparison/notes", json={
            "slug": SLUG, "join_key": "delta", "side": "spotify", "text": "don't care",
        })

        out = c.get(f"/api/comparison/results/{SLUG}").json()
        assert out["display_name"] == SLUG  # no import metadata yet -> slug fallback
        assert out["generated_at"]
        assert out["stale"] is False
        # summary: N tracks, M = Not-Trak-Collection count
        assert out["summary"] == {"total": 4, "not_matched": 1}

        by_flag = {r["flag"]: r for r in out["rows"]}
        match = by_flag["Yes-Trak-Playlist"]
        assert match["traktor_title"] == "Alpha (Original Mix)"
        assert match["spotify_track_name"] == "Alpha"
        assert match["file_paths"] == ["C:\\music\\alpha.mp3"]
        assert match["spotify_uri"] == "spotify:track:aaa"
        assert match["spotify_trackjoin"] == "alpha" and match["trak_trackjoin"] == "alpha"
        assert match["note"] is None
        # issue #20: artist/album pass-through (additive) from the joined CSV
        assert match["traktor_artists"] == "Alpha Traktor Artist"
        assert match["spotify_artists"] == "Alpha Spotify Artist"
        assert match["traktor_release_name"] == "Alpha Traktor Album"
        assert match["spotify_album_name"] == "Alpha Spotify Album"

        go_get = by_flag["Not-Trak-Collection"]
        assert go_get["traktor_title"] == "" and go_get["file_paths"] == []
        # Spotify-only row: Spotify fields populated, Traktor fields blank
        assert go_get["spotify_artists"] == "Beta Spotify Artist"
        assert go_get["spotify_album_name"] == "Beta Spotify Album"
        assert go_get["traktor_artists"] == "" and go_get["traktor_release_name"] == ""

        trak_only = by_flag["Not-Spotify / Yes-Trak-Playlist"]
        assert trak_only["spotify_track_name"] == ""
        assert trak_only["note"] == {"text": "don't care", "side": "spotify"}
        # Traktor-only row: Traktor fields populated, Spotify fields blank
        assert trak_only["traktor_artists"] == "Delta Traktor Artist"
        assert trak_only["traktor_release_name"] == "Delta Traktor Album"
        assert trak_only["spotify_artists"] == "" and trak_only["spotify_album_name"] == ""


def test_results_stale_flag(tmp_path, monkeypatch):
    downloads = tmp_path / "dl"
    downloads.mkdir()
    monkeypatch.setenv("SM3_DOWNLOADS_DIR", str(downloads))
    with app_client(tmp_path) as c:
        work = c.sm3_data_dir / "pipeline-work"
        joined = write_joined(work, SLUG, [
            joined_row("Yes-Trak-Playlist", spotify_join="a", trak_join="a",
                       spotify_name="A", traktor_title="A"),
        ])
        # joined regenerated *before* the exportify import -> stale
        past = time.time() - 3600
        os.utime(joined, (past, past))
        f = write_exportify_csv(downloads / f"{SLUG}.csv")
        c.post("/api/exportify/import", json={"paths": [str(f)]})

        out = c.get(f"/api/comparison/results/{SLUG}").json()
        assert out["stale"] is True
        assert out["display_name"] == "Disco Cosmic"  # from import metadata

        # regenerate the joined file now -> fresh
        os.utime(joined, None)
        assert c.get(f"/api/comparison/results/{SLUG}").json()["stale"] is False
