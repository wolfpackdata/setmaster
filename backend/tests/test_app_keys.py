"""keys.py: the canonical 24-key × 4-notation table — all 96 cells verified
against planning/03-ui-design.md §6.6 (transcribed independently here)."""
from __future__ import annotations

import pytest

from app import keys

# Independent transcription of the §6.6 table: flats -> (sharps, camelot, openkey)
SPEC = {
    # majors
    "C":  ("C",  "8B",  "1d"),
    "Db": ("C#", "3B",  "8d"),
    "D":  ("D",  "10B", "3d"),
    "Eb": ("D#", "5B",  "10d"),
    "E":  ("E",  "12B", "5d"),
    "F":  ("F",  "7B",  "12d"),
    "Gb": ("F#", "2B",  "7d"),
    "G":  ("G",  "9B",  "2d"),
    "Ab": ("G#", "4B",  "9d"),
    "A":  ("A",  "11B", "4d"),
    "Bb": ("A#", "6B",  "11d"),
    "B":  ("B",  "1B",  "6d"),
    # minors
    "Am":  ("Am",  "8A",  "1m"),
    "Bbm": ("A#m", "3A",  "8m"),
    "Bm":  ("Bm",  "10A", "3m"),
    "Cm":  ("Cm",  "5A",  "10m"),
    "Dbm": ("C#m", "12A", "5m"),
    "Dm":  ("Dm",  "7A",  "12m"),
    "Ebm": ("D#m", "2A",  "7m"),
    "Em":  ("Em",  "9A",  "2m"),
    "Fm":  ("Fm",  "4A",  "9m"),
    "Gbm": ("F#m", "11A", "4m"),
    "Gm":  ("Gm",  "6A",  "11m"),
    "Abm": ("G#m", "1A",  "6m"),
}


def test_exactly_24_canonical_keys():
    assert len(keys.KEY_TABLE) == 24
    assert set(keys.FLATS_KEYS) == set(SPEC)
    assert len(set(keys.FLATS_KEYS)) == 24


@pytest.mark.parametrize("flats", sorted(SPEC))
def test_all_four_notations_per_key(flats):
    sharps, camelot, openkey = SPEC[flats]
    assert keys.to_notation(flats, "flats") == flats
    assert keys.to_notation(flats, "sharps") == sharps
    assert keys.to_notation(flats, "camelot") == camelot
    assert keys.to_notation(flats, "openkey") == openkey


@pytest.mark.parametrize("flats", sorted(SPEC))
def test_reverse_lookup_from_every_notation(flats):
    sharps, camelot, openkey = SPEC[flats]
    for value in (flats, sharps, camelot, openkey):
        assert keys.from_any_notation(value) == flats


def test_camelot_and_openkey_cover_full_wheel():
    camelots = {v[1] for v in SPEC.values()}
    assert camelots == {f"{n}{ring}" for n in range(1, 13) for ring in "AB"}
    openkeys = {v[2] for v in SPEC.values()}
    assert openkeys == {f"{n}{ring}" for n in range(1, 13) for ring in "dm"}


def test_unknowns_and_bad_notation():
    assert keys.to_notation("H", "flats") is None
    assert keys.from_any_notation("Hb") is None
    assert not keys.is_canonical("F#m")  # sharps spelling is not canonical
    assert keys.is_canonical("Gbm")
    with pytest.raises(ValueError):
        keys.to_notation("C", "solfege")
