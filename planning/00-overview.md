# SetMaster 3 — Overview

**Status:** Drafted 2026-07-06 from the completed spec package; all product decisions herein were made by Ry and are logged in `planning/04-open-questions.md` and `planning/05-pre-handoff-review.md`.
**Audience:** the Fable coding agent building SetMaster 3. Read this first, then `01-data-model.md`, then `03-ui-design.md`, then the feature specs in `02-features/`.

---

## 1. What SetMaster 3 is

SetMaster 3 (SM3) is an OS-agnostic web-app rebuild of **SetMaster 2** (SM2), an Excel/VBA + Python tool a professional DJ (Ry) has used for years. Two jobs, unchanged from the prototype (walkthrough §1):

1. **Set preparation** — a structured editor for writing out a DJ set as transition rows (track order, hot-cue numbers, EQ/level moves, timing, notes) before performing it.
2. **Catalog analysis** — reads a Traktor Pro collection (strictly read-only) and cross-references it against Spotify playlists exported via Exportify: gap-finding ("owned but not organized", "on Spotify but not owned") and compound filter/sort over the whole collection that Traktor itself cannot do.

**Build #1 mimics the prototype** (plus the specific additions listed in §5). The natural-language prompt feature and Perform Mode are explicitly deferred (§6).

## 2. Architecture (decided — not open to change)

