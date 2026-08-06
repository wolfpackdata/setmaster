# Changelog

All notable changes to SetMaster 3 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.4] — 2026-08-05

**macOS becomes a real platform.** SetMaster now ships as a signed, notarized `SetMaster.app` inside a drag-to-Applications disk image — no terminal, no right-click-to-open, no *Privacy & Security* detour. The first SetMaster 3 build ever run on a Mac happened in this round, and the clean-install acceptance test passed against **this release's own notarized artifact** — `SetMaster-3.0.4-macos-arm64.dmg`, downloaded over localhost into a standard macOS account so it carried a real quarantine attribute, installed and launched on the first double-click with no Gatekeeper detour and the About block reporting 3.0.4. Full detail: [`build-notes/v3.0.4-fix-report.md`](build-notes/v3.0.4-fix-report.md).

This round also carries everything merged to `develop` since `v3.0.3`: the public mirror generator (#205), the Traktor-is-optional documentation pass (#208), and the macOS launcher/build record (#182).

**Read before installing on macOS.** The `.dmg` requires **Apple silicon and macOS 14 (Sonoma) or later** (#229). Intel Macs are not supported. Every Apple silicon Mac can run Sonoma, so the free OS update is all that is needed. Windows is unchanged and remains verified end to end.

### Added

- **Signed, notarized macOS `.app` in a `.dmg`** (#214) — a Cocoa launcher that owns the backend's lifetime, so the app stays in the Dock while SetMaster is up and **right-click the Dock icon → Quit** shuts the backend down. Deep-signed innermost-first, notarized and stapled **twice** (the app, then the image built from it). Runbook: [`build-notes/macos-dmg-runbook.md`](build-notes/macos-dmg-runbook.md).
- **App icon** (#214) — generated from the RML mark by `tools/icon/make-icon.py` on the Big Sur icon grid.
- **Public mirror generator** (#205, #226) — builds the published subset at [`wolfpackdata/setmaster`](https://github.com/wolfpackdata/setmaster) as a fresh orphan commit per release, behind an allowlist plus a fail-closed leak scan. Nothing in it pushes; publishing stays manual.
- **Artifact leak scan and bytecode path stripping** (#223) — both platform builders and both smoke checks now refuse to produce or accept an artifact that names the build machine.
- **macOS deployment-target gate** (#229) — the `.dmg` builder walks every nested Mach-O and refuses to build when anything needs a newer macOS than the app claims.

### Changed

- **The macOS minimum is now 14.0 (Sonoma)**, up from 11.0 (#229). See the note above.
- **Documentation states plainly that Traktor® is optional** (#208, #212) — set preparation stands alone and works with no collection loaded.

### Fixed

- **Release artifacts no longer ship the build machine's absolute paths** (#223). A `.pyc` records the absolute path of the source it was compiled from, and that path appears in every traceback a user sees; **2,945 files** in the 3.0.3 macOS payload named the builder's home directory, and `v3.0.3` shipped publicly that way. Bytecode is now recompiled with the recorded root rewritten to `SetMaster3`, and console-script wrappers no longer carry the build-time interpreter path.
- **The app no longer claims to run on macOS it cannot** (#229). `LSMinimumSystemVersion` said 11.0 while 19 bundled NumPy binaries required 14.0, so a macOS 11–13 user could install the app and never start it.
- **The public mirror can be generated again** (#239). Its fail-closed leak scan aborted on four benign documentation strings added during this round, deleting its output before verification ran — so the release could not complete its own publication step. Three are reworded; the fourth, the mirror repo's own public URL, is a reviewed exception.
- **The macOS deployment-target gate no longer passes binaries it cannot read** (#240). 64-bit universal (FAT64) Mach-O files were missing from its discovery set, which left them out of both the floor check and the innermost-first signing pass, and any binary whose target failed to parse was counted and then ignored while the build announced that everything met the floor. Both now fail the build.
- **Artifact leak scans can see build paths stored as UTF-16** (#241). The five scan sites were written three different ways and every one searched for a single contiguous byte run, so a path held in a PE resource or an embedded manifest — UTF-16 by definition — passed all of them while they reported the artifact clean. They now share one scanner covering UTF-8, UTF-16LE and UTF-16BE, case-insensitively. No shipped artifact was affected.
- **The macOS release build can be notarized without a terminal watching it** (#247). `notarize_wait()` piped `notarytool submit` straight into `awk`, which exits on its first match and closes the pipe mid-write; `notarytool` took SIGPIPE, `pipefail` promoted 141, and `set -e` killed the build — *after* the submission had gone live at Apple and *before* the script could print the one id needed to recover it. Whether it lost the race depended on output buffering, which differs between a TTY and a file, so it passed interactively for months and then failed on every logged or backgrounded run. Now capture-then-parse at all three call sites.
- **The public mirror can be generated again — a second time** (#251). The `--out` guard test added for #232 called `pytest.skip()` at module scope without `allow_module_level=True`, which raises a collection *error* rather than a skip; `tools/public-mirror/` never ships, so the skip always fired, and `--verify` correctly read the error as "the generated tree does not build" and refused to publish. The guard test written to protect the mirror was what made the mirror ungenerable.

### Known limitations

- The **`.tar.gz`** payload remains unsigned and declares no OS minimum, so an old-macOS user gets a raw dyld error with no prior warning. The `.dmg` is the better-behaved artifact.
- The **Windows** half of #223 is now verified on hardware (Windows PowerShell 5.1), which found and fixed three interpreter-level defects source review had missed (#236, #237).
- `npm run e2e` **cannot run on macOS at all** (#246) — `frontend/e2e/boot-backend.mjs` hardcodes a Windows `.venv\Scripts\python.exe`, so the suite cannot start its web server. The **golden-master pipeline tests** have also never run there: they skip silently without the machine-local cache, and that cache exists only on the Windows box. `pytest` itself does now run on macOS (229 passed / 3 skipped).
- **Force Quit orphans the macOS backend** (#233) — accepted as a risk for this release rather than dismissed. Force-quitting the app leaves the server running, and a later Quit will not stop it; the attach path also never compares the responding server's version to its own, so after an upgrade a stale orphan of the *previous* version can keep serving. Fixed in a later round. Right-click the Dock icon → **Quit** is the supported way to stop it.
- **Four fail-closed gaps remain in the public-mirror generator** (#245) — none currently leaking, and the one item that gates this release (the `--out` guard, #232) is fixed. Accepted risks, tracked separately.

## [3.0.3] — 2026-07-30

Third post-build-1 fix round — 36 issues across the set editor, the release path, the launchers, and repo hygiene, plus the version bump (#164). The first version proposed for release to `main`. Full detail: [`build-notes/v3.0.3-fix-report.md`](build-notes/v3.0.3-fix-report.md).

**Platform verification — read before installing.** Windows is verified end to end: full suites green on `develop`, plus a packaged-artifact smoke check against the extracted release payload. **macOS is untested.** The `.command` launchers, `release/build-macos.sh`, and `release/smoke-macos.sh` are written and structurally fixed (#182, #179), but no build of SetMaster 3 has ever been run on a Mac — no Mac was available for this round. macOS therefore ships as **unverified**, not as a claimed supported platform; the checklist that would earn the claim is [`build-notes/macos-release-verification.md`](build-notes/macos-release-verification.md), tracked by #182, and anything it turns up lands in a follow-up patch release.

### Added

- Fresh-install test launcher on both OSes — a second double-clickable instance on its own data dir (`SetMaster3-test`) and port (`8140`), with a guarded reset-to-fresh path (#122).
- Clean-machine release builders and artifact smoke checks — a self-contained per-OS payload with a bundled CPython and locked dependencies, needing no Python, Node, or terminal (#179).
- Set editor: "Add 10" toolbar button appends ten rows to the end of the set (#144).
- Set editor: full FX & Mix Notes text on hover when the cell is truncated (#135).
- Set editor: Shift+Enter commits and moves to the cell above (#137).
- Set editor: BPM direction arrows relative to the row above (#138).
- Set editor: show/hide the OUT TRACK TIMING and Mix Timer columns (#140).
- Set editor: natural-sorted validation lists in the set-page dropdowns (#141).
- Set editor: MOVE now asks before dropping Out-side data off the bottom — *Add 10 rows* or *Cancel* (#166).
- Settings: "Loud T # Column" and "Loud M # Column" display options (#145).
- Playlist Compare Tool: markdown links in comparison notes (#142).
- RML brand mark as the browser-tab favicon (#143).

### Changed

- Set export adopts the #72 timing vocabulary (`M #` / `T #`, Play Time, Mix Timer), group-prefixed (#104).
- Set editor: row delete removed from set pages rather than given new semantics, since deleting a row stranded the next row's Out-side columns on a track that no longer existed (#162).
- Set editor: row 1 BPM and Key are read-only and rendered as dashes, matching their timing cells (#165).
- Set editor: LEVEL values *containing* HOT match case-insensitively for the magenta treatment (#136).
- Settings: the Δ validation list is a range constraint ([-12, +12] in 0.5 steps) with a `-1.5 … +1.5` factory default including a bare `0` (#163).
- Settings: the SM2 workbook import entry point is removed and the importer marked legacy — every workbook Ry needed is imported; the code stays mounted and tested but unreachable (#192).
- Default "I like" emoji set (✅→✔️, 🥰→💜, 👎→🟥) (#123).
- React Router upgraded to 7.18.2, clearing the advisories the production lockfile resolved (#183).
- Repo: the frozen SM2 archive under `legacy/` is excluded from GitHub Linguist language stats (#195).
- Docs: `build-notes/api-contract.md` refreshed for the v3.0.2 settings keys (#106); development timeline added and its maintenance policy documented (#111, #114); `CLAUDE.md` aligned with the graduated GitHub SOP (#129); QA artifacts, round prompts, and `collection.nml` integrity snapshots checked in (#110).

### Fixed

- Backup/restore: a corrupt SQLite-shaped restore stranded the live data directory — the staged restore is now validated and rolls back a failed reopen (#180).
- Stop launchers terminated any process that owned the configured port; they now stop only a SetMaster 3 process they can prove is ours (#181).
- macOS double-click launch contract: `.command` launchers are mode 755 in git, the artifact ships as `.tar.gz` to preserve the exec bit, and the no-terminal instructions replace the old `chmod +x` step (#182) — **fix merged, not yet exercised on a Mac.**
- Set editor: MOVE left BPM, Key, and the OUT TRACK columns attached to the wrong rows (#133).
- Set editor: row formatting stopped short of the right edge with the sidebar expanded (#132).
- Set editor: BPM column sized to its content instead of floating the value in dead space (#134).
- Matrix and set editor now share one row-height basis instead of scaled vs unscaled font (#105).
- Matrix: BPM preset editor popover fix, follow-up to #75 (#107).
- `normalize_playlist_name` was defined twice and the unit tests covered the copy no production code called — the vestigial definition is gone (#199).

## [3.0.2] — 2026-07-09

Second post-build-1 fix round — 12 issues (#60, #72, #74–#83) plus the version bump (#89). Full detail: [`build-notes/v3.0.2-fix-report.md`](build-notes/v3.0.2-fix-report.md).

### Added

- Year-only Release Date header filter with two-way drawer mirroring and ten decade/relative presets (This Year … Before 1970) (#60).
- Matrix search bar now accepts year-only `released` comparisons (`released>=2021`), all five operators on date keywords, and DJ-style `released past N` / `this year` (#74).
- BPM range preset hot-buttons — editable and persisted — plus a draggable slider fill band on the matrix Filter drawer (#75).
- "Show Playlists Containing These Tracks" action in the matrix My Playlists menu — selects every playlist holding a track in the current filtered list (#79).
- Grid-only Zoom control on the Track–Playlist matrix (50–150%), scaling the grid without touching the toolbar, sidebar, or popovers (#81).
- Set editor STATS Mix Length now shows as orange H:MM, with a red warning when any Out-Track row has incomplete timing (#82).
- Orange cue-cell highlight on the linked In/Out track number while a Start/Transition timing cell is selected or edited (#83).

### Changed

- Set editor Out-Track timing columns grouped under an OUT TRACK TIMING super-header; timing headers relabeled `M #` / `T #`, and the grid calc columns renamed Play Time / Mix Timer (#72).
- Blank-cell Compare notes now render orange while typing, matching the saved note (#76).
- Matrix hides Last Played and Album Title by default (alongside File Path), with a one-time upgrade of untouched pre-existing layouts (#77).
- Display "Text Zoom" / "Zoom" control relabeled "Spacing" with its direction reversed (+ increases row height); persisted `text_zoom` settings migrate to `line_spacing` (#78).
- Matrix Play Count / On Super Playlist / On Non-Super Playlist headers wrap to two lines, reclaiming column width (#80).
- Round report renamed to `build-notes/v3.0.1-fix-report.md` per the SOP's version-based naming (#84, #88).

## [3.0.1] — 2026-07-08

Post-build-1 fix round (all 26 open issues). Full detail: [`build-notes/v3.0.1-fix-report.md`](build-notes/v3.0.1-fix-report.md).

### Added

- Matrix analysis CSV export (#14).
- Deterministic keyword search/filter layer for the matrix — self-contained, no LLM, groundwork for the deferred natural-language prompt bar (#24).
- Free-text search bar on the Track–Playlist matrix — case-insensitive contains-OR find across Artist / Album / Track (#15).
- "Clear All Filters" control on the matrix (#10).
- Versioning scheme + bump/tag/changelog SOP documented in `CLAUDE.md` (#85).
- "Skip Apply" live-filter toggle on the matrix Filter drawer — filters and quick-sorts apply instantly while it's on (#9).

### Changed

- Date columns display as M/D/YYYY with header-derived column widths (#6).
- Transition column width and Out-Track mirroring semantics (#25).
- S3 sort-arrow direction and tinted header fills (#7).
- Retroactive version alignment: `APP_VERSION`, `frontend/package.json`, and `backend/pyproject.toml` all moved to `3.0.1`; build #1 counted as v3.0.0 (#84).
- Filter drawer selections now mirror into their column header filters — each mirrored dimension lives in exactly one place (#8).
- Overall application type scale increased 10% — swept 72 hardcoded px font-size literals; CamelotWheel SVG labels deliberately unscaled (#2).

### Fixed

- Track–Playlist matrix now builds even when the Exportify folder is empty/missing — the run skips the Spotify® comparison instead of aborting on ExportifyDirError (#5).

## [3.0.0] — 2026-07-07

Build #1 — initial full rebuild of SetMaster 2 as an offline, local web app. Tagged `v3.0.0-build1`. Full detail: [`build-notes/final-report.md`](build-notes/final-report.md).

### Added

- Traktor® `collection.nml` → analysis pipeline, ported verbatim from SM2 and golden-master byte-identical on real data.
- Signature matrix analysis view (S3) at full scale — filter/sort as a single serializable state object.
- Structured set editor (transition rows) with three-format export (CSV / XLSX / Markdown).
- Exportify/Spotify® compare loop with fail-safe blank-cell notes that survive re-runs.
- SM2 workbook (`.xlsm`) import.
- Double-click launchers for Windows and macOS (macOS ships untested).
