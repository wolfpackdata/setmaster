"""Unit tests for the verbatim-ported SM2 matching/normalization heuristics.

These pin the *legacy* behaviors — including its quirks (e.g. 'dub' term
removal inside words). If one of these fails after an edit, the port has
drifted from SM2; fix the port, not the test.
"""

from pathlib import Path

import pandas as pd
import pytest

from pipeline.stage2_playlists import (
    MUSICAL_KEY_MAP,
    build_track_playlist_matrix,
    extract_filename_from_track_key,
)
from pipeline.stage3_compare import normalize_filename
from pipeline.stage4_join import (
    clean_track_name,
    format_traktor_key,
    join_playlists,
    process_spotify_playlist,
    process_traktor_playlist,
)


# ---------------------------------------------------------------------------
# clean_track_name
# ---------------------------------------------------------------------------

class TestCleanTrackName:
    def test_accents_nfkd(self):
        assert clean_track_name("Beyoncé") == "beyonce"
        assert clean_track_name("Sómbre Träck") == "sombre track"

    @pytest.mark.parametrize("raw,expected", [
        ("Kızıl", "kizil"),        # ı -> i (no NFKD decomposition)
        ("Røyksopp", "royksopp"),  # ø -> o
        ("Łaska", "laska"),        # ł -> l
        ("Straße", "strase"),      # ß -> s (single s, per the manual map)
        ("Æon", "aon"),            # Æ -> A
        ("Œuvre", "ouvre"),        # Œ -> O
        ("Þorn", "torn"),          # Þ -> T
        ("Ðavid", "david"),        # Ð -> D
    ])
    def test_manual_transliteration_map(self, raw, expected):
        assert clean_track_name(raw) == expected

    def test_punctuation(self):
        # '-' and ',' become spaces; '/()[]' are removed outright
        assert clean_track_name("Hello-World") == "hello world"
        assert clean_track_name("One,Two") == "one two"
        assert clean_track_name("A/B (C) [D]") == "ab c d"

    @pytest.mark.parametrize("raw,expected", [
        ("Song (Original Mix)", "song"),
        ("Song (Extended Mix)", "song"),
        ("Song (Extended Remix)", "song"),
        ("Song - Remastered", "song"),
        ("Song (Vocal Dub Mix)", "song"),
        ("Song Edit", "song"),           # ' edit' with leading space
    ])
    def test_term_removal(self, raw, expected):
        assert clean_track_name(raw) == expected

    def test_term_removal_is_substring_based_legacy_quirk(self):
        # SM2 removes terms as raw substrings — 'dub' inside a word too.
        # This quirk is part of the verbatim contract.
        assert clean_track_name("Dublin") == "lin"

    def test_feat_truncation(self):
        assert clean_track_name("Track feat. Somebody") == "track"
        assert clean_track_name("Track featuring Somebody") == "track"
        assert clean_track_name("Track (feat. Somebody)") == "track"
        # 'feat' with no preceding space is kept
        assert clean_track_name("Defeat") == "defeat"

    def test_whitespace_collapse_and_trim(self):
        assert clean_track_name("  A   B  ") == "a b"

    def test_nan_and_empty(self):
        assert clean_track_name(float("nan")) == ""
        assert clean_track_name(None) == ""
        assert clean_track_name("") == ""


# ---------------------------------------------------------------------------
# stage 3 filename normalization
# ---------------------------------------------------------------------------

class TestNormalizeFilename:
    def test_extension_dropped(self):
        assert normalize_filename("Disco_Cosmic.csv") == "discocosmic"

    def test_original_mix_removed(self):
        assert normalize_filename("Song (Original Mix).csv") == "song"
        assert normalize_filename("song original   mix.csv") == "song"

    def test_accents_transliterated(self):
        assert normalize_filename("Café del Mar.csv") == "cafedelmar"

    def test_non_alphanumerics_stripped(self):
        assert normalize_filename("VNRBLM-7-18-2026.csv") == "vnrblm7182026"
        assert normalize_filename("90s_Never_Die.csv") == "90sneverdie"

    def test_lowercased(self):
        assert normalize_filename("AgedBEEF.csv") == "agedbeef"


# ---------------------------------------------------------------------------
# numeric key map (stage 2) — all 24 values
# ---------------------------------------------------------------------------

