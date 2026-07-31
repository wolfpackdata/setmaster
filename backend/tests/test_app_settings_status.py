"""Settings (partial PUT, collection.nml filename rule, display bounds) + status."""
from __future__ import annotations

from test_app_helpers import app_client, configure_collection


def test_settings_defaults(tmp_path):
    with app_client(tmp_path) as c:
        s = c.get("/api/settings").json()
        assert s["collection_nml_path"] == ""
        assert s["super_playlist_folder"] == ""
        assert s["exclude_prefixes"] == []
        assert s["display"] == {
            "line_spacing": 100, "font_size": 13,
            "key_display_as": "flats", "colorful_keys": True,
            "matrix_zoom": 100,  # issue #81
            # Issue #140 — S2 column visibility, both visible by default.
            "show_timing_columns": True,
            "show_mix_timer_column": True,
            # Issue #145 — loud cue columns, both off by default.
            "loud_t_column": False,
            "loud_m_column": False,
        }
        assert s["last_export_format"] == "xlsx"


def test_settings_partial_put_and_persistence(tmp_path):
    with app_client(tmp_path) as c:
        r = c.put("/api/settings", json={"display": {"font_size": 15}})
        assert r.status_code == 200
        s = r.json()
        assert s["display"]["font_size"] == 15
        assert s["display"]["line_spacing"] == 100  # untouched by partial PUT

        c.put("/api/settings", json={
            "super_playlist_folder": "$ROOT",
            "exclude_prefixes": ["zz_", "_archive"],
            "last_export_format": "csv",
            "display": {"key_display_as": "camelot", "colorful_keys": False},
        })
        s = c.get("/api/settings").json()
        assert s["super_playlist_folder"] == "$ROOT"
        assert s["exclude_prefixes"] == ["zz_", "_archive"]
        assert s["last_export_format"] == "csv"
        assert s["display"]["key_display_as"] == "camelot"
        assert s["display"]["colorful_keys"] is False
        assert s["display"]["font_size"] == 15  # earlier change persisted


def test_line_spacing_migration_from_legacy_text_zoom(tmp_path):
    """Issue #78 / R3: a pre-#78 settings file carrying the inverse `text_zoom`
    key loads as an equivalent-density `line_spacing`, never reset. Covers the
    default file, a non-default zoom, a missing key, and idempotence."""
    from app.db import connect, get_settings, kv_set

    with app_client(tmp_path) as c:
        db_path = c.sm3_data_dir / "setmaster3.db"

        def seed(display: dict) -> None:
            conn = connect(db_path)
            try:
                s = get_settings(conn)
                s["display"] = display  # store a raw (possibly legacy) display block
                kv_set(conn, "settings", s)
            finally:
                conn.close()

        base = {"font_size": 13, "key_display_as": "flats", "colorful_keys": True}

        # Default legacy zoom 100 -> spacing 100: density is exactly preserved.
        seed({"text_zoom": 100, **base})
        d = c.get("/api/settings").json()["display"]
        assert d["line_spacing"] == 100
        assert "text_zoom" not in d

        # Non-default zoom 150 -> ~67 -> snaps/clamps to the 70 floor.
        seed({"text_zoom": 150, **base})
        assert c.get("/api/settings").json()["display"]["line_spacing"] == 70

        # Zoom 70 -> ~143 -> snaps to 140 (within range).
        seed({"text_zoom": 70, **base})
        assert c.get("/api/settings").json()["display"]["line_spacing"] == 140

        # Missing key entirely -> default line_spacing 100.
        seed(dict(base))
        assert c.get("/api/settings").json()["display"]["line_spacing"] == 100

        # Already-migrated file is idempotent (no re-conversion, no stray key).
        seed({"line_spacing": 120, **base})
        d = c.get("/api/settings").json()["display"]
        assert d["line_spacing"] == 120
        assert "text_zoom" not in d


def test_matrix_zoom_absent_defaults_100_and_persists(tmp_path):
    """Issue #81 / acceptance 6: an existing settings file without the
    `matrix_zoom` key loads as 100 (deep-filled, no migration), and a valid
    in-range PUT persists."""
    from app.db import connect, get_settings, kv_set  # mirrors sibling tests

    with app_client(tmp_path) as c:
        db_path = c.sm3_data_dir / "setmaster3.db"
        # Seed a display block WITHOUT matrix_zoom (pre-#81 file shape).
        conn = connect(db_path)
        try:
            s = get_settings(conn)
            s["display"] = {
                "line_spacing": 100, "font_size": 13,
                "key_display_as": "flats", "colorful_keys": True,
            }
            kv_set(conn, "settings", s)
        finally:
            conn.close()

        assert c.get("/api/settings").json()["display"]["matrix_zoom"] == 100

        r = c.put("/api/settings", json={"display": {"matrix_zoom": 70}})
        assert r.status_code == 200
        assert r.json()["display"]["matrix_zoom"] == 70
        assert c.get("/api/settings").json()["display"]["matrix_zoom"] == 70


def test_collection_nml_filename_rule(tmp_path):
    with app_client(tmp_path) as c:
        bad = str(tmp_path / "collection.xml")
        assert c.put("/api/settings", json={"collection_nml_path": bad}).status_code == 400
        bad2 = str(tmp_path / "Collection.nml")  # exact filename required
        assert c.put("/api/settings", json={"collection_nml_path": bad2}).status_code == 400
        good = str(tmp_path / "sub" / "collection.nml")
        assert c.put("/api/settings", json={"collection_nml_path": good}).status_code == 200
        # clearing is allowed
        assert c.put("/api/settings", json={"collection_nml_path": ""}).status_code == 200


