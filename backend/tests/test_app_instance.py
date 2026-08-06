"""Instance identity (#181): the file + /api/status pair a stopper checks."""
from __future__ import annotations

import io
import json
import os
import zipfile

from test_app_helpers import app_client


def test_status_reports_instance_identity_matching_the_file(tmp_path):
    with app_client(tmp_path) as c:
        st = c.get("/api/status").json()
        assert st["instance"]["pid"] == os.getpid()
        assert st["instance"]["token"]
        assert st["instance"]["started_at"]

        on_disk = json.loads((c.sm3_data_dir / "instance.json").read_text(encoding="utf-8"))
        # ownership proof: the token in the answer is the token in the data dir
        assert on_disk["token"] == st["instance"]["token"]
        assert on_disk["pid"] == st["instance"]["pid"]


def test_instance_file_is_removed_on_clean_shutdown(tmp_path):
    with app_client(tmp_path) as c:
        data_dir = c.sm3_data_dir
        assert (data_dir / "instance.json").is_file()
    assert not (data_dir / "instance.json").exists()


def test_backup_excludes_the_instance_file(tmp_path):
    """A restored backup must not hand the live dir another process's identity."""
    with app_client(tmp_path) as c:
        zf = zipfile.ZipFile(io.BytesIO(c.get("/api/backup").content))
        assert "instance.json" not in zf.namelist()


def test_restore_republishes_our_identity(tmp_path):
    with app_client(tmp_path) as c:
        backup_bytes = c.get("/api/backup").content
        before = c.get("/api/status").json()["instance"]["token"]

        r = c.post("/api/restore",
                   files={"file": ("b.zip", io.BytesIO(backup_bytes), "application/zip")})
        assert r.status_code == 200, r.text

        on_disk = json.loads((c.sm3_data_dir / "instance.json").read_text(encoding="utf-8"))
        assert on_disk["token"] == before  # same process, identity re-published
        assert c.get("/api/status").json()["instance"]["token"] == before
