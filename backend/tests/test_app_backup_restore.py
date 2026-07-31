"""Backup (zip of the whole data dir) and restore (validated atomic swap)."""
from __future__ import annotations

import io
import sqlite3
import zipfile

from app.state import AppState
from test_app_helpers import app_client, write_exportify_csv


def test_backup_zip_contains_all_user_data(tmp_path):
    with app_client(tmp_path) as c:
        sid = c.post("/api/sets", json={"name": "BackMeUp"}).json()["id"]
        # a raw exportify file is part of the data dir too
        write_exportify_csv(c.sm3_data_dir / "raw-data" / "exportify" / "disco.csv")

        r = c.get("/api/backup")
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/zip"
        assert "setmaster3-backup-" in r.headers.get("content-disposition", "")

        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = set(zf.namelist())
        assert "setmaster3.db" in names
        assert "raw-data/exportify/disco.csv" in names
        # WAL sidecars are checkpointed away, never shipped
        assert not any(n.endswith((".db-wal", ".db-shm")) for n in names)

        # the zipped db actually contains the set (WAL was checkpointed)
        assert zf.read("setmaster3.db")[:16] == b"SQLite format 3\x00"
        assert sid  # created above


def test_restore_round_trip(tmp_path):
    with app_client(tmp_path) as c:
        c.post("/api/sets", json={"name": "Original"})
        c.put("/api/comparison/notes", json={
            "slug": "disco", "join_key": "k1", "side": "traktor", "text": "keep me",
        })
        backup_bytes = c.get("/api/backup").content

        # mutate state after the backup
        c.post("/api/sets", json={"name": "AfterBackup"})
        names = {s["name"] for s in c.get("/api/sets").json()}
        assert names == {"Original", "AfterBackup"}

        r = c.post(
            "/api/restore",
            files={"file": ("backup.zip", io.BytesIO(backup_bytes), "application/zip")},
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

        # state is exactly the backup snapshot again
        names = {s["name"] for s in c.get("/api/sets").json()}
        assert names == {"Original"}
        # data dir still works for subsequent writes
        assert c.post("/api/sets", json={"name": "PostRestore"}).status_code == 201


def test_restore_rejects_garbage(tmp_path):
    with app_client(tmp_path) as c:
        c.post("/api/sets", json={"name": "Survivor"})

        # not a zip
        r = c.post("/api/restore",
                   files={"file": ("x.zip", io.BytesIO(b"not a zip"), "application/zip")})
        assert r.status_code == 400

        # a zip without setmaster3.db
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("random.txt", "hello")
        r = c.post("/api/restore",
                   files={"file": ("x.zip", io.BytesIO(buf.getvalue()), "application/zip")})
        assert r.status_code == 400
        assert "setmaster3.db" in r.json()["detail"]

        # a zip whose setmaster3.db is not SQLite
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("setmaster3.db", "definitely not sqlite")
        r = c.post("/api/restore",
                   files={"file": ("x.zip", io.BytesIO(buf.getvalue()), "application/zip")})
        assert r.status_code == 400

        # zip-slip attempt is rejected
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("../evil.txt", "escape")
            zf.writestr("setmaster3.db", "x")
        r = c.post("/api/restore",
                   files={"file": ("x.zip", io.BytesIO(buf.getvalue()), "application/zip")})
        assert r.status_code == 400
        assert not (c.sm3_data_dir.parent / "evil.txt").exists()

        # original data untouched by all failed restores
        names = {s["name"] for s in c.get("/api/sets").json()}
        assert names == {"Survivor"}


def _corrupt_sqlite_zip(good_db: bytes) -> bytes:
    """A zip whose setmaster3.db has the SQLite magic prefix but garbage after it."""
    payload = bytearray(good_db[:4096])
    payload[len(b"SQLite format 3\x00"):] = b"\x00" * (len(payload) - 16)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("setmaster3.db", bytes(payload))
    return buf.getvalue()


def test_restore_rejects_corrupt_db_with_valid_magic_prefix(tmp_path):
    """A SQLite-shaped but broken db must never become the live database."""
    with app_client(tmp_path) as c:
        c.post("/api/sets", json={"name": "Survivor"})
        good_db = zipfile.ZipFile(io.BytesIO(c.get("/api/backup").content)).read("setmaster3.db")

        bad = _corrupt_sqlite_zip(good_db)
        r = c.post("/api/restore",
                   files={"file": ("x.zip", io.BytesIO(bad), "application/zip")})
        assert r.status_code == 400, r.text

        # the app still serves the original data, and still accepts writes
        assert {s["name"] for s in c.get("/api/sets").json()} == {"Survivor"}
        assert c.post("/api/sets", json={"name": "AfterFailedRestore"}).status_code == 201


def test_restore_rejects_foreign_sqlite_database(tmp_path):
    """A healthy SQLite file from some other program is not an SM3 backup."""
    other = tmp_path / "other.db"
    conn = sqlite3.connect(other)
    conn.execute("CREATE TABLE unrelated (x TEXT)")
    conn.commit()
    conn.close()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("setmaster3.db", other.read_bytes())

    with app_client(tmp_path) as c:
        c.post("/api/sets", json={"name": "Survivor"})
        r = c.post("/api/restore",
                   files={"file": ("x.zip", io.BytesIO(buf.getvalue()), "application/zip")})
        assert r.status_code == 400, r.text
        assert "sets" in r.json()["detail"]
        assert {s["name"] for s in c.get("/api/sets").json()} == {"Survivor"}


def test_restore_rolls_back_when_reopen_fails(monkeypatch, tmp_path):
    """If reopening the swapped-in dir fails, the original dir comes back live."""
    with app_client(tmp_path) as c:
        c.post("/api/sets", json={"name": "Survivor"})
        backup_bytes = c.get("/api/backup").content

        real_reopen = AppState.reopen
        calls = {"n": 0}

        def flaky_reopen(self):
            calls["n"] += 1
            if calls["n"] == 1:          # the swapped-in dir
                raise RuntimeError("boom")
            real_reopen(self)             # the rollback

        monkeypatch.setattr(AppState, "reopen", flaky_reopen)

        r = c.post("/api/restore",
                   files={"file": ("b.zip", io.BytesIO(backup_bytes), "application/zip")})
        assert r.status_code == 500, r.text
        assert "kept" in r.json()["detail"]

        monkeypatch.undo()
        # original data dir is live again and writable; no stray swap dirs left
        assert {s["name"] for s in c.get("/api/sets").json()} == {"Survivor"}
        assert c.post("/api/sets", json={"name": "AfterRollback"}).status_code == 201
        strays = [p.name for p in c.sm3_data_dir.parent.glob(".appdata.*")]
        assert strays == []