- **Fully offline, local:** a backend process on the user's machine + a browser UI served on localhost. No cloud, no hosted services, no telemetry. All data on local disk.
- **Single-user:** no auth, no multi-tenancy. Do not architect for multi-user (Kyle's advice, `docs/sources/04-kyle-advice-web-app.md`). Keep the LLM-adjacent seams clean so a future "bring your own Claude" distribution model stays possible, but build nothing for it now.
- **The pipeline stays in Python** (decided 2026-07-06): SM2's four-stage data engine (`legacy/setmaster-2/.../setmaster/*.py`) is the starting point, with its matching/normalization heuristics **ported verbatim** — they are accumulated, battle-tested domain logic (code reference §2.4–2.5). Restructuring the stages is allowed; changing matching behavior is not.
- **Everything else is the builder's choice:** frontend framework, backend web layer, storage engine — pick pragmatically for a single-user local app.
- **Preserve the engine/presentation seam** (code reference §5): analysis data is computed by the pipeline and *rendered* by the UI. Don't re-derive analysis in the presentation layer.
- **Hard constraint — read-only Traktor access:** SM3 reads `collection.nml` and never writes to it or any Native Instruments file. This is load-bearing, stated repeatedly by Ry, and restated in UI copy (ui spec §5.6). No exceptions.
- The Spotify side is file-based in v1: the user manually downloads playlist CSVs from exportify.net; SM3 takes over everything after the download (`02-features/exportify-import.md`). No Spotify/Exportify API calls anywhere.

## 3. Platform, packaging, data location (decided 2026-07-06)

- **Windows and macOS, both first-class in build #1.** The prototype's Windows-only Traktor connection was the primary motivation for the rebuild — the OS split must not survive.
- **Launch UX:** a double-clickable launcher per OS that starts the backend and opens the default browser to the app. A non-programmer must be able to run SM3 without a terminal.
- **Data location:** the platform-standard per-user app-data directory (sets, notes, config, validation lists, import metadata, and `raw-data/exportify/`). Settings shows the path.
- **Backup:** a one-click "Back up all data" in Settings (zip of the entire data dir to a user-chosen location) and a restore-from-backup path.

## 4. Screens

Full inventory and visual system: `03-ui-design.md` §2. Build #1 ships S1 Home, S2 Set Editor, S3 Track-Playlist Matrix, S5 Playlist Compare Tool, S6 Settings, S7 Help/Reference, S8 Comparison Settings. S4 Perform Mode is deferred (§6).

## 5. Feature inventory (build #1)

| Feature | Spec | New vs. SM2? |
|---|---|---|
| Set Editor grid (transition rows, formatting, stats, reorder, undo) | ui spec §5.2, §6.4–6.5 | port |
| Track-Playlist Matrix (compound filter/sort, drawer, breadcrumb) | `02-features/track-playlist-matrix.md` | port + new filter UX |
| Pipeline run + status/feedback | ui spec §5.1, §7.2; code reference §2 | port |
| Exportify import (Downloads scan) + S8 Comparison Settings | `02-features/exportify-import.md` | new UX over ported pipeline |
| Comparison output table (flags, blank-cell notes, links) | `02-features/comparison-output-table.md` | new screen (was manual Excel work) |
| Set export (CSV / XLSX / Markdown) | `02-features/set-export.md` | new |
| Advanced Settings — editable validation lists | `02-features/advanced-settings-validation-lists.md` | new |
| SM2 one-time set importer | `02-features/sm2-set-import.md` | new |
| Set archive (archive / restore / permanent delete) | `02-features/set-archive.md` | new |
| Global display options (Spacing, Font Size, Key Display As ×4, Colorful Keys) | ui spec §3.5, §6.6 | new |

**Signature workflows that must work** (these define the product; walkthrough §7.5–7.6):

- *Fresh-set digging:* matrix drawer pass — playlist = Disco Cosmic, On Super PL ≥ 1, On Non-Super PL = 0 → curated tracks never used in a published set.
- *Compound dig:* BPM 118–122 + key Gm + sort by import date oldest-first, within one playlist.
- *Catalog refresh:* export ~2 dozen playlists from exportify.net → one-click import from Downloads → run pipeline → per-playlist comparison pages → work the "Go get"/"Organize" gaps, annotating blank cells with notes that survive every re-run.
- *Set prep:* build a set row-by-row in S2 with cue numbers, mix settings, timing; check stats; export.

## 6. Non-goals & deferred (build #1 must NOT include)

- **Natural-language prompt bar** — deferred; sole obligation: S3's unified filter/sort state stays one serializable object (`02-features/natural-language-prompt.md`).
- **Perform Mode (S4)** — deferred (Ry, 2026-07-06); design retained in ui spec §5.4 for a later update.
- **Spotify / exportify.net API integration** — v2 candidate; nothing in v1 should preclude it.
- **Timing-capture automation** (reading real timestamps instead of manual m:ss entry — walkthrough §8): future intention, not v1.
- **Cover-art thumbnails** — cut (no artwork source in `collection.nml`).
- **Move-downloads-to-trash prompt** — considered and explicitly cut; do not implement.
- **User profile / branding personalization — post-build-#1 to-do (Ry, 2026-07-06):** an optional user profile holding all-optional fields — **Artist/DJ Name**, **logo upload**, **customizable color palette** — used to personalize SetMaster 3's chrome to the DJ's own branding so the tool feels like their own. Defaults = stock RML SetMaster branding; the §1.3 trademark rules and RML About-block placement (`03-ui-design.md`) are unaffected. Nothing to build in v1 — the §3.1 design tokens already centralize color, which keeps a later palette swap cheap. *(Interpretation note: Ry wrote "personalize S3" — read as SetMaster 3 the app, not the S3 Matrix screen; confirm scope when picking this up.)*
- **Remote backup (paid option)** — future-build to-do (Ry, 2026-07-06): back up the user's local SetMaster data to a remote location as part of a paid tier. v1 backup is the local zip only (§3); the offline/no-cloud constraint stands for build #1. Nothing in v1 should preclude adding this later (the backup zip in §3 is a natural payload).
- Also out: PDF export, export of matrix/compare views, multi-user/auth, light theme, mobile (<1024px), Rekordbox/Serato support, cloud anything, any LLM integration.

## 7. Build #1 acceptance criteria (decided 2026-07-06)

Demonstrable end-to-end with Ry's real data:

1. **Pipeline + matrix:** read the real `collection.nml` → matrix renders and both signature drawer/filter workflows in §5 succeed at full collection scale (tens of thousands of rows, 100+ playlist columns) with interactive performance.
2. **Exportify loop:** import ~2 dozen real Exportify CSVs from Downloads → S8 auto-add → run → per-playlist comparison pages with correct flags; blank-cell notes survive a subsequent re-import + re-run (snapshot-merge, fail-safe).
3. **Set editing + export:** create a set; full grid editing incl. RED/YELLOW/Box formatting, drag reorder, undo, all four stats; export to CSV, XLSX, and Markdown per spec (emoji, `[UNSYNC]` tags, commas/newlines intact).
4. **SM2 import + packaged launch:** the one-time importer brings Ry's real sets over intact (per `sm2-set-import.md` acceptance), and the app starts from the double-click launcher on both Windows and macOS.

Perform Mode and the NL bar are not acceptance-gating (deferred).

## 8. Source-of-truth map

| Question | Look in |
|---|---|
| What does SM2 do and why | `docs/sources/01-prototype-walkthrough.md` |
| How SM2 is wired | `docs/sources/02-technical-walkthrough.md` → superseded on detail by `03-prototype-code-reference.md` |
| Exact schemas, matching logic, VBA behavior | `docs/sources/03-prototype-code-reference.md`; ground truth is `legacy/setmaster-2/` (read-only archive) |
| Data shapes & entities | `planning/01-data-model.md` |
| Visual system & screens | `planning/03-ui-design.md` + `docs/design/` |
| Per-feature behavior | `planning/02-features/*.md` |
| Why any decision was made | `planning/04-open-questions.md`, `planning/05-pre-handoff-review.md` |

Precedence on conflict: feature specs (latest decisions) > ui spec > source docs > transcripts. Code in `legacy/setmaster-2/` outranks all *descriptions of SM2*, but decided SM3 changes (logged in the planning docs) intentionally diverge from SM2 — a divergence marked "decided" is not a bug.
