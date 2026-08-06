"""Canonical 24-key x 4-notation table (planning/03-ui-design.md §6.6).

Internal representation is flats-canonical (`Gbm`, 24 values). The other three
notations are pure display renames of the same key. This is a TABLE, not a
formula (hard requirement) — transcribed verbatim from the spec.
"""
from __future__ import annotations

NOTATIONS = ("flats", "sharps", "camelot", "openkey")

# (flats, sharps, camelot, openkey) — 12 majors then 12 minors, spec row order.
KEY_TABLE: list[tuple[str, str, str, str]] = [
    # majors
    ("C", "C", "8B", "1d"),
    ("Db", "C#", "3B", "8d"),
    ("D", "D", "10B", "3d"),
    ("Eb", "D#", "5B", "10d"),
    ("E", "E", "12B", "5d"),
    ("F", "F", "7B", "12d"),
    ("Gb", "F#", "2B", "7d"),
    ("G", "G", "9B", "2d"),
    ("Ab", "G#", "4B", "9d"),
    ("A", "A", "11B", "4d"),
    ("Bb", "A#", "6B", "11d"),
    ("B", "B", "1B", "6d"),
    # minors
    ("Am", "Am", "8A", "1m"),
    ("Bbm", "A#m", "3A", "8m"),
    ("Bm", "Bm", "10A", "3m"),
    ("Cm", "Cm", "5A", "10m"),
    ("Dbm", "C#m", "12A", "5m"),
    ("Dm", "Dm", "7A", "12m"),
    ("Ebm", "D#m", "2A", "7m"),
    ("Em", "Em", "9A", "2m"),
    ("Fm", "Fm", "4A", "9m"),
    ("Gbm", "F#m", "11A", "4m"),
    ("Gm", "Gm", "6A", "11m"),
    ("Abm", "G#m", "1A", "6m"),
]

FLATS_KEYS: tuple[str, ...] = tuple(row[0] for row in KEY_TABLE)

# flats key -> {notation: display value}
_BY_FLATS: dict[str, dict[str, str]] = {
    row[0]: dict(zip(NOTATIONS, row)) for row in KEY_TABLE
}

# any notation's value -> flats key (case-sensitive on notation values)
_TO_FLATS: dict[str, str] = {}
for _row in KEY_TABLE:
    for _val in _row:
        _TO_FLATS.setdefault(_val, _row[0])


def is_canonical(key: str) -> bool:
    return key in _BY_FLATS


def to_notation(flats_key: str, notation: str) -> str | None:
    """Render a canonical flats key in one of the 4 notations. None if unknown."""
    if notation not in NOTATIONS:
        raise ValueError(f"unknown notation: {notation!r}")
    entry = _BY_FLATS.get(flats_key)
    return entry[notation] if entry else None


def from_any_notation(value: str) -> str | None:
    """Map a value in any of the 4 notations back to the canonical flats key."""
    return _TO_FLATS.get(value.strip())
