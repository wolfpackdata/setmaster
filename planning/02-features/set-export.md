# Feature: Set Export (CSV / XLSX / Markdown)

**Status:** Spec v1 (2026-07-06).
**Provenance:** requested directly by Ry (2026-07-06), with product decisions confirmed same day (XLSX style, content scope, save-picker fallback). This feature does **not** exist in the SetMaster 2 prototype — there is no capture-material source for it; this document is the source of truth.
**UI context:** lives on the Set Editor screen (S2) — see `planning/03-ui-design.md` §5.2.

## 1. What it is

An **Export** action on the Set Editor that writes the current set to a file in one of three formats — **CSV**, **XLSX**, or **Markdown** — prompting the user for a save location and remembering the last-used location for future exports.

## 2. UX

### 2.1 Entry point

**Export…** item in the S2 toolbar's **three-dot (⋯) overflow menu** (revised 2026-07-06 — replaces the earlier standalone toolbar button; the menu also holds Archive Set, see `set-archive.md`). Keyboard shortcut: `Ctrl/Cmd+E` (unchanged).

### 2.2 Flow

1. Click Export → small dialog (not a full modal takeover) with:
   - Format selector: three options — `CSV`, `XLSX`, `Markdown` — rendered as NI-style toggle chips (§6.2). Defaults to the **last format the user exported** (any set); first-ever default is XLSX.
   - Filename preview (editable text field), pre-filled per §5.
   - Export button (confirms) / Esc cancels.
2. On confirm, the save prompt behavior depends on browser capability (§4).
3. On success: toast "Exported <filename>" with a "Reveal" affordance where the File System Access API makes that possible; on failure (permission revoked, disk error): inline error in the dialog, never a silent failure.

Export is read-only over set data: it never mutates the set, never blocks editing (generate asynchronously), and works on an unsaved-but-persisted set exactly as displayed.

## 3. Exported content (all formats)

**Scope decision (Ry, 2026-07-06): full grid + metadata.**

### 3.1 Metadata header

Every export begins with a metadata block:

| Field | Value |
|---|---|
| Set name | as in the sidebar/editor title |
| Exported | ISO date-time of export |
| Tracks | number of transition rows |
| Total mix length | the Stats computation (`03-ui-design.md` §5.2), blank if timing columns are unpopulated |

- CSV: four comment-style rows at the top (`# Set: …`), then a blank row, then the header row. (Consumers that dislike `#` rows can skip 5 rows deterministically.)
- XLSX: rows 1–4 as label/value pairs, row 5 blank, header row at row 6.
- Markdown: an H1 (set name) followed by a bullet-less line block (`**Exported:** … · **Tracks:** … · **Total mix length:** …`), then the table.

### 3.2 Columns

All S2 grid columns, in grid order (`03-ui-design.md` §5.2): `BPM, Key, Out Track Name, Out Δ, T #, A #, In Track Name, In Δ, M #, Lows, Level, Swap Lows, I like, FX & Mix Notes, Out M #, Out T #`.

