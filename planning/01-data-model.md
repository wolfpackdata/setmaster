# SetMaster 3 — Data Model

**Status:** Drafted 2026-07-06. Field-level ground truth for pipeline data is `docs/sources/03-prototype-code-reference.md` (code-derived); this doc defines SM3's entities, identity rules, and persistence requirements on top of it.
**Audience:** the Fable coding agent. Storage engine is the builder's choice (§8); the shapes, identities, and invariants below are requirements.

---

## 1. Two data domains — keep them separate

1. **Pipeline data (regenerated, disposable):** everything derived from `collection.nml` + Exportify CSVs by the Python pipeline. Rebuilt on every run; never hand-edited; safe to delete.
2. **User data (precious, never regenerated):** sets, transition rows, cell formatting, blank-cell notes, validation lists, comparison config, import metadata, settings. Must survive every pipeline run and be covered by the backup zip (`00-overview.md` §3).

The one deliberate bridge is the comparison-notes snapshot-merge (§6.3): user notes keyed against regenerated pipeline rows, with a fail-safe merge. Nothing else crosses the boundary.

## 2. Traktor collection ingest (pipeline stage 1)

Source: `collection.nml` (XML, **read-only — hard constraint**). Parsed fields per code reference §2.2:

- **Collection track:** identity + metadata from `ENTRY`/`LOCATION`/`ALBUM`/`INFO`/`TEMPO`/`LOUDNESS`/`MUSICAL_KEY`. Fields SM3 surfaces: title, artist, album_title, bpm, key (see §5), playcount, import_date, last_played, release_date, full_path, genre, comment.
- **Playlist membership:** one row per (playlist, track) from the recursive `PLAYLISTS/NODE` walk: `playlist_path`, `playlist_name`, `playlist_folder`, `track_key`.

### 2.1 Track identity

- **`track_key`** (raw NML `VOLUME+DIR+FILE` string) is the canonical collection-track identity — it is what playlist `PRIMARYKEY`s reference. Use it wherever a row must point at a collection track (matrix rows, per-playlist membership).
- `hash_id` (SHA1 of `audio_id`) exists only inside the join stage for dedup (code reference §2.5). It is not an app-level identity.
- **There is no shared ID between Spotify and Traktor.** Cross-platform matching is name-based and lossy by design (§7). Never invent a joint key.

### 2.2 Playlist identity (decided 2026-07-06 — diverges from SM2)