def test_musical_key_value_map_all_24():
    expected = {
        0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
        6: 'Gb', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B',
        12: 'Cm', 13: 'Dbm', 14: 'Dm', 15: 'Ebm', 16: 'Em', 17: 'Fm',
        18: 'Gbm', 19: 'Gm', 20: 'Abm', 21: 'Am', 22: 'Bbm', 23: 'Bm',
    }
    assert MUSICAL_KEY_MAP == expected
    # flats-canonical: no sharps anywhere
    assert not any('#' in v for v in MUSICAL_KEY_MAP.values())


# ---------------------------------------------------------------------------
# format_traktor_key (stage 4 free-text/Open-Key map)
# ---------------------------------------------------------------------------

class TestFormatTraktorKey:
    @pytest.mark.parametrize("raw,expected", [
        ("Gmin", "Gm"), ("Gmaj", "G"), ("Gm", "Gm"),
        ("G#m", "G#m"), ("G#", "G#"),
        ("Fmin", "Fm"), ("Ebmaj", "Eb"), ("C#min", "C#m"),
        ("Amin", "Am"), ("Bbmin", "Bbm"),
        # Open-Key style codes
        ("1m", "Bbm"), ("1d", "Bb"), ("2M", "F#"), ("2d", "F#m"),
        ("8M", "C"), ("8d", "Cm"), ("9m", "Gm"), ("12d", "Em"),
        ("11D", "A#"), ("7M", "F"),
    ])
    def test_map_samples(self, raw, expected):
        assert format_traktor_key(raw) == expected

    def test_unknown_passthrough_and_strip(self):
        assert format_traktor_key("Hmix") == "Hmix"   # unknown -> unchanged
        assert format_traktor_key("  Gm  ") == "Gm"   # stripped before lookup

    def test_empty_and_nan(self):
        assert format_traktor_key("") == ""
        assert format_traktor_key(float("nan")) == ""


# ---------------------------------------------------------------------------
# extract_filename_from_track_key
# ---------------------------------------------------------------------------

def test_extract_filename_from_track_key():
    tk = "C:/:studio/:dj sound/:tracks/:lossless/:01 Like You.m4a"
    assert extract_filename_from_track_key(tk) == "01 Like You.m4a"
    assert extract_filename_from_track_key("no colon here") == "no colon here"
    assert extract_filename_from_track_key(float("nan")) is None


# ---------------------------------------------------------------------------
# presence_flag — all 4 states via synthetic playlist fixtures
# ---------------------------------------------------------------------------

SPOTIFY_HEADER = ("Track URI,Track Name,Album Name,Artist Name(s),Release Date,"
                  "Duration (ms),Popularity,Explicit,Added By,Added At,Genres,"
                  "Record Label,Danceability,Energy,Key,Loudness,Mode,Speechiness,"
                  "Acousticness,Instrumentalness,Liveness,Valence,Tempo,Time Signature")

TRAKTOR_HEADER = ("modified_date,modified_time,audio_id,title,artist,volume,dir,file,"
                  "volume_id,full_path,track_key,album_title,album_track,album_of_tracks,"
                  "bitrate,genre,comment,key,playcount,playtime,playtime_float,"
                  "import_date,last_played,release_date,ranking,filesize,bpm,bpm_quality,"
                  "peak_db,perceived_db,analyzed_db,musical_key_value")


def _spotify_row(name, artist="Artist A", uri="spotify:track:x"):
    return (f"{uri},{name},Album X,{artist},2024-01-01,200000,50,false,me,"
            f"2024-02-01,house,LabelX,0.5,0.5,5,-7.0,1,0.05,0.1,0.0,0.1,0.5,120.0,4")


def _traktor_row(name, audio_id, filename, artist="Artist A"):
    return (f"2024/1/1,1000,{audio_id},{name},{artist},C:,/:music/:,{filename},"
            f"vol1,C:\\music\\{filename},C:/:music/:{filename},Release X,1,10,"
            f"320,House,,8d,3,300,300.5,2024/1/2,2024/3/1,2024/1/1,0,9999999,"
            f"120.000000,1,0.5,-7.0,-7.0,19")