**Timing headers — decided 2026-07-29 (issue #104, resolving D-049).** The last two columns were `Start` / `Transition` and now carry the #72 grid vocabulary, **prefixed with their group**: `Out M #` / `Out T #`. Bare `M #` / `T #` — the grid's own labels — would duplicate the cue headers earlier in the same row, and a flat file has no OUT TRACK TIMING super-header to disambiguate them (that is precisely why #72 left the export alone). Folding the super-header into the label is the closest a headerless format gets to the screen. The cue columns keep `T #` / `A #` / `M #` verbatim. The derived `Play Time` / `Mix Timer` grid columns are **not exported at all**, so #72's renames do not reach them.

- **Key** exports in the notation currently displayed per the global **Key Display As** option (flats / sharps / Camelot / Open Key — `03-ui-design.md` §3.5), as plain text; key colors are never exported.
- **I like** exports the raw emoji character (all three formats are UTF-8; see §6).
- **Cell formatting** (red/yellow shading + boxes, `03-ui-design.md` §6.5 — replaced the vetoed typed-flag column, 2026-07-06): **XLSX** exports carry it as native cell fills/borders; **CSV and Markdown** drop it (no faithful representation exists — it's presentational, not data).
- Empty values export as empty strings, except enum placeholders (`---` in Swap Lows) which export literally as `---` to match the on-screen reading.
- `[UNSYNC]`-style name tags stay inline in the track-name text, exactly as typed.

## 4. Save location — prompt + memory

**Decision (Ry, 2026-07-06): graceful fallback.**

- **Chromium (File System Access API available):** use `showSaveFilePicker` with `startIn` set to the remembered directory handle. On success, persist the parent directory handle in IndexedDB. Remember **one location per format** (CSV/XLSX/MD may have different destinations), falling back to the last-used location of any format, then to the browser default. Re-request permission on the stored handle when needed; if permission is denied or the handle is stale, degrade to the picker's default location (do not error).
- **Firefox / Safari (no FS Access API):** standard anchor-download to the browser's Downloads folder. No location prompt is possible; the filename (§5) is still applied and the last-used **format** is still remembered. The dialog omits any location UI in this case rather than showing a disabled control.
- Location memory is a client-side convenience only — never store filesystem paths/handles server-side.

## 5. Filename convention

`<set-name-slugified>_<YYYY-MM-DD>.<ext>` — e.g. `kimma-bryan_2026-07-06.xlsx`. Slugify: lowercase, spaces→`-`, strip characters illegal on Windows/macOS filesystems. The user can edit the name in the dialog; an edited name is remembered per set for subsequent exports of that set.

## 6. Format specifics

### 6.1 CSV

- UTF-8 **with BOM** (required so Excel opens emoji and `Gbm`-style text correctly on double-click).
- RFC 4180 quoting: quote fields containing commas, quotes, or newlines (FX & Mix Notes routinely contains commas). Newlines within notes are preserved inside quotes.
- No styling semantics — cell formatting (red/yellow/boxes) is dropped in CSV per §3.2; there is no flags column (the typed-flag design was vetoed 2026-07-06).

### 6.2 XLSX

**Decision (Ry, 2026-07-06): clean data table — no app theming.** Plain, maximally reusable sheet:

- One worksheet, named after the set (truncated to Excel's 31-char sheet-name limit).
- Bold header row, frozen at the top (freeze panes below row 6, per §3.1 layout); autofilter on the header row.
- Sensible column widths (track names and notes wide, cue/enum columns narrow); numeric columns as numbers, `Out M #`/`Out T #` as text in `m:ss` (not Excel time — avoids 12:00 AM misinterpretation).
- No fills, no fonts beyond the bold header, no dark theme, no magenta/cyan. (Explicitly rejected: styled-like-the-app export.)

### 6.3 Markdown

- GitHub-flavored Markdown: metadata block per §3.1, then a single GFM table with the §3.2 columns.
- Pipe characters in cell text are escaped (`\|`); in-cell newlines become `<br>`.
- Intended for pasting into notes/docs/chat — no HTML beyond `<br>`.

## 7. Out of scope (v1)

- Export of the Track-Playlist Matrix or Compare results (separate feature if wanted — this spec is Set Editor only).
- Import/round-trip (exports are one-way snapshots; SetMaster 3's persistence is its own store).
- PDF export.
- Auto-export / export-on-save.

## 8. Acceptance criteria

1. From S2, a user can export the open set as CSV, XLSX, and Markdown; every grid column and the metadata block appear in each.
2. In Chromium, the save dialog opens in the last directory used for that format; the choice survives a browser restart. In Firefox/Safari, export completes as a normal download with the correct filename.
3. A set containing emoji flags, `[UNSYNC]` tags, commas/newlines in notes, and `---` placeholders round-trips into all three formats without mangling (emoji intact in Excel via BOM; pipes escaped in Markdown).
4. Exporting never modifies set data and never blocks the editor.
