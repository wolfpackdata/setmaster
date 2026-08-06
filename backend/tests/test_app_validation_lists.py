"""Validation lists: factory defaults, constraints (incl. grapheme rules),
rename propagation across all sets, reset semantics, usage counts."""
from __future__ import annotations

import sqlite3
import uuid

from test_app_helpers import app_client

# Issue #163 — the Δ FACTORY list is the narrow daily-use range, ascending, with
# `0` included. NOT the full [-12, +12] the field accepts; that is the constraint
# a user may add within (see test_delta_constraints), not the default.
DELTA_FACTORY = ["-1.5", "-1", "-0.5", "0", "+0.5", "+1", "+1.5"]

FACTORY = {
    "delta": DELTA_FACTORY,
    "lows": ["cut", "cut-swell", "open", "0.5"],
    "level": ["silence", "open", "HOT", "HOT-LP", "LP", "HP", "LP-silence", "HP-silence"],
    "i_like": ["🚀", "💜", "✔️", "⚠️", "🟥"],
}


def _row(**overrides) -> dict:
    base = {
        "id": uuid.uuid4().hex, "bpm": "", "key": "", "in_name": "t",
        "in_delta": "---", "m_num": "---", "t_num": "---", "a_num": "---",
        "lows": "", "level": "", "swap_lows": "---", "i_like": "⚠️",
        "notes": "", "start": "", "transition": "",
    }
    base.update(overrides)
    return base


def test_factory_defaults_and_order(tmp_path):
    with app_client(tmp_path) as c:
        lists = c.get("/api/validation-lists").json()
        assert lists == FACTORY  # list order = dropdown order


def test_delta_factory_is_the_narrow_range(tmp_path):
    """#163 — the FACTORY list is daily-use only, not everything the field takes.

    The range belongs to the constraint, the seven values to the default. A first
    attempt at this issue seeded all 49 semitones; this test is what stops that
    coming back.
    """
    with app_client(tmp_path) as c:
        delta = c.get("/api/validation-lists").json()["delta"]
        assert delta == ["-1.5", "-1", "-0.5", "0", "+0.5", "+1", "+1.5"]
        # Ascending, exact 0.5 steps, endpoints at ±1.5, no duplicates.
        nums = [float(v) for v in delta]
        assert nums == sorted(nums) and len(set(nums)) == 7
        assert nums[0] == -1.5 and nums[-1] == 1.5
        assert all(round(b - a, 6) == 0.5 for a, b in zip(nums, nums[1:]))
        # `0` ships (the interval contains it, and it is what started #163);
        # `+2` deliberately does NOT — a user adds that themselves.
        assert "0" in delta
        assert "+0" not in delta and "-0" not in delta
        assert "+2" not in delta and "-12" not in delta


def test_user_can_add_any_value_in_the_wider_range_and_reset_back(tmp_path):
    """#163 — narrow default, wide constraint: the two are independent."""
    with app_client(tmp_path) as c:
        # Every value the constraint allows can be added, well beyond factory.
        wide = [f"{h / 2:+g}" if h else "0" for h in range(-24, 25)]
        r = c.put("/api/validation-lists/delta", json={"values": wide})
        assert r.status_code == 200
        stored = c.get("/api/validation-lists").json()["delta"]
        assert len(stored) == 49
        assert stored[0] == "-12" and stored[-1] == "+12"
        # ...but only within it.
        assert c.put("/api/validation-lists/delta", json={"values": ["+12.5"]}).status_code == 400

        # Reset returns the seven factory values, not the widened list.
        r = c.post("/api/validation-lists/delta/reset")
        assert r.status_code == 200
        assert r.json()["values"] == FACTORY["delta"]
        assert c.get("/api/validation-lists").json()["delta"] == FACTORY["delta"]


