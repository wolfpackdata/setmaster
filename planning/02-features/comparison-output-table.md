# Feature: Traktor-Spotify Playlist Comparison Output Table

**Status:** Decided with Ry, 2026-07-06. Not present in the SM2 prototype workbook or the walkthroughs — in SM2 this formatting is done by hand in Excel; SM3 makes it a first-class screen. *(Second pass same day added blank-cell notes and filtering, §5 and §8.)*
**Sources:** `docs/sources/examples/joined_discocosmic.csv` (real pipeline output, 646 rows); `docs/sources/examples/Comparison Output Table Example Disco Cosmic.xlsx` (Ry's hand-built formatting example); `docs/sources/03-prototype-code-reference.md` §2.5 (joined CSV schema + `presence_flag` enum); `planning/02-features/exportify-import.md` §6 (comparison config / S8); conversation with Ry 2026-07-06.

---

## 1. What it is

A per-playlist page that renders the join-stage pipeline output as a sortable, filterable, color-coded table. **One page exists for each playlist checked in the Comparison Settings page (S8)** — the same set of playlists the pipeline compares.

In SM2, Ry manually copies `Joined/joined_<playlist>.csv` into Excel and applies conditional formatting by hand (the XLSX example is exactly this). SM3 renders it automatically after every pipeline run.

**Purpose:** scan a Spotify playlist for gaps — tracks that exist in the Spotify playlist but are missing from the corresponding Traktor playlist (or from the Traktor collection entirely, i.e. the "go buy" list) — and annotate those gaps with working notes.

## 2. Data source

Input is the per-playlist joined CSV produced by **stage 4 of the pipeline, `traktor_spotify_playlist_join.py`** (`Joined/joined_<playlist>.csv`). Full 18-column schema and join logic: code reference §2.5.

> Note: Ry referred to this as the output of `traktor_spotify_playlist_compare.py`; per the code reference, the compare stage (stage 3) outputs `traktor_spotify_playlist_compare.csv` (playlist-level status), while the per-track joined CSVs come from the join stage (stage 4). `joined_discocosmic.csv` is a stage-4 output. The SM3 backend may restructure these stages; the requirement is the joined per-track dataset, whatever produces it.

## 3. Columns (default five + an opt-in "Columns" menu — issue #20)

The XLSX example shows all 18 CSV columns; Ry explicitly does **not** want them all shown at once. The **default view is exactly these five** — the same five that shipped in build #1:

| # | Column | Source field | Notes |
|---|--------|--------------|-------|
| 1 | Flag | `presence_flag` | Color-coded (§4); sortable; filterable (§8). **Non-hideable.** |
| 2 | Traktor® track | `traktor_title` | Blank when the track isn't in the Traktor playlist; blank cells are gold-highlighted and note-editable (§5). **Non-hideable.** |
| 3 | Spotify® track | `spotify_track_name` | Blank when the track isn't in the Spotify playlist; blank cells unshaded but note-editable (§5). **Non-hideable.** |
| 4 | Local file | `trak_collection_file_paths` | Rendered as a link/action, not a raw path (§6). Hideable, on by default. |
| 5 | Spotify® link | `spotify_uri` | Rendered as a link, not a raw URI (§6). Hideable, on by default. |

Empty-cell semantics in the sample data are clean and should be relied on: `trak_collection_file_paths` is empty exactly for `Not-Trak-Collection` rows; `spotify_uri` is empty exactly for `Not-Spotify / Yes-Trak-Playlist` rows.

**Opt-in columns (issue #20, decided by Ry 2026-07-07 — supersedes the earlier "no column-picker" hard-limit).** A **"Columns"** button to the right of the "Hide matched" control opens a checkbox popover for four additional columns, all **off by default**, carrying the artist and album from each source (already present in the joined CSV, no pipeline change):

| Column | Source field | Default |
|--------|--------------|---------|
| Traktor® Artist | `traktor_artists` | off |
| Traktor® Album | `traktor_release_name` | off |
| Spotify® Artist | `spotify_artists` | off |
| Spotify® Album | `spotify_album_name` | off |

Rules:

- The **track columns (Traktor®/Spotify® Track) and Flag can never be hidden**; Local File and Spotify® Link may be. The menu shows the non-hideable columns disabled + checked.
- When shown, columns render in a **fixed order** with each artist/album adjacent to its source's track column: **Flag · Traktor® Track · Traktor® Artist · Traktor® Album · Spotify® Track · Spotify® Artist · Spotify® Album · Local File · Spotify® Link.**
- Column labels carry ® per `03-ui-design.md` §1.3.
- **Visibility is shared across every compare playlist** (not per-playlist) and persisted in one per-screen `localStorage` key (`sm3.compare.columns.v1`) — ruling R5. It survives tab switches and page reloads. It is view state only; it never modifies stored data and is not part of the per-playlist filter/sort state that resets on tab switch (#22).
- **Width strategy** (`table-layout: fixed`): the narrow non-text columns take fixed pixel widths (Flag 110, Local File 130, Spotify® Link 110); the text columns (track/artist/album) share the remaining table width equally, so each narrows as more are shown. The table carries a computed `min-width` (Σ fixed + 200px per visible text column) so a wide visible set scrolls horizontally inside the table wrapper instead of crushing the text; cells ellipsis-truncate with the full value in a hover tooltip.

The backend results endpoint (`GET /api/comparison/results/{slug}`) passes the four fields through in every row (additive — nothing removed or renamed). Richer per-track metadata (BPM, key, playcounts) still lives in the matrix view (S3), not here.

## 4. Flag color-coding

`presence_flag` has exactly four values (enum + semantics in code reference §2.5; counts from the Disco Cosmic sample for scale):

| Flag | Meaning | Semantic color intent | Sample count |
|---|---|---|---|
| `Yes-Trak-Playlist` | In both playlists — match, not actionable | Neutral / subdued (gray in SM2) | 373 |
| `Not-Trak-Playlist / Yes-Trak-Collection` | In Spotify + owned in Traktor collection, but not in this Traktor playlist — "go organize it" | Warning (orange in SM2) | 32 |
| `Not-Trak-Collection` | In Spotify only — not owned; the actionable "go buy" bucket | Highlight / attention | 105 |
| `Not-Spotify / Yes-Trak-Playlist` | In Traktor playlist only — informational, "don't care" | Distinct but low-urgency | 136 |

Requirements:

- Each flag value gets a **distinct color chip/badge** on the flag cell (the XLSX example does this with Excel conditional formatting on column A; SM3 renders it natively). Exact palette is a design-spec decision (`planning/03-ui-design.md`, NI dark-UI direction) — the *semantic intent* above is the requirement.
- The two **gap flags** (`Not-Trak-Collection`, `Not-Trak-Playlist / Yes-Trak-Collection`) are the reason this page exists — they must be the most visually prominent. "Highlighting gaps where the track is found in the Spotify playlist but not in the Traktor playlist" is the core requirement (Ry, 2026-07-06).
- **Friendly labels decided (Ry 2026-07-06):** the flag chips use the S5 labels from the design spec (§5.5) — `Yes-Trak-Playlist` → **Match**, `Not-Trak-Collection` → **Go get**, `Not-Trak-Playlist / Yes-Trak-Collection` → **Organize**, `Not-Spotify / Yes-Trak-Playlist` → **Traktor only**. The underlying enum values remain filterable/sortable as four distinct states.

## 5. Blank-cell notes (decided, Ry 2026-07-06)

The blank track-name cells are not dead space — they are **editable note fields**. Cell shading encodes state:

| Cell | State | Shading |
|---|---|---|
| Traktor track, blank | No note yet | **Soft gold** — draws the eye to the gap |
| Traktor track, blank + user note | Note entered | **No fill** — inherits the row/stripe background; the note text is **orange** (`--accent-orange`) italic |
| Spotify track, blank | No note yet | **Clear** (unshaded) |
| Spotify track, blank + user note | Note entered | **No fill** — same orange note text as above |

Behavior:

- Clicking a blank track cell puts it into edit mode; typed text is the note. Non-blank cells (real track names) are **not** editable — notes exist only where the join produced no value.
- The gold/clear asymmetry is deliberate: a blank Traktor cell is a gap the user works on (buy it, organize it), so it's highlighted; a blank Spotify cell is usually "don't care" (`Not-Spotify / Yes-Trak-Playlist`), so it stays quiet until the user chooses to annotate it.
- Entering a note **removes** the gold (Traktor side) / clear (Spotify side) treatment — the cell drops any special fill and inherits its row's normal/striped background (the same gray as the rest of the line). What signals "this cell carries a user note" is the **orange italic note text** (`--accent-orange`, the same orange as the orange buttons), not a fill (decided, Ry 2026-07 — #23). It is also a filter target (§8).
- Deleting the note restores the gold (Traktor side) / clear (Spotify side) look.
- Orange note text clears WCAG AA on both dark row-stripe shades (`#1a1a1a` → 6.1:1, `#151515` → 6.4:1).

**Persistence & carry-forward across re-runs (decided, Ry 2026-07-06 — resolves former open question on note orphaning):**

Notes are user data and cannot live in the joined CSV, which is regenerated on every run. **Hard requirement (Ry, 2026-07-06): a user's note on a non-matched row must never be lost** — for as long as the row's gap persists (`flag ≠ "Yes-Trak-Playlist"`), the note survives every pipeline run, of any kind, without exception. The snapshot-merge below is the mechanism; if the merge fails mid-run, the implementation must fail safe (keep the snapshot, never regenerate-and-drop). This carry-forward runs on **every pipeline run that regenerates the joined CSV** — new Exportify imports and collection re-reads alike (confirmed by Ry):

1. **Snapshot:** before the pipeline regenerates the joined CSV, temporarily store the existing comparison table together with its notes.
2. **Key each note to its track (confirmed by Ry).** Since notes only exist in *blank* cells, the row's stable identity is the populated side's join key: note in Traktor column → key on the row's `spotify_trackjoin`; note in Spotify column → key on the row's `trak_trackjoin`; record the column so the note reappears in the right cell.
3. **Run** the pipeline with the new data.
4. **Compare & repopulate:** match snapshot rows against the updated table by note key. Repopulate each note **wherever the gap still exists** — i.e. the matched row's updated `presence_flag ≠ "Yes-Trak-Playlist"`.
5. **Resolved gaps drop their notes:** if the matched row is now `Yes-Trak-Playlist` (or the track is gone entirely), the note is not carried forward and the temporary snapshot is discarded after the merge. **Confirmed (Ry 2026-07-06):** count these in the post-run summary, e.g. "2 notes dropped (gaps resolved)."

### 5.1 Markdown links inside a note (decided, Ry 2026-07-28 — issue #142)

A note can carry hyperlinks, entered with the markdown gesture: **select text in
the note, paste a URL, and the selected text becomes the link**. Pasting with no
selection inserts the raw URL.

- **Storage: plain markdown inside the note string** — `[text](url)`. No rich
  text, no new fields. This is load-bearing: notes ride the fail-safe
  snapshot-merge above (and §1/§6.3 of the data model), which stays
  string-based, so a link cannot introduce a new way to lose a note on a run.
- **Scope: comparison notes only.** No other note field gets link support.
- **Only the link syntax is interpreted.** Bold, headings and lists render as
  literal characters — this is not a markdown editor. Malformed markdown, and a
  URL whose scheme SM3 will not open, render as literal text rather than being
  swallowed.
- **Links open externally.** SM3 stays fully offline and local; a note link
  opens in the user's browser as an ordinary external link and the app itself
  makes no network request.
- **Export rule (forward-looking).** Compare export does not exist yet. When it
  ships, a `[title](url)` in a note is exported as the **bare URL**, the title
  dropped (Ry, 2026-07-28).

## 6. Links

- **Local file** (`trak_collection_file_paths`): a browser page cannot reliably open `file://` links, and the SM3 backend is local with real filesystem access (exportify-import.md §2). **Decided (Ry 2026-07-06):** the action asks the backend to **reveal the file in the OS file manager** (Explorer/Finder with the file selected) — no open-in-player action. The column name is plural but the 646-row sample contains only single paths; the build should verify whether the pipeline can emit multiple paths per row and, if so, render one action per path.
- **Spotify link** (`spotify_uri`): stored as `spotify:track:<id>`. Render as `https://open.spotify.com/track/<id>` opening in a new tab (works whether or not the desktop Spotify app is installed; the web page hands off to the app if present).

## 7. Sorting & default order

- **Sortable by the flag column and every other column** (Ry, 2026-07-06). Flag sorting groups by flag value, ordered **alphabetically by display label** (Go get · Match · Organize · Traktor only) — decided by Ry 2026-07-06, actionability-first ordering rejected.
- **Default sort:** the pipeline emits rows sorted by `track_collate` (alphabetical by track, Spotify name preferred), which interleaves the two sides of the same track on adjacent rows (see rows 2–3 of the XLSX example: the same track flagged from both sides sits together). Keep this as the default — it is what makes near-miss joins visible.
- Sorting is client-side table state; it does not modify stored data.

## 8. Filtering (decided, Ry 2026-07-06)

Three filter mechanisms, combinable:

1. **Flag filter:** multi-select over the four `presence_flag` values — show only rows whose flag is selected.
2. **Noted-cells filter:** show only rows with a user-noted blank cell (§5). Lets the user pull up their working annotations in one view.
3. **"Hide matched tracks" button:** one-click toggle that hides all rows with `presence_flag = "Yes-Trak-Playlist"`. This is the dominant use case (373 of 646 sample rows are matches) so it gets a dedicated button rather than requiring the flag multi-select.

Filters combine with AND semantics, are client-side view state, and never modify stored data. Active filters must be visible (e.g. the button in a pressed state, filter chips shown) so the user always knows the table is showing a subset — with a visible row count like "141 of 646 tracks".

## 9. Behavior & edge cases

- **Page inventory follows the config:** playlists checked in S8 each get a page (nav entry / tab — placement is a design decision). Unchecking removes the page; checking adds it (populated after the next pipeline run).
- **Checked but not yet run** (no `joined_<playlist>.csv` yet): show an empty state pointing at the pipeline run action, consistent with the Playlist Compare Tool empty state (S5) in exportify-import.md §3.
- **Stale data:** the page should surface when its underlying joined data predates the latest Exportify import (reuse the staleness metadata from exportify-import.md §3.5).
- **Encoding/BOM:** the sample CSV is UTF-8 with BOM (`﻿` before `presence_flag`) — the parser must tolerate it.
- **Row counts:** a summary line above the table is **confirmed (Ry 2026-07-06)** with the exact format **"N tracks · M not matched to Traktor"** (e.g. "646 tracks · 105 not matched to Traktor"), where M = the `Not-Trak-Collection` row count. The filtered-count display in §8 is required in addition.

## 10. Open questions

None — all six former items were resolved by Ry in the 2026-07-06 final Q&A: five-column default view (§3), friendly flag labels (§4), reveal-in-file-manager (§6), summary count line with exact wording (§9), alphabetical flag sort (§7), and the "notes dropped" summary confirmed (§5). History in `planning/04-open-questions.md`. *(2026-07-07, issue #20: the former "no column-picker" hard-limit was relaxed to an opt-in "Columns" menu for the four artist/album columns — see §3; the five-column set remains the default view.)*
