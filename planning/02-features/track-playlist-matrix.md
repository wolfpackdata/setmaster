# Feature: Track-Playlist Matrix page (S3)

**Status:** Decided with Ry, 2026-07-06 (screenshot review + two Q&A rounds; decisions logged in §11). *Second pass same day resolved all §10 open items — none remain.* Supersedes `planning/03-ui-design.md` §5.3 where they conflict (columns, filter surface).
**Sources:** `docs/sources/screenshots/05-traktor-track-playlist-matrix.png` (populated prototype tab, supplied by Ry 2026-07-06); `docs/sources/01-prototype-walkthrough.md` §7.5–7.6 (usage workflows, Root/Non-Root semantics); `docs/sources/03-prototype-code-reference.md` §2.3 (matrix CSV contract), §3.1 (sheet layout: headers row 1, playlist columns from M, freeze at M2); `docs/design/traktor-fx-channel-1.png` (visual reference for the filter drawer); conversation with Ry 2026-07-06.

---

## 1. What it is

The whole-catalog working surface — one row per track across the playlist-tagged Traktor collection, one page in SM3 (screen S3). "Constantly open when working on a new DJ set" (walkthrough §7.5). Its entire purpose is compound filter/sort that Traktor can't do: BPM range **and** key **and** date ranges **and** playlist membership at once.

Read-only grid — nothing on this page writes data; it is a lens over the pipeline output.

## 2. Data source

`traktor_track_playlist_matrix.csv`, produced by pipeline stage 2 (`traktor_playlists_from_collection.py`) — schema, exclusion rules, key normalization, and root/non-root count computation in code reference §2.3. One row per unique (`track_key`, `track_name`); one column per non-excluded playlist, cell = track name if the track is on that playlist, else blank. Root/Non-Root counts are computed in the pipeline, not the UI (matrix is generated-then-rendered — technical walkthrough §2.4; preserve that seam).