def test_no_startup_migration_touches_the_delta_list(tmp_path):
    """#163 — a user's Δ list is never rewritten behind their back.

    The reverted first attempt topped existing databases up to the full semitone
    range on startup. Nothing does that now: whatever the list holds at shutdown
    is what it holds at the next launch, wider or narrower than factory.
    """
    with app_client(tmp_path) as c:
        data_dir = c.sm3_data_dir
        custom = ["-1", "+1", "+7"]  # narrower than factory AND carrying a custom
        assert c.put("/api/validation-lists/delta", json={"values": custom}).status_code == 200

    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(data_dir=data_dir)) as c:
        assert c.get("/api/validation-lists").json()["delta"] == custom
        # The reverted migration's marker is cleaned up rather than left dangling.
        conn = sqlite3.connect(data_dir / "setmaster3.db")
        try:
            row = conn.execute(
                "SELECT 1 FROM kv WHERE key = 'migration:delta_semitone_range'"
            ).fetchone()
        finally:
            conn.close()
        assert row is None


def test_delta_constraints(tmp_path):
    with app_client(tmp_path) as c:
        put = lambda vals: c.put("/api/validation-lists/delta", json={"values": vals})
        assert put(["0.3"]).status_code == 400          # not a 0.5 multiple
        assert put(["+13"]).status_code == 400          # out of range
        assert put(["-12.5"]).status_code == 400
        assert put(["abc"]).status_code == 400          # not numeric
        assert put(["+1", "+1"]).status_code == 400     # duplicate
        assert put(["---"]).status_code == 400          # system-managed placeholder
        # canonical form gets explicit sign
        r = put(["2", "-2", "3.5", "+12", "-12"])
        assert r.status_code == 200
        assert r.json()["values"] == ["+2", "-2", "+3.5", "+12", "-12"]
        # #163 — zero canonicalizes bare, however it is written, so the one Δ
        # value with no direction never renders as "+0".
        r = put(["0"])
        assert r.status_code == 200 and r.json()["values"] == ["0"]
        assert put(["-0"]).json()["values"] == ["0"]
        assert put(["+0.0"]).json()["values"] == ["0"]
        assert put(["0", "-0"]).status_code == 400      # same value twice


def test_lows_level_constraints_grapheme_limit(tmp_path):
    with app_client(tmp_path) as c:
        for field in ("lows", "level"):
            put = lambda vals: c.put(f"/api/validation-lists/{field}", json={"values": vals})
            assert put([""]).status_code == 400            # empty
            assert put(["   "]).status_code == 400
            assert put(["x" * 17]).status_code == 400      # 17 chars
            assert put(["dup", "dup"]).status_code == 400  # duplicate (case-sensitive)
            assert put(["dup", "DUP"]).status_code == 200  # different case is distinct
            assert put(["x" * 16]).status_code == 200      # 16 chars ok
            # 16 emoji graphemes = 16 chars (grapheme clusters, not code points)
            assert put(["👍" * 16]).status_code == 200
            assert put(["👍" * 17]).status_code == 400
            # a ZWJ family emoji is a single grapheme
            assert put(["👨‍👩‍👧‍👦" + "x" * 15]).status_code == 200


def test_i_like_emoji_only(tmp_path):
    with app_client(tmp_path) as c:
        put = lambda vals: c.put("/api/validation-lists/i_like", json={"values": vals})
        assert put(["abc"]).status_code == 400   # letters
        assert put(["!"]).status_code == 400     # punctuation
        assert put(["5"]).status_code == 400     # digit
        assert put(["🚀💜"]).status_code == 400  # two emoji
        assert put([""]).status_code == 400
        r = put(["🎛️", "⚠️", "👨‍👩‍👧‍👦"])       # VS16 + ZWJ sequences accepted as one
        assert r.status_code == 200
        assert r.json()["values"] == ["🎛️", "⚠️", "👨‍👩‍👧‍👦"]


def test_unknown_field_404(tmp_path):
    with app_client(tmp_path) as c:
        assert c.put("/api/validation-lists/nope", json={"values": []}).status_code == 404
        assert c.post("/api/validation-lists/nope/reset").status_code == 404