@pytest.fixture()
def joined_synthetic(tmp_path):
    """Four tracks covering the four presence_flag states:

    - Alpha Song: Spotify playlist + Traktor playlist  -> Yes-Trak-Playlist
    - Beta Song:  Spotify playlist + collection only   -> Not-Trak-Playlist / Yes-Trak-Collection
    - Gamma Song: Spotify playlist only                -> Not-Trak-Collection
    - Delta Song: Traktor playlist only                -> Not-Spotify / Yes-Trak-Playlist
    """
    spotify_csv = tmp_path / "spotify.csv"
    spotify_csv.write_text(
        "\n".join([SPOTIFY_HEADER,
                   _spotify_row("Alpha Song"),
                   _spotify_row("Beta Song"),
                   _spotify_row("Gamma Song")]) + "\n",
        encoding="utf-8-sig",
    )

    traktor_playlist_csv = tmp_path / "traktor_playlist.csv"
    traktor_playlist_csv.write_text(
        "\n".join([TRAKTOR_HEADER,
                   _traktor_row("Alpha Song", "AUD1", "alpha.mp3"),
                   _traktor_row("Delta Song", "AUD4", "delta.mp3")]) + "\n",
        encoding="utf-8-sig",
    )

    collection_csv = tmp_path / "traktor_collection_tracks.csv"
    collection_csv.write_text(
        "\n".join([TRAKTOR_HEADER,
                   _traktor_row("Alpha Song", "AUD1", "alpha.mp3"),
                   _traktor_row("Beta Song", "AUD2", "beta.mp3"),
                   _traktor_row("Delta Song", "AUD4", "delta.mp3")]) + "\n",
        encoding="utf-8-sig",
    )

    spotify_df = process_spotify_playlist(spotify_csv)
    traktor_df = process_traktor_playlist(traktor_playlist_csv)
    collection_df = process_traktor_playlist(collection_csv)
    return join_playlists(spotify_df, traktor_df, collection_df)


class TestPresenceFlag:
    def _flag_for(self, joined, track):
        rows = joined[joined["track_collate"] == track]
        assert len(rows) == 1, f"expected exactly one row for {track}: got {len(rows)}"
        return rows.iloc[0]["presence_flag"]

    def test_in_both(self, joined_synthetic):
        assert self._flag_for(joined_synthetic, "Alpha Song") == "Yes-Trak-Playlist"

    def test_in_spotify_and_collection_not_playlist(self, joined_synthetic):
        assert (self._flag_for(joined_synthetic, "Beta Song")
                == "Not-Trak-Playlist / Yes-Trak-Collection")

    def test_spotify_only(self, joined_synthetic):
        assert self._flag_for(joined_synthetic, "Gamma Song") == "Not-Trak-Collection"

    def test_traktor_only(self, joined_synthetic):
        assert (self._flag_for(joined_synthetic, "Delta Song")
                == "Not-Spotify / Yes-Trak-Playlist")

    def test_sorted_by_track_collate(self, joined_synthetic):
        collates = joined_synthetic["track_collate"].tolist()
        assert collates == sorted(collates)

    def test_output_columns_exact(self, joined_synthetic):
        assert list(joined_synthetic.columns) == [
            "presence_flag", "spotify_trackjoin", "trak_trackjoin",
            "artist_collate", "track_collate", "trak_collection_file_paths",
            "spotify_track_name", "traktor_title", "spotify_artists",
            "traktor_artists", "spotify_album_name", "traktor_release_name",
            "spotify_bpm", "traktor_bpm", "spotify_trackkey", "traktor_trackkey",
            "spotify_uri", "key_formatted",
        ]

    def test_collate_prefers_spotify(self, joined_synthetic):
        alpha = joined_synthetic[joined_synthetic["track_collate"] == "Alpha Song"].iloc[0]
        assert alpha["spotify_track_name"] == "Alpha Song"
        assert alpha["traktor_title"] == "Alpha Song"
        # Beta's file path comes from the collection backfill
        beta = joined_synthetic[joined_synthetic["track_collate"] == "Beta Song"].iloc[0]
        assert beta["trak_collection_file_paths"].endswith("beta.mp3")


# ---------------------------------------------------------------------------
# matrix: exclusion rules + root/non-root counting
# ---------------------------------------------------------------------------

