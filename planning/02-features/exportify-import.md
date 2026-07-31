# Feature: Exportify Import & Spotify-Traktor Comparison Settings

**Status:** Decided with Ry, 2026-07-06.
**Sources:** `docs/sources/01-prototype-walkthrough.md` §7.2–7.4; `docs/sources/02-technical-walkthrough.md` (pipeline stages 3–4); `docs/sources/03-prototype-code-reference.md` §1, §2.3–2.5 (config file, Exportify schema); design conversation with Ry 2026-07-06 (this doc's primary source for all SM3-specific decisions).

---

## 1. Context — what SM2 does today

The user exports each Spotify playlist as a CSV from exportify.net (manual, in a browser), then **manually moves** the downloaded CSVs from their Downloads folder into the repo's `Exportify/` folder. The comparison pipeline only processes playlists listed in `config__traktor_playlists_to_sync.csv` (header `playlist_name_in_both_spotify_and_traktor`, one exact Traktor playlist name per row), which the user edits by hand.

SM3 keeps the manual exportify.net download step for v1 (see §8 for the future automation note) but eliminates all manual file-moving and hand-editing of the config.

## 2. Architecture constraint (decided)

SetMaster 3 runs **fully offline**: a local backend process on the user's machine with a browser UI (localhost). All playlist data is stored on local disk. The backend therefore has real filesystem access — it can read the OS Downloads folder and write into the app's data directory. *(This decision belongs in `planning/00-overview.md` when drafted; recorded here first.)*

Imported Exportify CSVs are stored in the app's raw-data location, `raw-data/exportify/` (SM3's successor to SM2's `Exportify/` folder). The user never moves files by hand.

## 3. Import flow

**Entry points:** an "Import Spotify Data" action on Home (S1), the Playlist Compare Tool empty state (S5), and the Comparison Settings page (S8, §6).

1. **Pick files.** **Default entry (decided 2026-07-06): the backend scans the OS Downloads folder and pre-lists Exportify-shaped CSV candidates** (header check per step 2), newest first with filename + download age, so the user just ticks boxes — one click to import. A plain file browser (also defaulting to Downloads) remains available as fallback for files elsewhere. Multi-select in both paths (a typical refresh is ~2 dozen playlists). Because the backend is local, both the scan and the browse UI are backend-served, so this works on every OS/browser.
2. **Validate each file.** A file is accepted as an Exportify CSV if its header row contains at minimum: `Track URI`, `Track Name`, `Artist Name(s)`, `Album Name`, `Added At` — **confirmed by Ry 2026-07-06**. (Full expected schema in code reference §2.4; only this minimal set is required so future Exportify column changes don't break import.) Invalid files are **skipped with a per-file warning; the batch continues**. Skipped files are left untouched in Downloads.
3. **Derive the playlist slug.** Strip the extension and any browser duplicate suffix ` (n)` (e.g. `disco_cosmic (2).csv` → `disco_cosmic`). If multiple selected files resolve to the same slug, keep only the **newest by file modified time**.
4. **Store.** Copy to `raw-data/exportify/<slug>.csv`. Re-import of an existing playlist **overwrites, keep latest only** (no archive, no prompt).
5. **Record import metadata** per playlist (backend store, e.g. `exportify_imports.json` or equivalent table): slug, display name (§4), original filename, import timestamp, source-file modified time, row count. This powers staleness indicators (§6).
6. **Post-import config handling** (§5), then a single batch **summary message** and a **"Run comparison now?" prompt** — the pipeline (SM2's `run_all_scripts.py` equivalent) is *prompt-to-run*, never auto-run and never silently skipped.

> **Removed feature — do not implement:** an earlier draft had the app offering to move the source files from Downloads to the OS trash after import. Ry cut this on 2026-07-06 (friction, marginal value). Downloaded files are always left in place.

## 4. Name matching & display names

**Normalization (canonical rule, used everywhere names are compared):** replace underscores with spaces, then remove *all* spaces, then compare case-insensitively. Equivalent: `normalize(s) = lowercase(remove(replace(s, "_", " "), " "))`. So `disco_cosmic` ≡ `Disco Cosmic` ≡ `DISCOCOSMIC`. Punctuation is significant.

**Display names:** playlist names shown to the user — in the config page, messages, and anywhere else — must **always look like they do in Spotify**, never like the slugified filename. The Exportify CSV contains no playlist-name column, so:

- If a normalized match exists in the Traktor collection, use the **Traktor playlist's exact name** as the display name (the config's premise is same-name-in-both, so this is the Spotify name too).
- Otherwise, derive from the filename: underscores → spaces, title-case each word (`disco_cosmic` → "Disco Cosmic"). Exact Spotify casing/punctuation can't be recovered from the file; the future exportify.net integration (§8) fixes this properly.
- Wherever a display name is derived (not Traktor-confirmed), show the **actual filename alongside for reference** — e.g. *Disco Cosmic* `(disco_cosmic.csv)`.

The config stores the human-readable display name; all matching against it goes through the normalization rule, so stored casing never breaks comparisons.

## 5. Post-import config behavior (auto-add)

For each successfully imported playlist, match its name (normalized) against the playlist names in the current Traktor collection data:

- **Traktor match found** → **automatically add** the playlist to the comparison config (i.e. check it in S8) and tell the user: *"Added 'Disco Cosmic' to the comparison."* with a **"Change Which Playlists Compare"** action that opens S8, where it (or others) can be unchecked. No yes/no question — auto-add replaces the earlier ask-first design.
- **No Traktor match** → tell the user no Traktor playlist with this name exists. The playlist is stored and appears in S8's Spotify panel **shaded red with a red stop-sign icon** (§6); it is *not* added to the comparison (there is nothing to compare against). Remedy shown to the user: create the playlist in Traktor, save the collection file, then use **Re-read Collection File** (§6).
- **Already in the config** → no message per file; counted in the batch summary.

Batch summary example: *"Imported 12 playlists · 9 added to comparison · 2 already configured · 1 not found in Traktor."*

## 6. S8 — "Spotify-Traktor Comparison Settings" page (new screen)

This page **is** the config: it replaces hand-editing `config__traktor_playlists_to_sync.csv` and supersedes the "Comparison config" chip lists previously sketched for S6 in `planning/03-ui-design.md` §5.6.

**Layout — two panels:**

- **Traktor panel (left):** every playlist in the current Traktor collection. Each row has a **checkbox — the only editable control on the page**; checked = included in the comparison. Checked state is the persisted config. **Default: nothing checked.** (Imports auto-check per §5.) Rows that are checked but have **no loaded Exportify data** (or stale data) show a coverage indicator, e.g. *"no Spotify data"* / *"data 43 days old"* from the §3.5 import metadata.
- **Spotify panel (right):** every playlist with loaded Exportify data — display name, source filename, import date. No checkboxes. Playlists with **no normalized Traktor match** are shaded red with a red stop-sign icon and helper text: add the playlist in Traktor, save the collection, then re-read.

**Re-read Collection File button:** runs the pipeline (SM2's `run_all_scripts.py` equivalent) and refreshes the page, so newly created Traktor playlists appear in the left panel. Uses the standard pipeline-run feedback (design spec §7.2).

**Open Exportify button:** opens `https://exportify.net` in a **new browser tab** (the UI already runs in the user's default browser, so a standard new-tab link is sufficient; if a desktop shell is ever used instead, this must launch the OS default browser, not an embedded view). Purpose: puts the manual download step one click away from the page where its output is configured.

**Persistence:** whether the backend keeps the literal CSV format for pipeline compatibility or migrates config to its own store is an implementation choice for the build phase; the pipeline's *behavior* (only checked playlists are compared, matching per §4) is the requirement.

## 7. Error & edge cases

- Import attempted before any Traktor collection has been read → allow the import (store files + metadata), but every playlist lands in the no-match state with a pointer to read the collection first.
- Zero valid files in a selection → single error message, nothing stored, no config change.
- Traktor playlist renamed/deleted after being checked → it disappears from the left panel; its config entry is dropped, and any orphaned Exportify data shows red in the Spotify panel like any other no-match.
- Two Traktor playlists that normalize identically (e.g. "Disco Cosmic" and "DISCOCOSMIC") → flag as a conflict in S8 rather than silently picking one.

## 8. Future release (out of scope for v1)

Connect to exportify.net (API or browser automation): user logs into Spotify with their credentials, picks playlists from an in-app interface, and the app downloads the CSVs itself — no manual download, and true Spotify display names become available. Tracked as a v2 candidate; nothing in v1 should preclude it.

## 9. Open questions

None — both former open items were resolved 2026-07-06 (final Q&A with Ry): the Downloads-scan candidate list is the default entry with file browser fallback (§3.1), and the minimal validation column set is confirmed as proposed (§3.2). History in `planning/04-open-questions.md`.
