"""Exportify import flow (exportify-import.md §3-5, §7): Downloads scan,
header validation, slug derivation, newest-wins dedup, copy + metadata,
auto-add to comparison config, batch summary, edge cases."""
from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from test_app_helpers import (
    app_client,
    write_collection_playlists,
    write_csv,
    write_exportify_csv,
)


@pytest.fixture
def downloads(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "Downloads"
    d.mkdir()
    monkeypatch.setenv("SM3_DOWNLOADS_DIR", str(d))
    return d


def _seed_collection(client):
    write_collection_playlists(client.sm3_data_dir / "pipeline-work", [
        ("$ROOT/Disco Cosmic", "Disco Cosmic", "$ROOT"),
        ("$ROOT/Kootz4", "Kootz4", "$ROOT"),
    ])


def test_candidates_scan(tmp_path, downloads):
    with app_client(tmp_path) as c:
        _seed_collection(c)
        now = time.time()
        old = write_exportify_csv(downloads / "disco_cosmic.csv")
        os.utime(old, (now - 100, now - 100))
        write_exportify_csv(downloads / "disco_cosmic (2).csv")
        os.utime(downloads / "disco_cosmic (2).csv", (now, now))
        write_csv(downloads / "random.csv", ["foo", "bar"], [["1", "2"]])
        os.utime(downloads / "random.csv", (now - 50, now - 50))
        (downloads / "notes.txt").write_text("not a csv", encoding="utf-8")

        cands = c.get("/api/exportify/candidates").json()
        assert [x["filename"] for x in cands] == \
            ["disco_cosmic (2).csv", "random.csv", "disco_cosmic.csv"]  # newest first
        by_name = {x["filename"]: x for x in cands}
        assert by_name["disco_cosmic (2).csv"]["slug"] == "disco_cosmic"  # ' (n)' stripped
        assert by_name["disco_cosmic (2).csv"]["valid"] is True
        # display name comes from the Traktor match, not the slug
        assert by_name["disco_cosmic (2).csv"]["display_name"] == "Disco Cosmic"
        assert by_name["random.csv"]["valid"] is False
        for x in cands:
            assert x["mtime_iso"] and x["size"] > 0 and x["path"]


def test_import_flow_matched_dedup_and_summary(tmp_path, downloads):
    with app_client(tmp_path) as c:
        _seed_collection(c)
        older = write_exportify_csv(downloads / "disco_cosmic.csv", n_rows=5)
        os.utime(older, (time.time() - 100, time.time() - 100))
        newest = write_exportify_csv(downloads / "disco_cosmic (2).csv", n_rows=7)
        no_match = write_exportify_csv(downloads / "brand_new_list.csv", n_rows=2)
        write_csv(downloads / "random.csv", ["foo"], [["1"]])

        r = c.post("/api/exportify/import", json={"paths": [
            str(older), str(newest), str(no_match), str(downloads / "random.csv"),
            str(downloads / "missing.csv"),
        ]})
        assert r.status_code == 200
        out = r.json()

        imported = {i["slug"]: i for i in out["imported"]}
        assert set(imported) == {"disco_cosmic", "brand_new_list"}
        assert imported["disco_cosmic"]["display_name"] == "Disco Cosmic"
        assert imported["disco_cosmic"]["added_to_config"] is True
        assert imported["disco_cosmic"]["matched_traktor"] == "$ROOT/Disco Cosmic"
        assert imported["brand_new_list"]["display_name"] == "Brand New List"
        assert imported["brand_new_list"]["added_to_config"] is False
        assert imported["brand_new_list"]["matched_traktor"] is None

        reasons = {s["path"]: s["reason"] for s in out["skipped"]}
        assert str(older) in reasons          # newest-wins dedup
        assert str(downloads / "random.csv") in reasons
        assert str(downloads / "missing.csv") in reasons
        assert out["summary"] == (
            "Imported 2 playlists · 1 added to comparison"
            " · 0 already configured · 1 not found in Traktor."
        )
        # the "·" separator must go over the wire as clean UTF-8 (0xC2 0xB7),
        # never double-encoded to "Â·" (0xC3 0x82 0xC2 0xB7) — known-issues D-025.
        assert b"\xc2\xb7" in r.content
        assert b"\xc3\x82\xc2\xb7" not in r.content

        # newest file's contents landed at raw-data/exportify/<slug>.csv
        stored = c.sm3_data_dir / "raw-data" / "exportify" / "disco_cosmic.csv"
        assert stored.is_file()
        assert stored.read_bytes() == newest.read_bytes()

        # metadata recorded (imports endpoint)
        imports = {i["slug"]: i for i in c.get("/api/exportify/imports").json()}
        assert imports["disco_cosmic"]["row_count"] == 7
        assert imports["disco_cosmic"]["original_filename"] == "disco_cosmic (2).csv"
        assert imports["disco_cosmic"]["imported_at"] and imports["disco_cosmic"]["source_mtime"]

        # re-import counts as already configured; file overwritten (newest-only)
        r2 = c.post("/api/exportify/import", json={"paths": [str(newest)]})
        assert r2.json()["already_configured"] == 1
        assert r2.json()["imported"][0]["added_to_config"] is False

        # source files always left in place in Downloads
        assert older.is_file() and newest.is_file() and no_match.is_file()


def test_zero_valid_files_is_an_error(tmp_path, downloads):
    with app_client(tmp_path) as c:
        write_csv(downloads / "random.csv", ["foo"], [["1"]])
        r = c.post("/api/exportify/import", json={"paths": [str(downloads / "random.csv")]})
        assert r.status_code == 400
        # nothing stored, no config change
        assert c.get("/api/exportify/imports").json() == []
        assert list((c.sm3_data_dir / "raw-data" / "exportify").iterdir()) == []


def test_import_before_any_collection(tmp_path, downloads):
    with app_client(tmp_path) as c:
        f = write_exportify_csv(downloads / "disco_cosmic.csv")
        r = c.post("/api/exportify/import", json={"paths": [str(f)]})
        assert r.status_code == 200
        out = r.json()
        assert out["imported"][0]["added_to_config"] is False
        assert out["imported"][0]["matched_traktor"] is None
        assert "1 not found in Traktor" in out["summary"]
        # lands in the S8 Spotify panel as a no-match
        ov = c.get("/api/comparison/overview").json()
        assert ov["traktor"] == []
        assert ov["spotify"][0]["match"]["state"] == "none"


def test_normalize_collision_flagged_as_conflict(tmp_path, downloads):
    with app_client(tmp_path) as c:
        write_collection_playlists(c.sm3_data_dir / "pipeline-work", [
            ("$ROOT/Disco Cosmic", "Disco Cosmic", "$ROOT"),
            ("Other/DISCOCOSMIC", "DISCOCOSMIC", "Other"),
        ])
        f = write_exportify_csv(downloads / "disco_cosmic.csv")
        r = c.post("/api/exportify/import", json={"paths": [str(f)]})
        out = r.json()
        # conflict: never silently picked, not auto-added
        assert out["imported"][0]["added_to_config"] is False
        ov = c.get("/api/comparison/overview").json()
        sp = ov["spotify"][0]
        assert sp["match"]["state"] == "conflict"
        assert set(sp["match"]["candidates"]) == {"$ROOT/Disco Cosmic", "Other/DISCOCOSMIC"}
        assert all(t["checked"] is False for t in ov["traktor"])


def test_overview_coverage_and_config_roundtrip(tmp_path, downloads):
    with app_client(tmp_path) as c:
        _seed_collection(c)
        f = write_exportify_csv(downloads / "disco_cosmic.csv")
        c.post("/api/exportify/import", json={"paths": [str(f)]})

        ov = c.get("/api/comparison/overview").json()
        traktor = {t["path"]: t for t in ov["traktor"]}
        assert traktor["$ROOT/Disco Cosmic"]["checked"] is True  # auto-added
        assert traktor["$ROOT/Disco Cosmic"]["coverage"]["state"] == "fresh"
        assert traktor["$ROOT/Kootz4"]["checked"] is False
        assert traktor["$ROOT/Kootz4"]["coverage"] == {"state": "none", "text": "no Spotify data"}
        assert ov["spotify"][0]["match"] == {
            "state": "matched", "traktor_path": "$ROOT/Disco Cosmic"
        }

        # PUT config replaces the checked set
        r = c.put("/api/comparison/config", json={"checked_paths": ["$ROOT/Kootz4"]})
        assert r.status_code == 200
        ov = c.get("/api/comparison/overview").json()
        traktor = {t["path"]: t for t in ov["traktor"]}
        assert traktor["$ROOT/Kootz4"]["checked"] is True
        assert traktor["$ROOT/Disco Cosmic"]["checked"] is False

        assert c.put("/api/comparison/config", json={"checked_paths": "x"}).status_code == 400
