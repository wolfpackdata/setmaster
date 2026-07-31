"""Shared helpers: timestamps, name normalization, grapheme/emoji validation."""
from __future__ import annotations

import datetime
import os
import re
import unicodedata
from pathlib import Path

import regex as _regex  # grapheme-cluster (\X) support


def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def mtime_iso(path: Path) -> str:
    ts = path.stat().st_mtime
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).isoformat(timespec="seconds")


def parse_iso(s: str) -> datetime.datetime | None:
    try:
        dt = datetime.datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


# --- playlist-name normalization (canonical rule, exportify-import.md §4) ---

def normalize_playlist_name(s: str) -> str:
    """underscores -> spaces, remove ALL spaces, casefold. Punctuation significant.

    The single definition of this rule (planning/01-data-model.md §7.1,
    exportify-import.md §4). App-layer only: it matches Exportify filename
    slugs against Traktor playlist names for config/display purposes. The
    ported pipeline stages deliberately do NOT use it — they keep SM2's own
    rules (case-insensitive name match in stage 2, `normalize_filename` in
    stage 3), which are ported verbatim and must not be replaced by this.
    """
    return s.replace("_", " ").replace(" ", "").casefold()


def display_name_from_slug(slug: str) -> str:
    """underscores -> spaces, title-case each word (first letter upper, rest kept)."""
    words = slug.replace("_", " ").split()
    return " ".join(w[:1].upper() + w[1:] for w in words)


def slug_from_filename(filename: str) -> str:
    """Strip extension and any browser duplicate suffix ' (n)'."""
    stem = os.path.splitext(os.path.basename(filename))[0]
    return re.sub(r"\s\(\d+\)$", "", stem)


# --- grapheme / emoji validation (advanced-settings spec §2) ---

def graphemes(s: str) -> list[str]:
    """Split into user-perceived characters (grapheme clusters)."""
    return _regex.findall(r"\X", s)


def grapheme_len(s: str) -> int:
    return len(graphemes(s))


_EMOJI_ALLOWED_CATEGORIES = {"So", "Sk", "Sm", "Cf", "Mn", "Me"}


def is_single_emoji(s: str) -> bool:
    """Exactly one emoji grapheme cluster: no letters/digits/punctuation/whitespace.

    Multi-codepoint emoji (VS16, ZWJ sequences, skin tones, flags) count as one.
    """
    clusters = graphemes(s)
    if len(clusters) != 1:
        return False
    has_symbol = False
    for ch in clusters[0]:
        cat = unicodedata.category(ch)
        if cat not in _EMOJI_ALLOWED_CATEGORIES:
            return False
        if cat == "So":
            has_symbol = True
    return has_symbol
