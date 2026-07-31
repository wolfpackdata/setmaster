"""Tests for the /api/fs file browser router."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from app.routers import fs as fs_router
from tests.test_app_helpers import app_client


def test_list_dir_returns_entries(tmp_path: Path):
    (tmp_path / "collection.nml").write_text("<NML/>", encoding="utf-8")
    (tmp_path / "sub").mkdir()
    with app_client(tmp_path) as client:
        r = client.get("/api/fs/list", params={"path": str(tmp_path)})
        assert r.status_code == 200, r.text
        names = [e["name"] for e in r.json()["entries"]]
        assert "collection.nml" in names
        assert "sub" in names  # dirs sort first
        assert names.index("sub") < names.index("collection.nml")


def test_dotfiles_hidden_everywhere(tmp_path: Path):
    (tmp_path / ".secret").write_text("x", encoding="utf-8")
    (tmp_path / "visible.txt").write_text("x", encoding="utf-8")
    with app_client(tmp_path) as client:
        names = [e["name"] for e in client.get(
            "/api/fs/list", params={"path": str(tmp_path)}).json()["entries"]]
    assert ".secret" not in names
    assert "visible.txt" in names


def test_missing_dir_is_404(tmp_path: Path):
    with app_client(tmp_path) as client:
        r = client.get("/api/fs/list", params={"path": str(tmp_path / "nope")})
    assert r.status_code == 404


@pytest.mark.skipif(sys.platform != "win32", reason="Windows-only junction behavior")
def test_windows_hidden_junctions_are_skipped(tmp_path: Path):
    """The legacy per-user junctions that caused the 403 must not appear.

    `C:\\Users\\<name>\\My Documents` et al. are Hidden+System reparse points
    that deny enumeration; hiding them means the browser never offers a click
    that dead-ends in a 403.
    """
    home = Path.home()
    with app_client(tmp_path) as client:
        entries = client.get("/api/fs/list", params={"path": str(home)}).json()["entries"]
    names = {e["name"] for e in entries}
    # If these junctions exist on this machine, none should be listed.
    for junction in ("My Documents", "Application Data", "Cookies", "NetHood"):
        if (home / junction).exists():
            assert junction not in names, f"{junction} leaked into listing"
    # And every listed dir must actually be enumerable (the bug's real symptom).
    for e in entries:
        if e["is_dir"]:
            assert not fs_router._is_hidden(Path(e["path"]))
