"""Validation-list constraint enforcement (advanced-settings spec §2-3)."""
from __future__ import annotations

from .util import grapheme_len, is_single_emoji

MAX_TEXT_GRAPHEMES = 16


def canonical_delta(value: str) -> str:
    """Validate + canonicalize a Δ value. Raises ValueError when invalid.

    Numeric only; multiples of 0.5; range [-12, +12]; explicit sign display,
    except zero (issue #163) — a signed zero is not a pitch shift in either
    direction, and "+0" in a dropdown reads as a typo. Zero canonicalizes to
    the bare "0", which is also what a user types and what SM2 held.
    """
    s = str(value).strip()
    if not s:
        raise ValueError("Δ value must not be empty")
    try:
        num = float(s)
    except ValueError:
        raise ValueError(f"Δ value must be numeric: {value!r}") from None
    if not (-12 <= num <= 12):
        raise ValueError(f"Δ value out of range [-12, +12]: {value!r}")
    if (num * 2) != int(num * 2):
        raise ValueError(f"Δ value must be a multiple of 0.5: {value!r}")
    if num == 0:
        return "0"
    sign = "-" if num < 0 else "+"
    mag = abs(num)
    text = str(int(mag)) if mag == int(mag) else f"{mag:.1f}"
    return f"{sign}{text}"


def validate_value(field: str, value: str) -> str:
    """Validate one value for a list; returns the canonical stored form."""
    if field == "delta":
        return canonical_delta(value)
    if field in ("lows", "level"):
        s = str(value).strip()
        if not s:
            raise ValueError(f"{field} value must not be empty")
        if grapheme_len(s) > MAX_TEXT_GRAPHEMES:
            raise ValueError(
                f"{field} value exceeds {MAX_TEXT_GRAPHEMES} characters: {value!r}"
            )
        return s
    if field == "i_like":
        s = str(value).strip()
        if not is_single_emoji(s):
            raise ValueError(f"I like value must be exactly one emoji: {value!r}")
        return s
    raise ValueError(f"unknown validation-list field: {field!r}")


def validate_values(field: str, values: list) -> list[str]:
    """Validate a whole list (canonicalized, uniqueness case-sensitive).

    The '---' placeholder is system-managed: never stored in the editable list.
    """
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        if str(v).strip() == "---":
            raise ValueError("'---' is system-managed and cannot be listed")
        c = validate_value(field, v)
        if c in seen:
            raise ValueError(f"duplicate value: {c!r}")
        seen.add(c)
        out.append(c)
    return out
