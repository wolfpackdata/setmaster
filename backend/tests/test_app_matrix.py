"""Matrix endpoint: compact JSON, is_root computation, membership indices,
mtime-keyed cache invalidation, track search."""
from __future__ import annotations

import os
import time

from test_app_helpers import app_client, write_collection_playlists, write_matrix


def _seed(work_dir):
    write_collection_playlists(work_dir, [
        ("$ROOT/Disco Cosmic", "Disco Cosmic", "$ROOT"),
        ("$ROOT/Kootz4", "Kootz4", "$ROOT"),
        ("Prep/Incoming", "Incoming", "Prep"),
    ])
    write_matrix(
        work_dir,
        ["Disco Cosmic", "Incoming", "Kootz4"],
        [
            {
                "track_key": "C:/:studio/:tracks/:a.mp3", "name": "Alpha",
                "artist": "Artist One", "bpm": "124.5", "key": "Gbm",
                "playcount": 3, "root": 2, "nonroot": 0,
                "member_of": ["Disco Cosmic", "Kootz4"],
                "import_date": "2020/11/22",
            },
            {
                "track_key": "C:/:studio/:tracks/:b.aiff", "name": "Beta",
                "artist": "Artist Two", "bpm": "", "key": "",
                "playcount": 0, "root": 0, "nonroot": 1,
                "member_of": ["Incoming"],
            },
        ],
    )


def test_matrix_404_before_pipeline(tmp_path):
    with app_client(tmp_path) as c:
        r = c.get("/api/matrix")
        assert r.status_code == 404
        assert "detail" in r.json()


def test_matrix_shape_membership_and_is_root(tmp_path):
    with app_client(tmp_path) as c:
        c.put("/api/settings", json={"super_playlist_folder": "$root"})  # case-insensitive
        _seed(c.sm3_data_dir / "pipeline-work")

        data = c.get("/api/matrix").json()
        assert data["generated_at"]
        assert data["playlists"] == [
            {"path": "$ROOT/Disco Cosmic", "name": "Disco Cosmic", "is_root": True},
            {"path": "Prep/Incoming", "name": "Incoming", "is_root": False},
            {"path": "$ROOT/Kootz4", "name": "Kootz4", "is_root": True},
        ]
        assert len(data["rows"]) == 2
        a, b = data["rows"]
        assert a["tk"] == "C:/:studio/:tracks/:a.mp3"
        assert a["file_path"] == "C:\\studio\\tracks\\a.mp3"
        assert a["name"] == "Alpha" and a["artist"] == "Artist One"
        assert a["bpm"] == 124.5 and a["key"] == "Gbm"
        assert a["playcount"] == 3 and a["root"] == 2 and a["nonroot"] == 0
        assert a["import_date"] == "2020/11/22"
        assert a["m"] == [0, 2]  # playlist indices: Disco Cosmic + Kootz4
        assert b["bpm"] is None and b["key"] is None
        assert b["playcount"] == 0
        assert b["m"] == [1]


def test_matrix_cache_refreshes_on_new_file(tmp_path):
    with app_client(tmp_path) as c:
        work = c.sm3_data_dir / "pipeline-work"
        _seed(work)
        assert len(c.get("/api/matrix").json()["rows"]) == 2
        # regenerate with one more track; bump mtime past cache signature
        time.sleep(0.01)
        write_collection_playlists(work, [("$ROOT/Disco Cosmic", "Disco Cosmic", "$ROOT")])
        write_matrix(work, ["Disco Cosmic"], [
            {"track_key": "K:/:x.mp3", "name": "New", "artist": "A",
             "member_of": ["Disco Cosmic"]},
            {"track_key": "K:/:y.mp3", "name": "New2", "artist": "B", "member_of": []},
            {"track_key": "K:/:z.mp3", "name": "New3", "artist": "C", "member_of": []},
        ])
        matrix_csv = work / "Traktor" / "traktor_track_playlist_matrix.csv"
        os.utime(matrix_csv, (time.time() + 1, time.time() + 1))
        assert len(c.get("/api/matrix").json()["rows"]) == 3


def test_search_tracks(tmp_path):
    with app_client(tmp_path) as c:
        assert c.get("/api/search/tracks", params={"q": "alp"}).json() == []  # no data yet
        _seed(c.sm3_data_dir / "pipeline-work")
        assert c.get("/api/search/tracks", params={"q": "alp"}).json() == [
            {"name": "Alpha", "artist": "Artist One"}
        ]
        # artist match, case-insensitive
        assert c.get("/api/search/tracks", params={"q": "ARTIST TWO"}).json() == [
            {"name": "Beta", "artist": "Artist Two"}
        ]
        assert c.get("/api/search/tracks", params={"q": ""}).json() == []
        assert c.get("/api/search/tracks", params={"q": "zzz"}).json() == []