**No Spotify data required (issue #5):** the matrix is built entirely from the Traktor collection. When the Exportify folder is empty or missing, the pipeline still runs stages 1–2 (collection load + matrix build) to completion and the matrix builds and displays exactly as normal; only the Spotify-comparison stages (compare + join) are skipped gracefully, surfaced as a non-alarming info/warning notice ("No Spotify data found — matrix built; comparison skipped"), never a red failure. Existing comparison notes are untouched by such a run. Running **Read Collection & Remake Tables** with no Spotify data present is a supported, successful path — not an error.

## 3. Table columns

From the screenshot (prototype columns B–L, then playlist columns M→right):

| # | Column | Notes |
|---|--------|-------|
| 1 | Import Date | Full date |
| 2 | Release Date | Mostly year-granular in the data; **display raw dates as M/D/YYYY** (no leading zeros — decision §11.12, issue #6), even where `1/1/YYYY` is a placeholder |
| 3 | Last Played | Full date |
| 4 | Play Count | **Play count 0 renders as an explicit red `0`** — the prototype leaves these blank, which Ry called confusing; do not carry the blank. **Values 0 and 1 render as red numbers** ("never/rarely played" — decisions §11.2, §11.9). Supports the "digging for underused tracks" workflow |
| 5 | BPM | |
| 6 | Key | Colored key badge per global Colorful Keys option (`03-ui-design.md` §3.5, §6.6) |
| 7 | Album Title | |
| 8 | Artist Name | |
| 9 | Track Name | Visually emphasized in the prototype (cyan fill); **SM3 carries an equivalent emphasis, styled consistently with the design doc's tokens** (decision §11.10) — not a literal cyan copy |
| 10 | On Super PL | Count, `--status-success` green |
| 11 | On Non-Super PL | Count, `--brand-magenta`; **cell highlighted when > 0** (prototype magenta fill) — "already used in a published set" flag |
| 12+ | One column per playlist | **All visible, faithful port (decision §11.1), in alphabetical order (decision §11.11).** Header = playlist name; cell non-blank ⇔ track is on that playlist. Horizontally scrollable; columns 1–11 stay frozen (prototype freezes at M2) |

**Display naming (issue #11):** columns 10/11 render on-screen as **On Super PL** / **On Non-Super PL**. The CSV export headers stay `On Root PL` / `On Non-Root PL` and the internal fields stay `root` / `nonroot` — a frozen pipeline contract (CLAUDE.md); only the visible labels changed.

The File Path column from the earlier §5.3 draft remains an optional show/hide column — it is not in the prototype screenshot. **Default-hidden set (issue #77):** the columns hidden on a fresh install are **Last Played, Album Title, and File Path**; every other column is shown. The user may show or hide any column freely, but this default set is fixed — there is no UI to redefine it, and **Reset Columns** restores exactly this set (plus default order and widths). The default set is versioned: a layout saved before #77 whose hidden set is exactly the old default (`File Path` only) is silently upgraded once to the new default; any other saved selection is the user's choice and is preserved verbatim. **The cover-art thumbnail column is cut from build #1 (Ry, 2026-07-06 final review):** `collection.nml` carries no artwork and the pipeline extracts none; embedded tag-art extraction is a possible later update. Column show/hide + reorder persisted, per §5.3.

### 3a. My Playlists selector — playlist-column show/hide (issue #13)

A **My Playlists** toolbar dropdown controls which playlist columns (§3 row 12+) are shown. It holds a search box, an alphabetical checkbox list of every loaded playlist (checked = column shown), and **Show all** / **Hide all** acting on the full set. The selection is the persisted **hidden set** (`sm3.matrix.hiddenPlaylists`, keyed by `playlist_path`); a playlist absent from the set is shown, so a playlist appearing in a later pipeline run defaults to shown. Visibility is **not** a filter — Clear All Filters (#10) never touches it — and the toolbar's "N of M playlists" count plus Export Matrix's playlist tail (§7a) honor it. The first search keystroke from the all-shown default clears the selection once (one-shot auto-clear) so the user builds a subset up from nothing.

**Show Playlists Containing These Tracks (issue #79):** a full-width action row at the very top of the dropdown (above the search box). One shot, not a mode: it reads the **current filtered (visible) track list** at click time and sets the selection to exactly the playlists containing **at least one** of those tracks — checking them and unchecking the rest — using the matrix's own track↔playlist membership (the cell data, no name matching). Broadening the track filter afterwards does **not** re-sync; the user clicks again. Zero visible tracks, or a visible set no playlist contains, hides **every** playlist ("show none" — not an error). With no filter active it selects every playlist that contains any track (quietly hiding empties). The result is an ordinary hand-editable selection: **Show all** is the undo, and it persists session-to-session like any manual pick. The dropdown stays open so the checkbox updates are visible (shown-first row order is pinned at menu open, re-sorting only on reopen — the existing #13 behavior).

## 4. Per-column filtering and sorting (requirement: every column)

Every column — including each playlist column — gets header-level sort (asc/desc) and filter:

- Text columns: contains / picklist of distinct values.
- Numeric/date columns: range.
- All columns: blank / non-blank — the prototype's "deselect blanks on a playlist column" gesture is how Ry isolates one playlist's tracks (walkthrough §7.5); must stay expressible.
- Multi-level sort (e.g. BPM then release date), per `03-ui-design.md` §5.3.

**Unified filter model:** the filter drawer (§5) and per-column header filters read and write **one shared filter + sort state**, summarized by the drawer's sentence preview (§6). No separate layers to reconcile. Keep this state a single serializable object — the deferred NL prompt bar (§9) will emit into it in a later update.

## 5. Filter drawer (the "FX channel" modal)

Rapid compound filtering — apply several common filters and one sort in a single pass. Visual language: a Traktor FX unit (`docs/design/traktor-fx-channel-1.png`) — each filter is one horizontal "slot" line with an **ON toggle at the far left**, like FX-slot enable buttons.

**Presentation (decided):** right-side drawer, table stays visible beside it. Each filter on its own line, easily legible, easily toggleable.

**Toggles:** all filter lines **off by default**. Toggling a line off retains its last-entered values but removes it from the active filter. Only toggled-on lines apply.

**Filter lines, top to bottom:**

| # | Filter | Control |
|---|--------|---------|
| 1 | One Playlist | Single-select searchable dropdown of all loaded playlists (= the matrix's playlist columns; prototype row 1, M→right). Filters to tracks on that playlist |
| 2 | BPM range | Min + max numeric fields, linked dual-handle range slider |
| 3 | Keys to show | **Camelot wheel graphic (decision §11.6)** — two-ring wheel (outer major / inner minor), each of the 24 segments a toggle, tinted with the key's table color. Plus **Show All Keys** and **Clear All** buttons |
| 4 | Release year | Min + max **year** fields (decision §11.4 — data is year-granular) |
| 5 | Import date | Min + max full-date fields |
| 6 | Artist Name contains | Text field |
| 7 | Track Name contains | Text field |
| 8 | On Super PL | Min count numeric field (decision §11.3) |
| 9 | On Non-Super PL | Min + max count fields — so `= 0` ("never used in a published set") is expressible (decision §11.3) |

Lines 1 + 8 + 9 together make the signature workflow one drawer pass: *playlist = Disco Cosmic, root ≥ 1, non-root = 0* (walkthrough §7.5).

**Keyboard:** Tab moves through the text-editable fields in line order (skipping toggles/wheel/slider handles); Shift+Tab reverses. Requirement stated explicitly by Ry.

**Apply model (decided):** drawer shows a live **preview match count** ("would match 417 tracks") as values change, but the table updates only on **Apply**. Buttons: Apply, Reset (all lines off + values cleared — the prototype's "Filter Reset" carried over), Close.

**Auto-Apply — live filtering (decided, issue #9; label renamed from "Skip Apply", issue #61):** an **Auto-Apply** checkbox in the drawer footer. When ON, drawer edits are committed **live** through the same Apply path (so #8 drawer↔column mirroring stays the single source of truth) and the **Apply button is disabled** with an "Auto-Apply enabled" tooltip (the `title` sits on a wrapper element because a disabled button swallows hover). Commit style: value inputs (BPM/year/date fields, text `contains`, slider drag) **debounce ~300ms** so keystroke/drag churn doesn't thrash the mirror; discrete gestures (ON toggles, Camelot keys, Show-all/Clear, playlist pick, and **quick-sort** picks) commit **immediately**. Quick sorts therefore apply instantly while Auto-Apply is on (issue #9); with it off, quick sort still applies with Apply. Toggling Auto-Apply on commits the current draft at once. The setting is **persisted** in localStorage (`sm3.matrix.skipApply`) like the column layout and sidebar prefs — a plain boolean, keeping the state serializable; the localStorage key and the internal `skipApply` code name deliberately keep the original #9 vocabulary (issue #61 renamed the display strings only). Reset and the breadcrumb ✕ act live as always.

**Quick sort (bottom of drawer):** single-choice segmented control, applied with Apply (or instantly when Auto-Apply is on, above). Options, default first: **BPM** (default) · Release Date Newest First · Import Date Newest First · Track Name · Key.

**Drawer ↔ column-header sync (decided, issue #8 / ruling R1):** the drawer and the per-column header filters are one shared state, so an applied drawer line and its column header filter stay coherent. On Apply, each drawer line that has a clean 1:1 column counterpart is **mirrored into that column's header filter** (so the column header lights its engaged state — #7 — and its popover shows the same values); reopening the drawer **back-fills** those lines from the current column filters, and re-applying **overwrites** them. To keep a single source of truth, a mirrored dimension lives in exactly one place — the column filter — and the filter engine applies it once (never AND-ed twice). The mirrored pairs are: **BPM, Keys, Release Year, Import Date, Artist Name, Track Name, On Super PL, On Non-Super PL**. Selecting **all 24 keys** = "show all keys" = no constraint = clears the key column filter. **Release Year ↔ Release Date (decided, issue #60):** the Release Date column header filter is **year-granular** — its min/max take a **year only** (no full-date entry) and it carries decade/recency **quick-filter buttons** (This Year, Last 2/10 Years, 2020s…1970s, Before 1970) — so it is a clean 1:1 with the drawer's Release Year line and is mirrored like the rest (the year bounds are stored on the column as ISO Jan-1 / Dec-31 dates, so the date-column engine is untouched; the column still **displays and sorts** full dates, and its header label stays **Release Date**). This **supersedes** the earlier carve-out that kept Release Year drawer-only. **One Playlist** remains deliberately **drawer-only** (no column mirror): it drives a membership predicate rather than a single playlist column, not a clean 1:1.

## 5a. Search box + structured keyword layer (issues #15, #24)

A free-text **search box** sits in the matrix toolbar (issue #15). Its raw string is stored once in `applied.search` — the **single source of truth** — and is never persisted (session-only). The plain behavior: one case-insensitive substring **OR-ed** across Artist / Album / Track display text (not three AND-ed column `contains`), AND-ed with every other active filter. Clear All Filters (#10) and the box ✕ reset it by emptying that one string; #14's export filename reads it as the `Search ~<text>` token.

**Structured keyword query layer (issue #24, ruling R7 / decision D-041 — self-contained).** The same raw string is parsed **at filter time** (`frontend/src/screens/matrix/searchQuery.ts`, `parseSearch()`) into recognized column clauses plus leftover free text. A **deterministic** mini-parser — explicitly **not** the deferred NL prompt bar (§9). Parsed clauses filter **invisibly** from the box: they are deliberately **not** mirrored into the drawer or column-header filters and do **not** light #7's engaged-header coloring (that mirrored-into-unified-state behavior is reserved for the future NL bar). Grammar:

- **Clauses anchor** on a recognized single-word column keyword (case-insensitive) immediately followed by an operator (`=`, `<`, `<=`, `>`, `>=`) or a phrase word (`from`, `past`). Everything not consumed is the #15 contains-OR search; all parts AND together. An unknown `word=value` or an incomplete/invalid clause (`BPM=`, `Key=`, `Foo=1`, `BPM=abc`) stays **literal** text so the grid never blanks mid-typing.
- **Operator form:** `=v` exact (numeric → min=max=v); `=X,Y` inclusive range; `<`/`<=`/`>`/`>=` bounds (strict `<`/`>` supported). For **Key**, `=A,B,C` is a **set**, not a range.
- **Phrase forms:** `COLUMN from X to Y` (inclusive range); `COLUMN past N day|week|month|year` (singular/plural, `N` optional → 1) on **date** columns — a trailing window from **today**, computed each parse and **never persisted**.
- **Column keywords:** BPM (`BPM`), Key (`Key`/`Keys`), Play Count (`Playcount`/`Plays`), Release Date (`Released`/`Release`), Import Date (`Imported`/`Import`), Last Played (`Played`), On Super PL (`Super`/`Root`), On Non-Super PL (`Nonsuper`/`Nonroot`). Artist/Album/Track and File Path have **no** keyword (Artist/Album/Track are the plain contains search).
- **Key notation:** any of the four notations (Camelot `8A`, Open Key, sharps `C#m`, canonical flats `Cm`), case-insensitive, normalized to canonical flats by **reusing** the existing key basis (`lib/keys.ts` `KEY_TABLE`) before hitting the keys predicate.
- **Date `=YYYY`** = the whole calendar year (`YYYY-01-01 … YYYY-12-31`); `from Y1 to Y2` spans whole years.
- **Same column twice → last clause wins.**

Clauses reuse the existing engine predicates (numeric min/max, key set, date min/max), so a parsed clause filters **identically** to the same constraint set as a manual drawer/column filter (verified by an equivalence test battery). Examples: `BPM from 120 to 125` ≡ `BPM=120,125`; `Keys=Cm,Gm,Dm`; `Released past 2 years`; `deadmau5 Key=Am,Em BPM=120,128` = contains "deadmau5" **and** key ∈ {Am,Em} **and** BPM in [120,128].

## 5b. Zoom — grid-only scale control (issue #81)

A **Zoom** stepper sits in the matrix toolbar, immediately **left of Spacing** (toolbar order **Zoom · Spacing · Font**), styled identically to Font. Range **50%–150%, step 10, default 100%**. It provides a browser-zoom-style scale scoped to the **grid region only**: everything inside `.mx-gridwrap` (frozen + playlist column headers, all cells, row heights, column widths, padding) scales together; the sidebar, page header, toolbar, search row, filter-breadcrumb row, filter drawer, and every popover/menu (header filter popover, Columns, My Playlists) render **outside** the grid container and stay at 100%.

Zoom is a **multiplier on the rendered result** of the other two controls — Font stays the text-size control, Spacing (§3.5, issue #78) stays the row-density control — and is **not** folded into the row-height formula (`settingsStore.ts`) or the stored column widths. Stored state (`sm3.matrix.columns` widths, font size, spacing) is never rewritten by zooming, so 80% → 100% round-trips pixel-exactly. Persisted as **`display.matrix_zoom`** in the backend settings model (§3.5); absent in a pre-#81 settings file → 100. Applies to **S3 only** — no Zoom control on S2 or in Settings → Display.

Implementation (ruling **R4**): CSS `zoom` on `.mx-gridwrap`. Because `zoom` participates in layout, the sticky header, both virtualizers (which use fixed `estimateSize` estimates), and the scroll extents stay internally consistent, while the flex outer box of `.mx-gridwrap` is unaffected so nothing outside the grid shifts. The one subtlety is **column resize under zoom**: pointer drag deltas arrive in screen pixels but stored widths are unzoomed pixels, so the delta (and anchor-rect math) is **divided by the zoom factor** — at 80% a 100px on-screen drag adds 125px of stored width, and the edge tracks the cursor 1:1. Popovers stay correctly anchored because they read `getBoundingClientRect` (physical page coords) of the zoomed cells and render at `position: fixed` outside the zoomed subtree.

## 6. Breadcrumb — sentence-form filter summary

As lines are toggled/edited, the drawer composes a plain-English sentence with the values highlighted, e.g.:

> Show tracks only from **Disco Cosmic** with BPM **122 through 126**, show me **all keys**, released **2025** through **Present**, where Artist Name contains **Kaskade**.

**Persistence (superseded by issue #12, post-build-1):** the above-table strip is **removed** — its at-a-glance job is done by the #7 column-header states and the #10 "Clear All Filters" toolbar button. The sentence lives on **inside the drawer** as the live preview (composed by the same `composeBreadcrumb`), still reflecting the full unified filter state.

## 7. Dropped prototype chrome

Excel workarounds, not requirements (confirmed by Ry 2026-07-06, resolving former open question #5): the "Formatting Reset" button, the autofilter toggle macro, the Tips block (Shift+Spacebar, Ctrl+F, Ctrl+Scroll zoom), and `ApplyTrakMatrixFormatting` itself — SM3 renders natively. "Filter Reset" survives as the drawer's Reset and the toolbar's Clear All Filters button (#10).

## 7a. Export Matrix — CSV of the current view (post-build-1, issue #14)

A one-click **Export Matrix** toolbar button downloads the **current filtered & sorted view** as a `.csv` — no modal, no options dialog. It is a read-only lens over the applied state: it serializes from the in-memory `applyFilterSort` output (never the DOM or the virtualized window, so **every** matching row is written, not just the on-screen ~window) and the persisted column layout. Fully client-side/offline (`frontend/src/screens/matrix/exportMatrix.ts`).

- **Rows:** the filtered result set in current multi-level sort order — all matches.
- **Columns:** exactly the visible view — the metadata columns in layout order with show/hide honored (File Path stays hidden by default), then the shown playlist columns alphabetically, honoring the My Playlists selector (#13). Header row = the grid **display** labels (post-#11 `On Super PL` / `On Non-Super PL`; playlist name for playlist columns).
- **Cell values:** taken from the grid's own `cellDisplay` so formatting matches one-for-one — Release/Import/Last-Played dates `M/D/YYYY`, whole-number BPM (#6), key per Key Display As, Play Count including an explicit `0`, and playlist cells = the track name where the track is on that playlist, blank otherwise.
- **Encoding/format:** UTF-8 with BOM (`utf-8-sig`, the repo's Excel-compat convention) and RFC 4180 quoting (fields containing a comma, double-quote, CR or LF are quoted; embedded quotes doubled; CRLF record terminators). Opens cleanly in Excel/Sheets with commas, quotes, and non-ASCII names intact. **The CSV column headers here are the on-screen display labels — this is the export of what the user sees, distinct from the pipeline's frozen `traktor_track_playlist_matrix.csv` contract (§2/§3), whose headers stay `On Root PL` / `On Non-Root PL`.**
- **Filename:** always `SetMaster Track-Playlist Matrix Export -- <suffix>.csv`. The suffix is a compact, filename-safe, deterministic list of the engaged-filter tokens joined with `, ` in this order: the **Search** token first (from #15's raw box), then the drawer lines in order (One Playlist `PL <name>`, BPM, Keys, Release Year `Rel`, Import Date `Imp … .. …`, Artist `~`, Track `~`, `Super`, `NonSuper`), then any remaining per-column header facets (metadata columns in spec order, then playlist columns alphabetically). Super/NonSuper wording per #11. When **no** filters are engaged the suffix is **`Full View`** (ruling R4); a sort alone does not count as a filter. Dynamic values are sanitized of filesystem-illegal characters and the total name is capped (~200 chars, truncated with a `…` marker rather than emitting an invalid name).
- **0 matching rows:** exports a header-only CSV and shows a toast ("0 tracks matched — exported header row only").
- **Non-goals:** not XLSX/PDF/styled export, not the compare export, not server-side generation; does not change any filter/sort/column state.

## 8. Performance

Virtualized both axes: tens of thousands of rows (walkthrough §7.5) × potentially 100+ playlist columns, with frozen metadata columns. Filter/sort must stay interactive at that scale; the preview count (§5) must be cheap enough to run live.

## 9. Relationship to the NL prompt bar — DEFERRED

The NL prompt bar is **not in build #1** (Ry, 2026-07-06 — future update, spec TBD; see `natural-language-prompt.md`). When it ships it will dock at the top of S3 (`03-ui-design.md` §6.7) and emit into the same unified filter/sort state — its results appearing in the breadcrumb sentence, editable via the drawer, and vice versa. Build #1's only obligation is the serializable unified state noted in §4.

## 10. Open items

None. All five items from the first pass were resolved by Ry the same day (2026-07-06, second pass) — see decisions §11.9–11.13. Corresponding entries in `planning/04-open-questions.md` (#14–18) are marked resolved.

## 11. Decision log (Ry, 2026-07-06)

1. **Playlist columns:** keep all visible, one column per playlist — faithful port. (Not hidden, not a chip summary.)
2. **Red play-count marks:** never/rarely-played marker; carry over.
3. **Root/Non-Root in drawer:** yes, both — On Super PL min, On Non-Super PL min/max.
4. **Release-date granularity:** year only (import date stays full-date).
5. **Drawer presentation:** right-side drawer, table visible.
6. **Key selector:** Camelot wheel graphic.
7. **Apply timing:** Apply button + live preview count (no live table updates).
8. **Breadcrumb:** persists above table, clickable to reopen drawer, with clear-all. *(Superseded post-build-1 by issue #12 — strip removed; sentence survives as the drawer preview, §6.)*

*Second pass, 2026-07-06:*

9. **Red play-count rule:** play count 0 renders as an explicit red `0` (prototype's blank is confusing — do not carry it); 0 and 1 are red numbers.
10. **Track Name emphasis:** carried over, visual treatment consistent with the design doc (`03-ui-design.md` tokens), not literal prototype cyan.
11. **Playlist column order:** alphabetical.
12. **Release Date display:** raw dates in M/D/YYYY format — no leading zeros on month or day (placeholders included; updated per issue #6, superseding the earlier MM/DD/YYYY); filtering stays year-granular per §11.4. **BPM displays as a whole number (no decimals, issue #6).** Center-align the three date columns, Play Count, BPM, and the two count columns (On Super PL / On Non-Super PL); default column widths fit the header label (playlist columns fit their name), except Album Title / Artist Name / Track Name which keep their tuned widths. **Two-line headers (issue #80):** the three widest label-driven columns — **Play Count**, **On Super Playlist**, **On Non-Super Playlist** — wrap their (verbatim, un-abbreviated) headers onto two lines, so their default width is driven by the longest wrapped *line* rather than the full label (Play → Count; On Super → Playlist; On Non-Super → Playlist); the header row is a uniform taller height and single-line headers center within it. A manual drag narrower than the two-line width ellipsizes; double-click restores the new header-derived default.
13. **Drawer coverage:** Last Played and Play Count stay out of the drawer for v1; Ry will test whether column filters suffice.
