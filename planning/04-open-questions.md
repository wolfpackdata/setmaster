# Open Questions

Gaps and ambiguities surfaced while turning capture material into spec. Each item should trace to a source doc and get resolved (or explicitly accepted as unresolved) before handoff.

**Update 2026-07-06:** the prototype code + workbook were archived into `legacy/setmaster-2/` and inspected (see `docs/sources/03-prototype-code-reference.md`). Items resolved by that inspection are moved to the "Resolved" section at the bottom, with pointers to where the answer now lives.

**Update 2026-07-06 (final Q&A):** Ry answered every remaining item one-by-one in a live review session. **Nothing is still open.** This doc is now history + pointers only.

**Scope decision 2026-07-06:** the **natural-language prompt bar is deferred out of build #1** — build #1 mimics the prototype; the NL feature is a future update Ry will specify later. See `planning/02-features/natural-language-prompt.md` for the deferral note and the one architectural obligation build #1 carries (serializable unified filter/sort state). Kyle's NL-query use cases remain archived for that later spec work.

## Still open

*None.* All items resolved as of the 2026-07-06 final Q&A below. Two non-blocking follow-ups were logged — post-first-build to-dos, not spec gaps: zoom hotkeys (see was-#5) and a paid remote-backup option (`00-overview.md` §6).

## Resolved (2026-07-06, final Q&A with Ry)

- **"Kyle's advice"** (was #2): substance delivered — archived at `docs/sources/04-kyle-advice-web-app.md` (Ry's call with Kyle, 2026-07-03; also at repo root as `kyle_advice_web_app.md`, which can be deleted). Key content for the build: concrete NL-query use cases (never-played "blanks", genre/playlist + unplayed, play-count, BPM-range, key-match filters), single-user-first architecture, clean separation for a possible "bring your own Claude" distribution model, and `/workflow` orchestration guidance (explicit orchestrator/delegate instruction, hands-off mode, spec quality as the main input). Folding it into `prompts/fable-workflow-prompt.md` is now ordinary Phase D work (task 10) — no longer blocked on missing input.

- **"Track X" toolbar label** (was #3): a mislabel in SM2. It is a static reminder that the timing data being entered (the M:SS times relating to T# and M#) pertains to the **In Track** — the label should read **"In Track"**. The timing-data explanation lives in the prototype's `HelpExamplePlaylist` tab. SM3 carries the reminder as an In Track annotation on the timing inputs rather than a toolbar item — see `planning/03-ui-design.md` §5.2.

- **Sample pipeline output CSVs** (was #4): closed — code-derived schemas (code reference §2.2–2.5) plus the one real joined sample (`docs/sources/examples/joined_discocosmic.csv`) are sufficient. Ry will not supply collection/matrix/compare samples.

- **Zoom/ribbon toolbar drops** (was #5): confirmed — zoom presets and ribbon hiding are dropped as Excel workarounds. **Follow-up (post-first-build, not v1 spec):** add zoom hotkeys once the built interface can be evaluated (Ry, 2026-07-06). Noted in `planning/03-ui-design.md` §5.2.

- **Import entry UX** (was #7): the backend Downloads scan is the default entry — the app pre-lists Exportify-shaped CSV candidates (newest first) for one-click import, with a plain file browser as fallback. (Ry expressed no preference; the proposed flow stands as decided.) Spec: `exportify-import.md` §3.

- **Exportify validation column set** (was #8): confirmed as proposed — required headers `Track URI`, `Track Name`, `Artist Name(s)`, `Album Name`, `Added At`.

- **Comparison table extras** (was #9): **hard-limit to the five decided columns.** No column-picker, no optional BPM/key/album. Spec: `comparison-output-table.md` §3.

- **Flag presentation** (was #10): friendly UI labels (the S5 chip labels in `planning/03-ui-design.md` §5.5 — Match / Go get / Organize / Traktor only), with **alphabetical** flag sort order (not actionability-first). Spec: `comparison-output-table.md` §4, §7.

- **Local-file link behavior** (was #11): **reveal in OS file manager** only (Explorer/Finder with the file selected); no open-in-player action. Spec: `comparison-output-table.md` §6.

- **Summary count line** (was #12): yes — format **"N tracks · M not matched to Traktor"** (e.g. "646 tracks · 105 not matched to Traktor", where M is the `Not-Trak-Collection` row count). Spec: `comparison-output-table.md` §9.

- **"Notes dropped" summary** (was #13 residual): yes — after each pipeline run, show the count of notes dropped because their gap resolved (e.g. "2 notes dropped (gaps resolved)"). Spec: `comparison-output-table.md` §5. *(The core snapshot-merge behavior was already fully resolved earlier on 2026-07-06 — notes on persisting gaps must never be lost; fail-safe merge; keying confirmed.)*

### Earlier same-day resolutions (design review with Ry)

- **Row-flag model** (was #6): typed flags vetoed. SM2's manual formatting carries forward directly (design spec §6.5): RED/YELLOW cell shading, Box border around one or many cells, one-click Clear removal. Typed annotations ("key change" etc.) are freeform text in FX & Mix Notes (SM2 column P). Formatting is presentational only — not queryable, not rendered in Perform Mode, exported natively in XLSX only (set-export §3.2).

- **Red play-count rule** (was #14): play count 0 shows as an explicit red `0` (not blank, as in the prototype); 0 and 1 render red. Matrix feature spec §11.9.
- **Track Name emphasis** (was #15): carry over, styled per the design doc's tokens (not literal cyan). Matrix feature spec §11.10.
- **Playlist column order** (was #16): alphabetical. Matrix feature spec §11.11.
- **Release Date display** (was #17): raw dates, MM/DD/YYYY. Matrix feature spec §11.12.
- **Drawer coverage** (was #18): Last Played / Play Count stay out of the drawer for v1; Ry will test. Matrix feature spec §11.13.

- **Exportify manual vs. automated** (was #1): **manual download from exportify.net stays for v1**, but the app takes over everything after the download — file browser defaulting to Downloads, storage into `raw-data/exportify/`, auto-add to the comparison config, and a new "Spotify-Traktor Comparison Settings" page (S8) replacing hand-edited `config__traktor_playlists_to_sync.csv`. App architecture decided as fully-offline local backend + browser UI. Spotify/exportify.net API integration is a v2 candidate. A considered move-downloads-to-trash prompt was **cut** — do not implement. Full spec: `planning/02-features/exportify-import.md`.

- **Canonical key notation** (was #6 in an earlier numbering): flats notation canonical (`Gbm`). Display governed by two global options — **Key Display As** (flats / sharps / Camelot) and **Colorful Keys** (on/off), with the per-key color palette taken from the prototype workbook's `load` tab. See `planning/03-ui-design.md` §3.5, §3.1, §6.6. *(Revised in the 2026-07-06 second review — supersedes the earlier "flats + Camelot toggle" wording.)*

## Resolved (2026-07-06, code inspection)

- **Comparison-table color coding** (was #1): the join output has an explicit 4-value `presence_flag` enum; the two "greens" are two distinct data states (`Not-Trak-Collection` = actionable "go buy"; `Not-Spotify / Yes-Trak-Playlist` = "don't care"). See code reference §2.5.
- **Code archive landed** (was #3): `legacy/setmaster-2/` now holds the public-release repo snapshot and the full VBA export of workbook 2.68.
- **"I like" icon set** (was #5): `⚠️` caution (template default), `✅` confirmed, `🚀` high-energy, `🥰` love it (the "swirl/pinwheel" icon). Free-form emoji cell — an open vocabulary, not a locked enum. See code reference §3.2.
- **Exact Python filenames** (was #7): `run_all_scripts.py`, `traktor_collection_load.py`, `traktor_playlists_from_collection.py`, `traktor_spotify_playlist_compare.py`, `traktor_spotify_playlist_join.py`. See code reference §1.
- **`CreateSheetFromTemplate`** (was #8): confirmed exactly as corrected in the audio; lives in `launchpad.bas`.
- **VBA macro names** (was #9): fully mapped — zoom = `ZoomToZoomWidth1/2`, box = `Button_box_it`/`Button_unbox_it`, red/yellow = `ToggleRed`/`ToggleAmber`, stats = `ToggleMixStatsRows` (stats are live formulas, not a macro computation), matrix formatting = `ApplyTrakMatrixFormatting`. Full inventory in code reference §4.
- **Compare vs. join division of labor** (was #11): stage 3 (`..._compare.py`) compares playlist *filenames* and writes `traktor_spotify_playlist_compare.csv`; stage 4 (`..._join.py`) does the track-level join and writes `Joined/joined_<playlist>.csv`. The track-playlist *matrix* CSV is produced by **stage 2**, not the join. See code reference §2.3–2.5.
- **Example playlist tab archived** (was #12): the workbook itself (with `EmptyPlaylist`, `HelpExamplePlaylist`, and hidden `TEMPLATE_V0`) is in the archive; its full column map, formulas, and annotations are extracted in code reference §3.2.
