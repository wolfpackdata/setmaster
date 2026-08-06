"""Factory defaults: validation lists and settings.

Sources: advanced-settings-validation-lists.md §2 (lists, from SM2 `load` tab),
03-ui-design.md §3.5 (display options), api-contract.md (settings shape).
"""
from __future__ import annotations

from .validation import canonical_delta

# Issue #163 — the Δ FACTORY list is the narrow range in daily use: -1.5 … +1.5
# in 0.5 steps, seven values. It is deliberately NOT the full range the field
# accepts.
#
# The distinction is the whole point of the issue, and the first attempt at it
# got it backwards by seeding all 49 semitones: the RANGE belongs to the
# CONSTRAINT (`canonical_delta`, [-12, +12] in 0.5 steps), which is what a user
# may add; the FACTORY DEFAULT is only what ships out of the box, and a 49-item
# dropdown to pick `+0.5` from is worse than the problem it solved. Reset to
# factory returns these seven, because it reads this same list.
#
# `0` is included: "[-1.5, +1.5] in 0.5 steps" contains it, and it was the value
# tripping the ◦ legacy-value marker that started this issue. It is also why
# `canonical_delta` returns a bare "0" rather than "+0" — see there.
#
# Generated from `canonical_delta` rather than typed out so the two cannot drift
# on sign or zero formatting. Ascending order is the natural reading order; #141
# sorts the set-page dropdown by signed value at render time regardless, and
# Settings → Advanced shows the stored order.
DELTA_FACTORY: list[str] = [canonical_delta(half / 2) for half in range(-3, 4)]

# list order = dropdown order
FACTORY_VALIDATION_LISTS: dict[str, list[str]] = {
    "delta": list(DELTA_FACTORY),
    "lows": ["cut", "cut-swell", "open", "0.5"],
    "level": ["silence", "open", "HOT", "HOT-LP", "LP", "HP", "LP-silence", "HP-silence"],
    "i_like": ["\U0001F680", "\U0001F49C", "✔️", "⚠️", "\U0001F7E5"],
}

VALIDATION_FIELDS = tuple(FACTORY_VALIDATION_LISTS.keys())

# validation-list field -> transition-row column it feeds
FIELD_TO_ROW_COLUMN = {
    "delta": "in_delta",
    "lows": "lows",
    "level": "level",
    "i_like": "i_like",
}

DEFAULT_SETTINGS: dict = {
    "collection_nml_path": "",
    "super_playlist_folder": "",
    "exclude_prefixes": [],
    "display": {
        "line_spacing": 100,
        "font_size": 13,
        "key_display_as": "flats",
        "colorful_keys": True,
        # Issue #81: grid-only zoom for the Track-Playlist Matrix (S3), a
        # percentage 50–150 (step 10). Absent in a pre-#81 settings file →
        # deep-filled to 100 by get_settings (no migration needed).
        "matrix_zoom": 100,
        # Issue #140: app-wide show/hide for the S2 OUT TRACK TIMING group
        # (M # / T # / Play Time) and the Mix Timer column. Both default to
        # VISIBLE; absent in an older settings file → deep-filled to True by
        # get_settings, so no migration is needed.
        "show_timing_columns": True,
        "show_mix_timer_column": True,
        # Issue #145: give the T # / M # CUE columns their group's header color
        # (Out Track magenta / In Track cyan). Both default OFF.
        "loud_t_column": False,
        "loud_m_column": False,
    },
    "last_export_format": "xlsx",
}

KEY_DISPLAY_VALUES = ("flats", "sharps", "camelot", "openkey")
EXPORT_FORMATS = ("csv", "xlsx", "markdown")

ROW_FIELDS = (
    "bpm", "key", "in_name", "in_delta", "m_num", "t_num", "a_num",
    "lows", "level", "swap_lows", "i_like", "notes", "start", "transition",
)
