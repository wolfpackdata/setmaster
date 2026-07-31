"""Sets lifecycle: CRUD, name rules, rows round-trip, formatting vs reorder,
archive / restore / permanent delete (set-archive.md; api-contract Sets)."""
from __future__ import annotations

import uuid

from test_app_helpers import app_client


def _row(rid: str | None = None, **overrides) -> dict:
    base = {
        "id": rid or uuid.uuid4().hex,
        "bpm": "124", "key": "Gbm", "in_name": "Some Track", "in_delta": "+1",
        "m_num": "#1", "t_num": "#2", "a_num": "---", "lows": "cut",
        "level": "HOT", "swap_lows": "---", "i_like": "⚠️",
        "notes": "fx note", "start": "0:30", "transition": "1:15",
    }
    base.update(overrides)
    return base


def test_set_lifecycle_and_name_rules(tmp_path):
    with app_client(tmp_path) as c:
        # create
        r = c.post("/api/sets", json={"name": "  KimmaBryan  "})
        assert r.status_code == 201
        meta = r.json()
        assert meta["name"] == "KimmaBryan"  # trimmed
        assert meta["archived"] is False
        sid = meta["id"]

        # name rules
        assert c.post("/api/sets", json={"name": ""}).status_code == 400
        assert c.post("/api/sets", json={"name": "   "}).status_code == 400
        assert c.post("/api/sets", json={"name": "x" * 101}).status_code == 400
        # duplicate among active -> 409
        assert c.post("/api/sets", json={"name": "KimmaBryan"}).status_code == 409

        # list
        sets = c.get("/api/sets").json()
        assert [s["id"] for s in sets] == [sid]

        # patch rename + folder
        r = c.patch(f"/api/sets/{sid}", json={"name": "Kootz4", "folder": "gigs"})
        assert r.status_code == 200
        assert r.json()["name"] == "Kootz4"
        assert r.json()["folder"] == "gigs"

        # rename collision -> 409
        c.post("/api/sets", json={"name": "Other"})
        assert c.patch(f"/api/sets/{sid}", json={"name": "Other"}).status_code == 409

        # 404s
        assert c.get("/api/sets/nope").status_code == 404
        assert c.patch("/api/sets/nope", json={"name": "x"}).status_code == 404


def test_rows_round_trip_and_track_count(tmp_path):
    with app_client(tmp_path) as c:
        sid = c.post("/api/sets", json={"name": "S"}).json()["id"]
        rows = [_row(in_name="Track A"), _row(in_name="Track B"), _row(in_name="")]
        r = c.put(f"/api/sets/{sid}/rows", json=rows)
        assert r.status_code == 200
        assert r.json()["row_count"] == 3
        # '# Tracks' counts rows with a non-empty In-Track name
        assert r.json()["track_count"] == 2

        got = c.get(f"/api/sets/{sid}").json()
        assert got["rows"] == rows  # byte-identical round trip, order preserved
        assert got["track_count"] == 2

        # duplicate row ids rejected
        dup = [_row(rid="r1"), _row(rid="r1")]
        assert c.put(f"/api/sets/{sid}/rows", json=dup).status_code == 400


def test_formatting_survives_reorder(tmp_path):
    with app_client(tmp_path) as c:
        sid = c.post("/api/sets", json={"name": "F"}).json()["id"]
        r1, r2, r3 = _row(rid="r1"), _row(rid="r2"), _row(rid="r3")
        c.put(f"/api/sets/{sid}/rows", json=[r1, r2, r3])

        fmt = {
            "fills": [{"row_id": "r2", "col": "in_name", "color": "red"}],
            "boxes": [{"row_ids": ["r1", "r2"], "cols": ["bpm", "key"]}],
        }
        assert c.put(f"/api/sets/{sid}/formatting", json=fmt).status_code == 200

        # reorder rows: formatting is row-identity anchored -> unchanged
        c.put(f"/api/sets/{sid}/rows", json=[r3, r1, r2])
        got = c.get(f"/api/sets/{sid}").json()
        assert [r["id"] for r in got["rows"]] == ["r3", "r1", "r2"]
        assert got["formatting"] == fmt

        # invalid formatting rejected
        bad = {"fills": [{"row_id": "r1", "col": "bpm", "color": "green"}], "boxes": []}
        assert c.put(f"/api/sets/{sid}/formatting", json=bad).status_code == 400


def test_duplicate_set_copies_everything(tmp_path):
    with app_client(tmp_path) as c:
        sid = c.post("/api/sets", json={"name": "Orig"}).json()["id"]
        rows = [_row(rid="r1", in_name="T1")]
        c.put(f"/api/sets/{sid}/rows", json=rows)
        fmt = {"fills": [{"row_id": "r1", "col": "bpm", "color": "yellow"}], "boxes": []}
        c.put(f"/api/sets/{sid}/formatting", json=fmt)
        c.patch(f"/api/sets/{sid}/export-filename", json={"filename": "orig_export"})

        dup = c.post(f"/api/sets/{sid}/duplicate")
        assert dup.status_code == 201
        d = dup.json()
        assert d["name"] == "Orig (2)"
        got = c.get(f"/api/sets/{d['id']}").json()
        assert got["rows"] == rows
        assert got["formatting"] == fmt
        assert got["export_filename"] == "orig_export"


def test_archive_restore_delete(tmp_path):
    with app_client(tmp_path) as c:
        sid = c.post("/api/sets", json={"name": "Arch"}).json()["id"]
        rows = [_row(rid="r1", in_name="T1", i_like="🚀")]
        c.put(f"/api/sets/{sid}/rows", json=rows)
        fmt = {"fills": [{"row_id": "r1", "col": "lows", "color": "red"}], "boxes": []}
        c.put(f"/api/sets/{sid}/formatting", json=fmt)
        c.patch(f"/api/sets/{sid}/export-filename", json={"filename": "arch_out"})

        # active sets cannot be permanently deleted
        assert c.delete(f"/api/sets/{sid}").status_code == 409

        r = c.post(f"/api/sets/{sid}/archive")
        assert r.status_code == 200
        assert r.json()["archived"] is True
        assert r.json()["archived_at"]

        # excluded from active list, included in archived list
        assert c.get("/api/sets").json() == []
        arch = c.get("/api/sets", params={"archived": True}).json()
        assert [s["id"] for s in arch] == [sid]

        # double archive -> 409; archived set cannot be edited
        assert c.post(f"/api/sets/{sid}/archive").status_code == 409
        assert c.put(f"/api/sets/{sid}/rows", json=rows).status_code == 409

        # archived name may collide with a new active set
        active_id = c.post("/api/sets", json={"name": "Arch"}).json()["id"]

        # restore without new_name -> 409 (active-name collision)
        assert c.post(f"/api/sets/{sid}/restore").status_code == 409
        # restore with new_name works, data fully intact
        r = c.post(f"/api/sets/{sid}/restore", json={"new_name": "Arch (2)"})
        assert r.status_code == 200
        got = c.get(f"/api/sets/{sid}").json()
        assert got["archived"] is False
        assert got["rows"] == rows
        assert got["formatting"] == fmt
        assert got["export_filename"] == "arch_out"

        # restore of a non-archived set -> 409
        assert c.post(f"/api/sets/{sid}/restore").status_code == 409

        # archive + permanent delete removes everything atomically
        c.post(f"/api/sets/{sid}/archive")
        assert c.delete(f"/api/sets/{sid}").status_code == 200
        assert c.get(f"/api/sets/{sid}").status_code == 404
        assert c.get("/api/sets", params={"archived": True}).json() == []
        assert [s["id"] for s in c.get("/api/sets").json()] == [active_id]