def test_settings_validation_errors(tmp_path):
    with app_client(tmp_path) as c:
        assert c.put("/api/settings", json={"display": {"line_spacing": 60}}).status_code == 400
        assert c.put("/api/settings", json={"display": {"line_spacing": 160}}).status_code == 400
        assert c.put("/api/settings", json={"display": {"font_size": 9}}).status_code == 400
        assert c.put("/api/settings", json={"display": {"font_size": 21}}).status_code == 400
        assert c.put("/api/settings", json={"display": {"key_display_as": "solfege"}}).status_code == 400
        assert c.put("/api/settings", json={"display": {"colorful_keys": "yes"}}).status_code == 400
        # Issue #81: matrix_zoom bounds 50–150; booleans rejected (bool ⊂ int).
        assert c.put("/api/settings", json={"display": {"matrix_zoom": 40}}).status_code == 400
        assert c.put("/api/settings", json={"display": {"matrix_zoom": 160}}).status_code == 400
        assert c.put("/api/settings", json={"display": {"matrix_zoom": True}}).status_code == 400
        assert c.put("/api/settings", json={"last_export_format": "pdf"}).status_code == 400
        assert c.put("/api/settings", json={"exclude_prefixes": "zz_"}).status_code == 400


def test_status_shape(tmp_path):
    with app_client(tmp_path) as c:
        st = c.get("/api/status").json()
        assert st["app_version"]
        assert st["app_data_dir"] == str(c.sm3_data_dir)
        assert st["collection"]["exists"] is False
        assert st["collection"]["last_read_iso"] is None
        assert st["pipeline"]["state"] == "idle"

        configure_collection(c, tmp_path)
        st = c.get("/api/status").json()
        assert st["collection"]["exists"] is True
        assert st["collection"]["mtime_iso"]


def test_data_dir_layout_created(tmp_path):
    with app_client(tmp_path) as c:
        d = c.sm3_data_dir
        assert (d / "setmaster3.db").is_file()
        assert (d / "raw-data" / "exportify").is_dir()
        assert (d / "pipeline-work").is_dir()


def test_column_visibility_absent_defaults_true_and_persists(tmp_path):
    """Issue #140: a settings file written before the S2 column-visibility keys
    existed loads with both columns VISIBLE (deep-filled, no migration), each
    flag persists independently, and non-booleans are rejected."""
    from app.db import connect, get_settings, kv_set  # mirrors sibling tests

    with app_client(tmp_path) as c:
        db_path = c.sm3_data_dir / "setmaster3.db"
        # Seed a display block WITHOUT the #140 keys (pre-#140 file shape).
        conn = connect(db_path)
        try:
            s = get_settings(conn)
            s["display"] = {
                "line_spacing": 100, "font_size": 13,
                "key_display_as": "flats", "colorful_keys": True,
                "matrix_zoom": 100,
            }
            kv_set(conn, "settings", s)
        finally:
            conn.close()

        d = c.get("/api/settings").json()["display"]
        assert d["show_timing_columns"] is True
        assert d["show_mix_timer_column"] is True

        # Each flag persists on its own; a partial PUT leaves the other alone.
        r = c.put("/api/settings", json={"display": {"show_timing_columns": False}})
        assert r.status_code == 200
        assert r.json()["display"]["show_timing_columns"] is False
        assert r.json()["display"]["show_mix_timer_column"] is True
        d = c.get("/api/settings").json()["display"]
        assert d["show_timing_columns"] is False
        assert d["show_mix_timer_column"] is True

        r = c.put("/api/settings", json={"display": {"show_mix_timer_column": False}})
        assert r.status_code == 200
        d = c.get("/api/settings").json()["display"]
        assert d["show_timing_columns"] is False
        assert d["show_mix_timer_column"] is False

        # Non-booleans are rejected rather than coerced.
        for bad in (1, "true", None):
            assert c.put(
                "/api/settings", json={"display": {"show_timing_columns": bad}}
            ).status_code == 400


def test_loud_cue_columns_default_off_and_persist(tmp_path):
    """Issue #145: the two loud-cue-column flags default OFF, deep-fill into a
    settings file written before them, persist independently, and reject
    non-booleans."""
    from app.db import connect, get_settings, kv_set

    with app_client(tmp_path) as c:
        d = c.get("/api/settings").json()["display"]
        assert d["loud_t_column"] is False
        assert d["loud_m_column"] is False

        db_path = c.sm3_data_dir / "setmaster3.db"
        conn = connect(db_path)
        try:
            s = get_settings(conn)
            s["display"] = {
                "line_spacing": 100, "font_size": 13,
                "key_display_as": "flats", "colorful_keys": True,
                "matrix_zoom": 100,
            }
            kv_set(conn, "settings", s)
        finally:
            conn.close()
        d = c.get("/api/settings").json()["display"]
        assert d["loud_t_column"] is False
        assert d["loud_m_column"] is False

        r = c.put("/api/settings", json={"display": {"loud_t_column": True}})
        assert r.status_code == 200
        assert r.json()["display"]["loud_t_column"] is True
        assert r.json()["display"]["loud_m_column"] is False
        assert c.get("/api/settings").json()["display"]["loud_t_column"] is True

        assert c.put(
            "/api/settings", json={"display": {"loud_m_column": "yes"}}
        ).status_code == 400