def test_rename_propagates_across_all_sets_in_one_call(tmp_path):
    with app_client(tmp_path) as c:
        s1 = c.post("/api/sets", json={"name": "S1"}).json()["id"]
        s2 = c.post("/api/sets", json={"name": "S2"}).json()["id"]
        c.put(f"/api/sets/{s1}/rows", json=[_row(lows="cut"), _row(lows="cut"), _row(lows="open")])
        c.put(f"/api/sets/{s2}/rows", json=[_row(lows="cut")])
        # archived sets propagate too (they are user data)
        s3 = c.post("/api/sets", json={"name": "S3"}).json()["id"]
        c.put(f"/api/sets/{s3}/rows", json=[_row(lows="cut")])
        c.post(f"/api/sets/{s3}/archive")

        r = c.post("/api/validation-lists/lows/rename", json={"old": "cut", "new": "chopped"})
        assert r.status_code == 200
        assert r.json()["rows_updated"] == 4

        assert [row["lows"] for row in c.get(f"/api/sets/{s1}").json()["rows"]] == \
            ["chopped", "chopped", "open"]
        assert c.get(f"/api/sets/{s2}").json()["rows"][0]["lows"] == "chopped"
        lists = c.get("/api/validation-lists").json()
        assert lists["lows"] == ["chopped", "cut-swell", "open", "0.5"]  # position kept

        # rename errors
        assert c.post("/api/validation-lists/lows/rename",
                      json={"old": "nope", "new": "x"}).status_code == 404
        assert c.post("/api/validation-lists/lows/rename",
                      json={"old": "chopped", "new": "open"}).status_code == 409
        assert c.post("/api/validation-lists/lows/rename",
                      json={"old": "chopped", "new": "y" * 17}).status_code == 400


def test_usage_counts(tmp_path):
    with app_client(tmp_path) as c:
        sid = c.post("/api/sets", json={"name": "U"}).json()["id"]
        c.put(f"/api/sets/{sid}/rows", json=[_row(level="HOT"), _row(level="HOT"), _row(level="LP")])
        r = c.get("/api/validation-lists/level/usage", params={"value": "HOT"})
        assert r.json() == {"count": 2}
        assert c.get("/api/validation-lists/level/usage", params={"value": "zzz"}).json() == {"count": 0}


def test_reset_reverts_renames_and_keeps_custom_values_in_rows(tmp_path):
    with app_client(tmp_path) as c:
        sid = c.post("/api/sets", json={"name": "R"}).json()["id"]
        c.put(f"/api/sets/{sid}/rows", json=[_row(lows="cut"), _row(lows="muffle")])

        # rename a factory value, then rename it again (chain)
        c.post("/api/validation-lists/lows/rename", json={"old": "cut", "new": "chop"})
        c.post("/api/validation-lists/lows/rename", json={"old": "chop", "new": "slice"})
        rows = c.get(f"/api/sets/{sid}").json()["rows"]
        assert rows[0]["lows"] == "slice"

        # add a custom value alongside
        c.put("/api/validation-lists/lows",
              json={"values": ["slice", "cut-swell", "open", "0.5", "muffle"]})

        r = c.post("/api/validation-lists/lows/reset")
        assert r.status_code == 200
        assert r.json()["values"] == FACTORY["lows"]
        assert c.get("/api/validation-lists").json()["lows"] == FACTORY["lows"]

        rows = c.get(f"/api/sets/{sid}").json()["rows"]
        # renamed factory value reverts in rows (Rename semantics, back to factory)
        assert rows[0]["lows"] == "cut"
        # custom value follows Remove semantics: kept in the cell, just not offered
        assert rows[1]["lows"] == "muffle"

        # reset affects only its own field
        assert c.get("/api/validation-lists").json()["level"] == FACTORY["level"]


def test_rename_back_to_factory_clears_rename_tracking(tmp_path):
    with app_client(tmp_path) as c:
        sid = c.post("/api/sets", json={"name": "B"}).json()["id"]
        c.put(f"/api/sets/{sid}/rows", json=[_row(level="HOT")])
        c.post("/api/validation-lists/level/rename", json={"old": "HOT", "new": "SCALDING"})
        c.post("/api/validation-lists/level/rename", json={"old": "SCALDING", "new": "HOT"})
        # reset must not touch anything now
        c.post("/api/validation-lists/level/reset")
        assert c.get(f"/api/sets/{sid}").json()["rows"][0]["level"] == "HOT"
        assert c.get("/api/validation-lists").json()["level"] == FACTORY["level"]