- Playlists are identified by **full `playlist_path`** (the `/`-joined folder path), not by name. Two same-named playlists in different folders are distinct everywhere: matrix columns, comparison config, S8 panels. (SM2 keyed by name and silently collided — do not port that.)
- **Display always uses `playlist_name`** (and, for Spotify-derived entries, the display-name rules of `exportify-import.md` §4).
- Spotify↔Traktor comparison matching remains **name-based** (normalized per §7.1) because Exportify files carry only a filename. Consequence: if two Traktor playlists share a normalized name, the comparison target is ambiguous — S8 flags this as a conflict (`exportify-import.md` §7) rather than picking one. Path-keying fixes identity, not the Spotify-side match.
- **Root/non-root is a first-class concept** (walkthrough §7.6): a playlist is *root* iff its `playlist_folder` equals the configured Super Playlist folder name (case-insensitive). Everything else is non-root. This drives the matrix `On Root PL` / `On Non-Root PL` counts and the signature workflows.
- **Canonical naming (issue #11):** *root playlist* and *super playlist* are the **same entity** — treat them as synonyms, not two concepts. "Super Playlist" is the user-facing term; the matrix count columns display as **On Super PL** / **On Non-Super PL** in the UI. Internal identifiers and the frozen pipeline contract keep the `root` terminology: API/CSV field keys (`root`, `nonroot`, `is_root`), the CSV export headers `On Root PL` / `On Non-Root PL`, routes, and screen IDs are **unchanged**.

## 3. Pipeline contracts (port behavior verbatim; restructuring allowed)

Stages and outputs per code reference §2 (schemas there are normative):

| Stage | Output | Consumed by |
|---|---|---|
| 1 load | tracks CSV + playlist-membership CSV | stages 2–4 |
| 2 playlists/matrix | per-playlist track CSVs + **track-playlist matrix** | S3 |
| 3 compare | playlist-level compare (`both` / `traktor_only` / `spotify_only`) | stage 4; surfaced on S8/S5 status |
| 4 join | per-playlist **joined CSVs** with 4-value `presence_flag` | S5 comparison pages |

Invariants: matrix excludes playlists matching the exclude-prefix list and tracks whose name starts with `--`; matrix is one row per unique (`track_key`, `track_name`); `presence_flag` is exactly the 4-value enum in code reference §2.5; joined rows sort by `track_collate`. Whether SM3 keeps literal CSVs between stages or an internal store is the builder's choice — the *shapes and semantics* are the contract. All text I/O is UTF-8; tolerate BOM on read, emit `utf-8-sig` where Excel compatibility matters (set-export §6.1).

## 4. SM3 user-data entities

### 4.1 Set

`id` (internal, stable), `name` (trimmed, non-empty, unique **among active sets**, ≤100 chars — ui spec §4; archived sets may collide, resolved at restore), optional folder (sidebar tree), created/modified timestamps, **`archived` flag + `archived_at`** (lifecycle `active → archived → restored | deleted`; archived sets keep all data forever until permanently deleted, are excluded from navigation/listing but included in backups — `02-features/set-archive.md`), row list (ordered), per-set remembered export filename (set-export §5), undo history (session-scoped, not persisted).

### 4.2 Transition row — store In-side only, derive Out-side

SM2's template proves the model (code reference §3.2): Out Track Name and Out Δ are formulas mirroring the previous row. SM3 stores per row:

| Field | Type | Notes |
|---|---|---|
| `bpm` | text/number | **manually typed, never auto-filled** (decided 2026-07-06 — set-row BPM/Key intentionally diverge from metadata) |
| `key` | text | manually typed, same rule; rendered per Key Display As when parseable as a key |
| `in_name` | text | plain text; typeahead is insertion-convenience only — **no FK to collection track** |
| `in_delta` | enum from Δ list | `---` default |
| `m_num`, `t_num`, `a_num` | enum `---`, `#1`–`#8` | cue numbers (M on In side; T/A on Out side) |
| `lows`, `level` | enum from editable lists | legacy values allowed (§4.4) |
| `swap_lows` | enum `---`, `#1`–`#8` | |
| `i_like` | single emoji grapheme | default `⚠️` on new rows |
| `notes` | text, multiline | FX & Mix Notes |
| `start`, `transition` | m:ss text | timing of M# / T# on the Out Track |

Derived (never stored): `out_name` = previous row's `in_name`, `out_delta` = previous row's `in_delta`, per-row minutes (`transition − start`), cumulative mix length, and the four set stats (# Tracks, Mix Length, BPM Avg., BPM Crest). First row has no Out side.

### 4.3 Cell formatting

Per-set overlay: RED/YELLOW fills on cell coordinates + Box borders on rectangular ranges (ui spec §6.5). Presentational only — persisted with the set, undoable, never queryable, exported only to XLSX. Must survive row reorders (attach to rows/cells logically, not by index).

### 4.4 Validation lists

Four global editable lists (Δ, Lows, Level, I like) + fixed cue lists. Factory defaults, constraints, and Add/Rename/Remove/Reset semantics: `advanced-settings-validation-lists.md`. Key invariant: **Rename propagates to all rows (same value, new label); Remove never touches existing cells** (legacy-value semantics). List order = dropdown order.

### 4.5 Comparison config (S8)

Set of **checked Traktor playlists**, each stored as `playlist_path` + display name. Only checked playlists are compared/joined. Behavior: `exportify-import.md` §5–6.

### 4.6 Exportify import metadata

Per imported playlist: slug, display name, original filename, import timestamp, source-file mtime, row count (`exportify-import.md` §3.5). Powers staleness indicators. Raw CSVs live at `raw-data/exportify/<slug>.csv`, newest-only.

### 4.7 Comparison notes — see §6.3

### 4.8 Settings

Traktor connection (collection.nml path — validate filename is exactly `collection.nml`; Super Playlist folder name), exclude-prefix list, the four global display options (Spacing, Font Size, Key Display As ×4, Colorful Keys), last-export format + per-format save locations (client-side only, set-export §4).

## 5. Key representation

- **Canonical: flats notation** — `C…B` + `m` suffix, 24 values (`Gbm`, not `F#m`/`11A`/`4m`). Normalize at ingest: prefer numeric `musical_key_value` (0–11 major, 12–23 minor — code reference §2.3); fall back to `format_traktor_key()`'s text map (stage 4) for free-text fields. **Pick one normalization point** — SM2 had two; SM3 normalizes once, at ingest.
- Display via the 4-notation table in ui spec §6.6 (flats / sharps / Camelot / Open Key — implement from the table, not a formula). Color from the `load`-tab palette (ui spec §3.1) when Colorful Keys is on.

## 6. Dates, counts, and the notes merge

### 6.1 Dates

NML dates arrive as text (`YYYY/M/D` style). Display: MM/DD/YYYY raw (incl. `1/1/YYYY` placeholders — matrix spec §11.12). Release-date *filtering* is year-granular; import date is full-date. Import metadata and export timestamps are ISO.

### 6.2 Play count

0 renders as explicit red `0` (never blank — decided, matrix spec §11.9); 0 and 1 render red.

### 6.3 Blank-cell comparison notes (the one pipeline/user-data bridge)

Notes exist only on blank track cells of comparison rows. Identity: (playlist, populated-side join key — `spotify_trackjoin` or `trak_trackjoin` — , column side). **Invariant (hard requirement): a note on a row whose gap persists survives every pipeline run of any kind.** Mechanism: snapshot before regeneration → re-key → merge after; if the merge fails, keep the snapshot (fail safe — never regenerate-and-drop). Notes on resolved gaps (`presence_flag` becomes `Yes-Trak-Playlist`, or row gone) are dropped and counted in the post-run summary. Full algorithm: `comparison-output-table.md` §5.

## 7. Matching & normalization (port verbatim — do not reinvent)

1. **Playlist-name normalization** (config/display matching): underscores→spaces, remove all spaces, casefold; punctuation significant (`exportify-import.md` §4).
2. **Cross-platform track matching** (`clean_track_name`): transliteration map → NFKD → ASCII → lowercase → punctuation handling → term removal (` remix`, `original mix`, `extended`, …) → truncate at ` feat` (code reference §2.5). These heuristics are years of accumulated fixes.
3. **Filename normalization** (stage 3 compare): drop extension, NFKD, strip non-alphanumerics, lowercase, remove "original mix".

## 8. Persistence & filter-state requirements

- Storage engine: builder's choice (a single SQLite file in the app-data dir is a natural fit; per-set JSON files also acceptable). Requirements: everything in §4 lives under the app-data dir, is atomic enough to survive a crash mid-write (especially the notes snapshot-merge), and is fully captured by the backup zip.
- Continuous persistence: no explicit save; "Saving…/All changes saved" indicator (ui spec §7.3).
- **S3 unified filter/sort state** must be one serializable object (drawer + column filters + sort; breadcrumb renders it; the deferred NL bar will emit into it). Shape is builder's choice; serializability and single-source-of-truth are the requirement (`track-playlist-matrix.md` §4, `natural-language-prompt.md`).
- SM2 workbook import: one-time reader of `.xlsm` set tabs per `sm2-set-import.md` — imports into §4.1/§4.2/§4.3 entities; never writes back to the workbook.