def _write_matrix_inputs(work_dir: Path):
    traktor = work_dir / "Traktor"
    traktor.mkdir(parents=True)

    playlists = pd.DataFrame([
        # RootA lives in the Super Playlist folder 'RML root'
        {"playlist_path": "$ROOT/RML root/RootA", "playlist_name": "RootA",
         "playlist_folder": "RML root", "playlist_type": "PLAYLIST",
         "playlist_entries_count": 3, "track_key": "K1", "track_name": "Track One"},
        {"playlist_path": "$ROOT/RML root/RootA", "playlist_name": "RootA",
         "playlist_folder": "RML root", "playlist_type": "PLAYLIST",
         "playlist_entries_count": 3, "track_key": "K2", "track_name": "Track Two"},
        # a '--' track: excluded from the matrix entirely
        {"playlist_path": "$ROOT/RML root/RootA", "playlist_name": "RootA",
         "playlist_folder": "RML root", "playlist_type": "PLAYLIST",
         "playlist_entries_count": 3, "track_key": "K3", "track_name": "--silence"},
        # GigOne is a non-root performance playlist
        {"playlist_path": "$ROOT/RML Sets/GigOne", "playlist_name": "GigOne",
         "playlist_folder": "RML Sets", "playlist_type": "PLAYLIST",
         "playlist_entries_count": 1, "track_key": "K1", "track_name": "Track One"},
        # zzzskip matches the exclusion prefix
        {"playlist_path": "$ROOT/zzzold/zzzskip", "playlist_name": "zzzskip",
         "playlist_folder": "zzzold", "playlist_type": "PLAYLIST",
         "playlist_entries_count": 1, "track_key": "K2", "track_name": "Track Two"},
    ])
    playlists.to_csv(traktor / "traktor_collection_playlists.csv",
                     index=False, encoding="utf-8-sig")

    tracks = pd.DataFrame([
        {"track_key": "K1", "artist": "Artist 1", "release_date": "2024/1/1",
         "bpm": 120.0, "key": "8d", "musical_key_value": 19,
         "import_date": "2024/1/2", "album_title": "Alb 1",
         "last_played": "2024/3/1", "playcount": 3},
        {"track_key": "K2", "artist": "Artist 2", "release_date": "2023/6/1",
         "bpm": 124.0, "key": "3m", "musical_key_value": None,
         "import_date": "2023/6/2", "album_title": "Alb 2",
         "last_played": "2023/7/1", "playcount": 0},
        {"track_key": "K3", "artist": "Artist 3", "release_date": "2022/1/1",
         "bpm": 100.0, "key": "1m", "musical_key_value": 0,
         "import_date": "2022/1/2", "album_title": "Alb 3",
         "last_played": "2022/2/1", "playcount": 1},
    ])
    tracks.to_csv(traktor / "traktor_collection_tracks.csv",
                  index=False, encoding="utf-8-sig")


class TestMatrix:
    def _build(self, tmp_path, root_folder_name, exclude_prefixes):
        _write_matrix_inputs(tmp_path)
        out, warnings = build_track_playlist_matrix(
            tmp_path, root_folder_name, exclude_prefixes)
        return pd.read_csv(out, encoding="utf-8-sig"), warnings

    def test_exclusions_and_counts(self, tmp_path):
        m, _ = self._build(tmp_path, "rml ROOT", ["zzz"])  # case-insensitive root

        # excluded playlist column gone; excluded '--' track row gone
        assert "zzzskip" not in m.columns
        assert not m["Track Name"].str.startswith("--").any()
        assert set(m["Track Name"]) == {"Track One", "Track Two"}

        # fixed columns then playlists A-Z
        assert list(m.columns) == [
            "Track Key", "Import Date", "Release Date", "Last Played", "Play Count",
            "BPM", "Key", "Album Title", "Artist Name", "Track Name",
            "On Root PL", "On Non-Root PL", "GigOne", "RootA",
        ]

        one = m[m["Track Name"] == "Track One"].iloc[0]
        two = m[m["Track Name"] == "Track Two"].iloc[0]
        # Track One: on RootA (root) + GigOne (non-root)
        assert one["On Root PL"] == 1 and one["On Non-Root PL"] == 1
        # Track Two: on RootA only (zzzskip excluded before counting)
        assert two["On Root PL"] == 1 and two["On Non-Root PL"] == 0

        # numeric key map wins over free text; free text kept when numeric absent
        assert one["Key"] == "Gm"    # musical_key_value 19
        assert two["Key"] == "3m"    # no numeric value -> raw text preserved

    def test_blank_root_folder_counts_zero(self, tmp_path):
        m, warnings = self._build(tmp_path, "", [])
        assert (m["On Root PL"] == 0).all()
        assert (m["On Non-Root PL"] > 0).all()
        assert any("No root folder name" in w for w in warnings)

    def test_unknown_root_folder_warns(self, tmp_path):
        m, warnings = self._build(tmp_path, "Nonexistent Folder", [])
        assert (m["On Root PL"] == 0).all()
        assert any("was not found" in w for w in warnings)

    def test_prefix_match_is_on_lowercased_name(self, tmp_path):
        # SM2 lowercases the playlist name before the prefix test
        m, _ = self._build(tmp_path, "RML root", ["ZZZ".lower()])
        assert "zzzskip" not in m.columns
