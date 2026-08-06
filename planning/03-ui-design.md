# SetMaster 3 — UI / Design Specification

**Status:** Draft v1 (2026-07-06), reviewed with Ry (direction questions answered same day).
**Audience:** the Fable coding agent building the SetMaster 3 web app. Written to be implementable without access to the original screenshots, though they remain the ground truth.

**Sources this spec derives from (traceability):**

| Source | What it grounds |
|---|---|
| `docs/design/traktor-browse-list.png` | Track table styling: row density, column set, alternating rows, key color-coding, tabular numerals |
| `docs/design/traktor-playlist-folder-sidebar.png` | Sidebar tree: folder/playlist hierarchy, selection state, iconography |
| `docs/design/traktor-mixer-section.png` | NI control aesthetic: knob indicators, orange/blue accent usage, FX badge, label style |
| `docs/design/traktor-fx-channel-1.png` | NI control-strip aesthetic: grouped controls, dropdown, button labels |
| `docs/sources/screenshots/01-launchpad-tab.png` | Home screen content: setup fields, pipeline buttons, status chip, SM2 brand colors |
| `docs/sources/screenshots/02-playlist-tab-example-1.png`, `03-playlist-tab-example-2.png` | Set editor: real working sets, column semantics, magenta/cyan Out/In identity, flag icons, highlights |
| `docs/sources/screenshots/04-help-page.png` | Column semantics annotations; the "read across the line" performance tip that drives Perform Mode |
| `docs/sources/01-prototype-walkthrough.md` | Functional behavior behind every screen (§ references below) |
| `legacy/setmaster-2/.../RML SetMaster Public 2.68.xlsm`, `load` tab | Canonical key→color palette (§3.1); validation lists for Lows/Level/Δ/cue/I-like enums (§5.2) |
| Direction decisions from Ry (2026-07-06, two review rounds) | Visual identity, layout, contexts, branding, editing model, Perform Mode, sidebar collapse, global display options — see §1.1 |

---

## 1. Design direction (decided)

SetMaster 3 uses **Traktor / Native Instruments as the visual foundation** — near-black panels, dense data grids, restrained industrial styling, orange/blue signal accents — **with SetMaster 2's magenta/cyan identity retained as brand accents** (magenta = Out Track, cyan = In Track, everywhere those concepts appear).

### 1.1 Decisions confirmed with Ry (2026-07-06)

1. **Visual identity:** NI base + SM2 accents (not a Traktor clone, not a rebrand).
2. **App shell:** Traktor-style persistent left sidebar tree (see §4).
3. **Contexts (all required):** desktop prep (primary, 1440px+), a dedicated live **Perform Mode**, and tablet/touch down to ~1024px. Dark theme only for v1 — no light theme was requested.
4. **Branding:** keep the **RML SetMaster** wordmark, paired with a modern web type stack (§3.2).
5. **Set editor:** spreadsheet-style inline grid, **no gridlines or cell borders** — separation comes from row striping, spacing, and column group backgrounds, not rules. Full keyboard navigation.
6. **Key notation:** flats notation canonical internally. Display is governed by the global **Key Display As** option (§3.5): musical notes with flats (default, matches Traktor) / musical notes with sharps / Camelot. *(Revised 2026-07-06 second review — supersedes the earlier "flats + Camelot toggle" decision.)*
7. **Perform Mode:** a dedicated full-screen mode, not just display toggles (§5.4).
8. **Cell formatting:** **Decided (Ry, 2026-07-06) — the earlier typed-flag default is vetoed and removed.** SM2's manual formatting model carries forward directly: shade any selected cell(s) red or yellow, draw a box border around one or many cells, and remove formatting just as easily (§6.5). No semantic/typed flags anywhere; annotations like "key change" or "tempo up" are plain text in the FX & Mix Notes column (SM2's column P).
9. **Global display options (2026-07-06 second review):** four user-editable global options — **Spacing**, **Font Size**, **Key Display As**, **Colorful Keys** — specced in §3.5. Key colors come from the prototype workbook's `load` tab palette (§3.1), not an invented mapping.
10. **Sidebar collapse (2026-07-06 second review):** the sidebar carries an always-visible collapse control at its top for quick hiding while working in a set (§4).
11. **Editable validation lists (2026-07-06):** the Δ, Lows, Level, and I like value lists are user-editable (Add/Rename/Remove/Reset-to-factory) via an **Advanced Settings** section of S6; factory settings are the prototype `load`-tab lists. Rename propagates to all existing rows; Remove keeps in-use values in place and just stops offering them. Full spec: `planning/02-features/advanced-settings-validation-lists.md`.
12. **Branding & trademarks (2026-07-06):** SetMaster 3 is unaffiliated fan software — no Native Instruments®/Traktor® logos or assets ever ship in the product, and every UI-visible occurrence of "Traktor" / "Native Instruments" / "Spotify" carries the ® symbol ("Exportify" renders plain). RML is the developer brand; its mark appears in the sidebar lockup and the Settings About block only. Binding rules: §1.3.

### 1.2 Design principles

1. **Density is a feature.** This is a professional tool used for years; the Traktor browse list (~30px rows, 10+ columns) is the density benchmark. Do not "web-app-ify" with padded cards and generous whitespace in data surfaces.
2. **Dark is the only mode.** Used in studios and DJ booths. Near-black backgrounds, no pure white text.
3. **Color carries meaning.** Magenta = outgoing, cyan = incoming, orange = attention/big moment, green = confirmed/success, blue = selection/focus, key badges are hue-coded. Decorative color is not used.
4. **Read across the line.** A transition row is a sentence read left-to-right ("at T# of Out Track, launch M# of In Track, lows __, level __, swap at __" — from the help sheet). Layout, alignment, and Perform Mode all optimize for this scan pattern.
5. **Quiet chrome, loud data.** Controls follow the NI pattern: small, uppercase, letterspaced labels; muted surfaces; the data grid is the brightest thing on screen.

### 1.3 Branding, trademark & attribution rules (decided 2026-07-06)

SetMaster 3 is **independent fan software with no affiliation to Native Instruments**. The Traktor screenshots in `docs/design/` ground the visual direction but are reference material only. Hard rules for everything that ships:

1. **No Native Instruments assets.** Never render the Native Instruments or Traktor logos, logotypes, icons, or any bitmap/vector lifted from their products — not in the UI, exports, launcher/app icons, or anything packaged with the app. The aesthetic is inspired-by; every shipped asset is original.
2. **® on protected names.** Every user-visible occurrence of "Traktor", "Native Instruments", or "Spotify" — labels, headings, helper text, empty states, dialogs, S7 FAQ/help content, export headers — is written **Traktor®** / **Native Instruments®** / **Spotify®** *(Spotify added 2026-07-06)*. **"Exportify" renders plain** — no ®/™ (decided 2026-07-06; likely not a registered mark). This applies even to SM2-verbatim strings and the verbatim-extracted FAQ text (the one systematic edit allowed to otherwise-verbatim copy). Exempt: internal identifiers, file paths, config keys, code, and **data values** (e.g. the `presence_flag` enum strings and export data cells — ® goes on rendered labels/copy, never inside data). Spec prose in `planning/` may omit ®; the rule binds what the app renders — quoted UI-copy examples in this spec include it where practical.
3. **Attribution line.** The S6 About block (§5.6) and the S7 Help page footer carry: *"SetMaster 3 is independent fan software and is not affiliated with, endorsed by, or sponsored by Native Instruments®, Spotify®, or Exportify. Traktor® is a registered trademark of Native Instruments GmbH. Spotify® is a registered trademark of Spotify AB."*
4. **RML developer brand.** RML is the brand behind SetMaster (assets + usage notes: `docs/design/brand/`). Placement is deliberately restrained, per "quiet chrome" (§1.2): the sidebar-top lockup (§4) and the S6 About block (§5.6) — nowhere else. Do not put the mark on data surfaces, dialogs, or exports.

---

## 2. Screen inventory

| # | Screen | Replaces (SM2) | Spec |
|---|---|---|---|
| S1 | Home / LaunchPad | LaunchPad tab | §5.1 |
| S2 | Set Editor | Per-set playlist tabs | §5.2 |
| S3 | Track-Playlist Matrix | Traktor Track-Playlist Matrix tab | §5.3 |
| S4 | Perform Mode — **DEFERRED, not in build #1** (Ry, 2026-07-06 final review) | (new — SM2 used the editor live) | §5.4 (kept for the later update) |
| S5 | Playlist Compare Tool | Generated comparison sheets | §5.5 |
| S6 | Settings | LaunchPad config fields | §5.6 |
| S7 | Help / Reference | FAQ + HelpExamplePlaylist tabs | §5.7 |
| S8 | Spotify-Traktor Comparison Settings | `config__traktor_playlists_to_sync.csv` (hand-edited) | §5.8 (visual) + `planning/02-features/exportify-import.md` §6 (behavior) |
| — | NL Prompt bar (component, on S3) — **DEFERRED, not in build #1** | (new feature, future update) | §6.7 + `planning/02-features/natural-language-prompt.md` |
| — | Export dialog (component, on S2) | (new feature) | §6.8 + `planning/02-features/set-export.md` |
| — | Advanced Settings — editable validation lists (section of S6) | (new feature) | §5.6 + `planning/02-features/advanced-settings-validation-lists.md` |

---

## 3. Design tokens

Implement as CSS custom properties (names below are the spec). Hex values were sampled from the source screenshots; treat them as canonical unless contrast fixes are needed (§9).

### 3.1 Color

**Surfaces** (from Traktor screenshots — browse list, sidebar, mixer):

```css
--bg-app:        #0A0A0A;  /* app background behind panels */
--bg-panel:      #141414;  /* sidebar, toolbars, cards */
--bg-row:        #1A1A1A;  /* data grid row */
--bg-row-alt:    #151515;  /* alternating row stripe */
--bg-row-hover:  #232323;
--bg-selected:   #2A4A7F;  /* row/tree selection — Traktor sidebar blue */
--bg-input:      #101010;
--border-subtle: #2A2A2A;  /* panel edges only — never between grid cells */
```

**Text:**

```css
--text-primary:   #E6E6E6;  /* track names, values */
--text-secondary: #9C9C9C;  /* column headers (uppercase), file paths, secondary metadata */
--text-muted:     #5E5E5E;  /* disabled, placeholders, "---" empty values */
```

**NI accents** (mixer/FX screenshots — knob position indicators, FX badge, fader caps):

```css
--accent-orange: #FF6A00;  /* attention, active/armed states */
--accent-blue:   #3D7BFD;  /* focus rings, active fader/level indicators, links */
```

**SM2 brand accents** (LaunchPad + playlist tab screenshots):

```css
--brand-magenta: #FF4FD8;  /* Out Track identity: column-group header */
--brand-cyan:    #4DE8E8;  /* In Track identity: column-group header */
--brand-purple:  #9B5CFF;  /* wordmark accent, section headings (LaunchPad heading color) */
--brand-coral:   #FF5C5C;  /* secondary section headings ("View Options" color) */
```

**Semantic:**

```css
--status-success: #21C063;  /* pipeline "Completed" chip, confirmed flags */
--status-warn:    #E8B93B;  /* warnings; base for YELLOW cell shading (§6.5) */
--status-danger:  #D93030;  /* errors; base for RED cell shading (§6.5) */
```

**Key colors.** Canonical per-key colors come from the prototype workbook's `load` tab (`legacy/setmaster-2/.../RML SetMaster Public 2.68.xlsm`, columns H–J — extracted 2026-07-06). 24 keys in Camelot-wheel order, hue rotating around the color wheel so harmonically adjacent keys have adjacent hues. Applied to key text only when the **Colorful Keys** option is on (§3.5); no badge fill at grid density. Keys listed in flats notation (canonical); sharps display (§3.5) renames without changing color (e.g. `Gbm` → `F#m`).

| Key | Hex | Name | | Key | Hex | Name |
|---|---|---|---|---|---|---|
| C | `#F20D0D` | Crimson Red | | Gb | `#0DF298` | Teal |
| Am | `#F23F0D` | Vermilion | | Ebm | `#0DF2CA` | Turquoise |
| G | `#F2710D` | Tangerine | | Db | `#0DE8F2` | Sky Blue |
| Em | `#F2A20D` | Amber | | Bbm | `#0DB6F2` | Azure |
| D | `#F2D40D` | Golden Yellow | | Ab | `#0D84F2` | Cobalt |
| Bm | `#DEF20D` | Lime Yellow | | Fm | `#0D53F2` | Royal Blue |
| A | `#ACF20D` | Chartreuse | | Eb | `#0D21F2` | Indigo |
| Gbm | `#7BF20D` | Spring Green | | Cm | `#2B0DF2` | Violet |
| E | `#49F20D` | Emerald | | Bb | `#5D0DF2` | Deep Violet |
| Dbm | `#17F20D` | Fresh Green | | Gm | `#8E0DF2` | Purple |
| B | `#0DF235` | Mint | | F | `#C00DF2` | Orchid |
| Abm | `#0DF267` | Aquamarine | | Dm | `#F20DF2` | Magenta |

### 3.2 Typography

```css
--font-ui:   "Inter", system-ui, sans-serif;        /* everything */
--font-mono: "JetBrains Mono", monospace;           /* file paths, config values */
```

All numeric columns (BPM, Δ, cue #s, counts, timestamps) MUST use `font-variant-numeric: tabular-nums` so columns align without gridlines — this is what makes the borderless grid readable, and matches Traktor's browse list.

| Token | Size/weight | Use |
|---|---|---|
| `--type-display` | 20px / 700 | Wordmark "RML SetMaster", screen titles |
| `--type-heading` | 15px / 600 | Panel/section headings (in brand accent colors) |
| `--type-label` | 11px / 600, uppercase, +0.06em tracking | Column headers, control labels — the NI label style (`GAIN`, `FILTER`, `D/W`) |
| `--type-body` | 13px / 400–500 | Grid cell text (desktop) |
| `--type-small` | 11px / 400 | File paths, timestamps, footnotes |

**Global type scale (issue #2).** The sizes above are *base* values; every `--type-*-size` token and every component-level `px` font-size is expressed as `calc(<base>px × var(--type-scale))`, where `--type-scale: 1.10` in `tokens.css` applies a uniform **+10%** app-wide. A future global resize is a one-line change to that multiplier. The grid font size (`--grid-font-size`) is written inline by `settingsStore.applyDisplay()` as `font_size × 1.10`, composing the +10% baseline with the user's Font Size (§3.5) — the same scale, applied once, no double-scaling. Rendered defaults: body/grid 14.3px, heading ~16.5px, display 22px, label/small ~12.1px.

### 3.3 Spacing, radii, elevation

4px base unit. Radii: 4px (inputs, chips), 6px (panels, buttons). No drop shadows on data surfaces; a single subtle shadow (`0 8px 24px rgb(0 0 0 / .5)`) for popovers/modals only. Elevation is otherwise communicated by background lightness steps (`--bg-app` → `--bg-panel` → popover `#1E1E1E`).

### 3.4 Grid metrics

Values below are the **defaults** — i.e. Font Size at default and Spacing at 100%, calibrated to match the Traktor screenshots (`traktor-browse-list.png`). Both are user-adjustable via §3.5.

| Context | Row height | Cell font |
|---|---|---|
| Desktop grids (S2, S3, S5) | 32px | 13px |
| Touch (≤ ~1194px viewport or coarse pointer) | 44px | 14px |
| Perform Mode | 64px minimum, current row scaled larger | 18–24px |

### 3.5 Global display options (user-editable)

Four global options (apply app-wide, persisted per user), all editable from Settings → Display (§5.6), plus one grid-local option (**Zoom**, S3 only). Font Size and Spacing also get quick controls in the S2/S3 toolbars; Zoom is an S3-toolbar-only control.

| Option | Control | Default | Behavior |
|---|---|---|---|
| **Zoom** *(S3 only, issue #81)* | percentage stepper, 50%–150% in 10% steps | **100%** = no zoom | Grid-only, browser-zoom-style scale for the **Track-Playlist Matrix (S3)**: scales everything inside `.mx-gridwrap` (frozen + playlist column headers, all cells, row heights, column widths, padding) and nothing else — sidebar, page header, toolbar, search row, filter-breadcrumb row, filter drawer, and all popovers/menus stay at 100% because they render outside the grid container. A **multiplier** on the final rendered result of Font (text size) and Spacing (row density): never folded into the row-height formula or the stored column widths, so it composes losslessly (80% → 100% round-trips pixel-exactly). Implementation (ruling R4): CSS `zoom` on `.mx-gridwrap` — participates in layout so both virtualizers, the sticky header, and scroll extents stay consistent; column-resize drag deltas divide by the zoom factor. Persisted key `matrix_zoom`; absent in a pre-#81 file → 100. Quick control lives left of Spacing in the S3 toolbar (**Zoom · Spacing · Font**); it is **not** shown on S2 or in Settings → Display. |
| **Spacing** | percentage stepper, 70%–150% in 10% steps | **100%** = the Traktor-screenshot line spacing | Controls the gap between lines (row density), **not** font size. **Higher spacing → more room between lines; lower spacing → denser grid** — the value moves in the same direction as the visual effect. Implementation: vertical row padding scales directly with spacing — `row-height = font-size + round(19px × spacing / 100)`. At defaults: 100% → 32px rows (unchanged from the pre-#78 formula); 70% → ~26px (max density); 150% → ~42px (max breathing room). Persisted key `line_spacing`; a pre-#78 file's inverse `text_zoom` migrates on first load (`spacing ≈ 10000 / text_zoom`, snapped to the 10% step, clamped 70–150) so density is preserved. |
| **Font Size** | up/down arrow stepper, 1px steps, **bounds 10px–20px** | **13px** = the Traktor-screenshot text size | Sets the grid/body text size (`--type-body`). Label/heading type (§3.2) does not scale with it. Row height derives from it per the Spacing formula, so the two options compose. |
| **Key Display As** | 4-value select **(revised 2026-07-06 final review: Open Key added)** | Musical notes with **flats** (matches Traktor's text fields) | (1) musical notes with flats (`Gbm`), (2) musical notes with sharps (`F#m`), (3) Camelot wheel values (`11A`), (4) **Open Key values (`4m`) — what Traktor itself displays**. Conversion tables in §6.6. Display-layer only — internal representation stays flats-canonical. Applies everywhere a key is shown (grids, filter chips, exports). |
| **Colorful Keys** | on/off toggle | **On** | On: key text renders in its per-key color from the `load`-tab palette (§3.1). Off: key text renders in `--text-primary` like any other cell. |

Floors that override these options: touch contexts never drop below 44px row height / 44px targets (§8), and computed row height never falls below `font-size + 8px`.

---

## 4. App shell & navigation

Persistent **left sidebar** (Traktor playlist-tree pattern, from `traktor-playlist-folder-sidebar.png`) + main content pane. No top tab strip.

```
┌──────────┬─────────────────────────────────────────────┐
│ RML      │  [toolbar for current screen]               │
│ SetMaster│                                             │
│──────────│                                             │
│ ⌂ Home   │                                             │
│ ▦ Matrix │            main content pane                │
│ ⇌ Cmp Set│                                             │
│ ⇄ Compare│                                             │
│──────────│                                             │
│ ▾ Sets   │                                             │
│   ▸ 📁.. │                                             │
│   ♪ set  │                                             │
│──────────│                                             │
│ ⚙ Settings  ? Help                                     │
└──────────┴─────────────────────────────────────────────┘
```

- **Sidebar width:** 260px, collapsible to 48px icon rail; resizable by drag. Persist state per user.
- **Header lockup (2026-07-06):** the RML sunset mark (`docs/design/brand/rml-mark.svg`, ~20px tall) beside the "RML SetMaster" wordmark re-set in the web type stack (§10). Collapsed rail shows the mark alone. The lockup is static chrome, not a navigation item. RML usage rules: §1.3.
- **Collapse control (required):** an always-visible collapse/expand toggle at the **top of the sidebar** (chevron button beside the wordmark), so the sidebar can be hidden quickly while working in a set page. Keyboard shortcut `Ctrl/Cmd+B`. Collapsed state shows the icon rail with the same toggle at top; the main pane reclaims the width.
- **Fixed entries** (top): Home, Track-Playlist Matrix, Spotify®-Traktor® Comparison Settings, Playlist Compare Tool. The Comparison Settings entry (S8, route `/comparison-settings`, sliders glyph) sits immediately after Track-Playlist Matrix; its label carries the ® marks per §1.3 and truncates with an ellipsis at the 260px width (full text in the row tooltip / collapsed-rail tooltip). **Sets tree** below: user-created folders and sets, mirroring the Traktor sidebar interaction — disclosure triangles, folder icons, playlist icon per set, full-row highlight in `--bg-selected` for the active item, hover in `--bg-row-hover`. **Bottom-pinned:** Settings, Help.
- Tree rows: 28px, 13px text, 16px indent per level.
- Right-click context menu on sets: Open, Rename, Duplicate, Move to folder, **Archive** (replaces Delete — decided 2026-07-06; permanent deletion exists only inside the archive view, see `planning/02-features/set-archive.md`). *(Add "Open in Perform Mode" when S4 ships — deferred out of build #1.)*
- **Archived section (2026-07-06):** a collapsed **"Archived"** entry with count badge at the bottom of the Sets tree (hidden when empty) opens the set-archive view — list, Restore, Delete permanently. Full spec: `planning/02-features/set-archive.md`.
- **New Set** button (+) at the Sets header — replaces SM2's "New Set from Template" (walkthrough §4); prompts for name, creates from the standard template. **Set naming rule (decided 2026-07-06):** trimmed, non-empty, unique among sets, ≤100 characters; all characters allowed (export filenames slugify separately per set-export §5; XLSX sheet names truncate to 31 chars on export only).
- The SM2 "Jump To Set" dropdown and rocket-ship "return to LaunchPad" button (walkthrough §4) are made obsolete by the always-visible tree; do not reproduce them.

---

## 5. Screens

### 5.1 S1 — Home (replaces LaunchPad tab)

Source: `01-launchpad-tab.png`, walkthrough §4, §6, §7.3. Two-column layout on desktop, stacked on tablet.

**Left column — "Sets":** recent sets list (name, last edited, track count) with open/perform actions; New Set button. This replaces the LaunchPad's navigation role.

**Right column — "Traktor® Collection Tools"** (keep this section name, now carrying ® per §1.3; heading in `--brand-purple`):

- Read-only summary of configured paths (collection file, superplaylist root folder) with an "Edit in Settings" link — configuration itself lives in S6.
- Pipeline actions as buttons: **Choose Which Playlists Compare**, **Read Collection & Remake Tables**, **Exclude Playlists by Prefix** (deep-links to the exclude-prefixes chip list in S6's Traktor® connection section; walkthrough §7.3). Keep the first two labels exact — they are established user vocabulary.
- **Status chip** for the last pipeline run: pill, `--status-success` fill, dark text, e.g. `Completed 07-06-2026 12:24 PM` (exactly as in the screenshot). Failed runs: `--status-danger` fill with an error disclosure. While running: indeterminate progress bar in `--accent-orange` with step text (see §7.2).
- Reminder text (small, `--text-secondary`): user must Save Collection inside Traktor before reading (walkthrough §6.2). **Plus (decided 2026-07-06, in build #1): show `collection.nml`'s file modified time beside the Read button** — "collection.nml last saved <date/time>" — mirroring the Exportify staleness treatment, so a forgotten Save Collection is visible before running. Also shown on S8 next to Re-read Collection File.

### 5.2 S2 — Set Editor (replaces per-set playlist tabs)

Source: `02-playlist-tab-example-1.png`, `03-playlist-tab-example-2.png`, `04-help-page.png`, walkthrough §5. The core surface — one row per transition.

**Grid style — the defining visual decision:** spreadsheet-like inline-editing grid with **no gridlines and no cell borders**. Structure is communicated by: alternating row stripes (`--bg-row`/`--bg-row-alt`), tabular-nums alignment, whitespace between column groups, and two tinted column-group headers spanning their columns — **Out Track** group header in `--brand-magenta`, **In Track** group header in `--brand-cyan` (as in SM2). Group tint may also wash the underlying cells at ~4% opacity to keep the out/in halves distinguishable while scrolling.

**Columns, in order (semantics per walkthrough §5.1–5.5):**

| Group | Column | Width | Align | Editor |
|---|---|---|---|---|
| — | BPM | 56px | right | numeric — **always manually typed; never auto-populated from the collection** (Ry, 2026-07-06: set-row BPM/Key frequently differ from metadata due to normal mixing behavior; collection metadata is used only on the matrix in build #1) |
| — | Key | 48px | center | key badge (§3.1 hues; §6.6 notation) — **manually typed, same rule as BPM above** |
| Out | Out Track Name | flex | left | read-only — auto-populated from previous row's In Track |
| Out | Δ (pitch) | 48px | right | dropdown offering the current Δ validation list (factory `---`, ±0.5/±1/±1.5 and `0` — issue #163; user-editable anywhere in ±12 — advanced-settings spec §2) |
| Out | T# | 44px | center | cue dropdown 1–8 |
| Out | A# | 44px | center | cue dropdown 1–8, optional |
| In | In Track Name | flex | left | text with typeahead against the collection (§6.4) |
| In | Δ (pitch) | 48px | right | numeric stepper |
| In | M# | 44px | center | cue dropdown 1–8 |
| Mix | Lows | 72px | center | enum: `cut` / `cut-swell` / `open` / `0.5` |
| Mix | Level | 72px | center | enum: `silence` / `open` / `HOT` / `HOT-LP` / `LP` / `HP` / `LP-silence` / `HP-silence` |
| Mix | Swap Lows | 60px | center | cue dropdown or `---` |
| — | I like | 40px | center | emoji cell, open vocabulary (§6.5) |
| — | FX & Mix Notes | flex, widest | left | free text — SM2's column P; the home for all freeform annotations (key changes, tempo moves, big moments) |
| Timing | M # (ex Start) | 60px | right | m:ss input |
| Timing | T # (ex Transition) | 60px | right | m:ss input |

**MOVE never drops Out-side data off the bottom (issue #166 — decided 2026-07-29).** Because a track's Out-side values live on the row *after* the one naming it, the track sitting last has nowhere to store its own. #133's D-16 accepted that loss as inherent; #166 makes it a choice instead. Before any reorder — Alt+↑/↓, Move-mode ↑/↓ or the drag handle, all of which share one guard — SM3 checks whether the track that would *end up last* carries Out-side values that would be dropped, and if so holds the move back behind a confirm: **Add 10 rows** (append ten empty rows, then perform the move, so the track keeps a row below it and nothing is lost) or **Cancel** (abandon it; the set is untouched). The append and the move are a single undo step. The check is on the track that ends up last, **not** the one being dragged — moving the bottom track *upward* pushes another track into last place, and that is the case a naive "did the user move a row down?" test would miss. A move that would lose nothing — an empty row going to the bottom — is never interrupted.

**Row 1's Out-side cells are read-only (issue #83, widened by #165 — decided 2026-07-29).** Row 1 has no Out Track, so every column describing one describes nothing there. `M #` / `T #` (OUT TRACK TIMING) were made read-only in #83; **`BPM` and `Key` join them in #165** — they are stored *on* a row while describing the track one row **earlier** (the offset-by-one #133 untangled for MOVE), so on row 1 they were freely typable cells whose value could never mean anything. All four render a muted em-dash placeholder (distinct from the `---` empty-enum text) with an explanatory tooltip, stay **selectable** (keyboard-nav continuity) and **formattable** (fills are a property of the selection, not of editability), and any pre-existing value stays visible-but-muted and **clearable** — never altered or dropped. Editability follows row **position**, not identity: reordering a row into or out of position 1 changes it. `T #` / `A #` are also Out-side and equally inert on row 1 but remain editable — #165 scoped itself to BPM and Key. Consequence worth knowing: a track's BPM belongs on the row **below** the row naming it, exactly as its timing does, so the BPM Avg. / BPM Crest stats read from rows 2..n.

**OUT TRACK TIMING super-header (issue #72):** the two timing columns render as `M #` / `T #` (renamed from `Start` / `Transition`) and, together with the derived `Play Time` column (renamed from the SM2 `Mins Calc` running-per-row track), form a third column-group under an **OUT TRACK TIMING** super-header in `--brand-magenta`, styled exactly like the **Out Track** group header. The per-header pink wash and the `· M#` / `· T#` cue suffixes (D-040 / #25) are removed — the Out-Track cue is now carried entirely by the super-header; the M:SS hover tooltips stay. The derived running total renders as **`Mix Timer`** (renamed from the SM2 `Mix Length` track) and stays **outside** the group. These four grid-column renames are decided product divergences from SM2 vocabulary; the STATS-panel **`Mix Length`** stat (below) keeps its label verbatim.

Keep exact SM2 labels (`T #`, `A #`, `M #`, `Lows`, `Level`, `Swap Lows`, `I like`, `FX & Mix Notes`); the timing/derived grid columns `M #` / `T #` / `Play Time` / `Mix Timer` are decided divergences (issue #72), not SM2-verbatim. `HOT` renders in `--brand-magenta`, `[UNSYNC]` name tags render as a small chip parsed from the bracketed prefix (walkthrough §5.4). **Enum provenance (2026-07-06):** the Lows, Level, Δ, and cue value lists above are the workbook's actual validation lists, extracted from the prototype's `load` tab — they supersede the shorter observed subsets in walkthrough §5.3 (notably Level has 8 values, not 4). Cue dropdowns offer `---` plus `#1`–`#8`; Δ offers `---`, ±0.5/±1/±1.5 and `0` (issue #163 added `0`; the wider ±12 the field accepts is what a user may *add*, not what ships). **These `load`-tab lists are the factory defaults**: the Δ, Lows, Level, and I like lists are user-editable via Advanced Settings (`planning/02-features/advanced-settings-validation-lists.md`); cue lists are fixed.

**Toolbar** (top of grid): Stats toggle — **all four SM2 stats (decided 2026-07-06): # Tracks, Mix Length, BPM Avg., BPM Crest (max−min)** — plus the per-row cumulative time, from Start/Transition columns (walkthrough §5.5, workbook formulas in code reference §3.2), formatting controls — **RED**, **YELLOW**, **Box**, **Clear** (§6.5), Move mode, quick Text Zoom / Font Size steppers (§3.5), set title, and — at the toolbar's right end — a **three-dot (⋯) overflow menu** (decided 2026-07-06) containing exactly: **Export…** (`Ctrl/Cmd+E` still works — CSV/XLSX/Markdown with remembered save location, §6.8 + `planning/02-features/set-export.md`; replaces the earlier standalone Export button) and **Archive Set** (`planning/02-features/set-archive.md`). *(The Perform Mode button — rocket icon — joins the toolbar only when S4 ships; deferred out of build #1.)* The SM2 toolbar's Excel-workaround items (zoom presets, ribbon show/hide) are **dropped — confirmed by Ry 2026-07-06**; browser zoom and §3.5 cover them. *(Post-first-build to-do, not v1 spec: add zoom hotkeys once the built interface can be evaluated — Ry 2026-07-06.)* RED, YELLOW, and Box/Un-Box are **not** workarounds — they carry forward as the §6.5 formatting controls.

**"Track X" label resolved (Ry 2026-07-06, was open question #3):** SM2's toolbar label was a mislabeled static reminder that the timing data entered in a row (the M:SS times relating to T# and M#) pertains to the **In Track** — it should have read **"In Track"**. SM3 carries the reminder not as a toolbar item but as an annotation on the timing inputs, plus a coach mark in the S7 annotated example set. *(Superseded post-build-1 by issue #25, D-040: the timing semantics are the **Out Track** — the Start/Transition header badge reads "Out Track" with a `--brand-magenta` tint; cyan stays reserved for In-Track concepts.)* Timing-data explanation source: SM2's `HelpExamplePlaylist` tab (archived in `legacy/setmaster-2/`, extracted in code reference §3.2).

**Row reordering** replaces the Move macro (walkthrough §5.6): drag handle on row hover (drag row or multi-selected block; 2px `--accent-blue` insertion line), plus a keyboard equivalent (Alt+↑/↓ moves selection). No confirm prompts — undo (Ctrl+Z, full edit history per set) replaces SM2's "are you sure?" flow.

**Keyboard model (required):** arrow keys move cell focus; Enter edits/commits+moves down; Tab commits+moves right; Esc cancels; typing over a selected enum cell opens its dropdown filtered to the keystroke. Focus ring: 2px `--accent-blue`, inset (no layout shift — there are no borders).

### 5.3 S3 — Track-Playlist Matrix

Source: `traktor-browse-list.png` (visual benchmark), walkthrough §7.5–7.6, populated-tab screenshot `docs/sources/screenshots/05-traktor-track-playlist-matrix.png`. One row per track in the playlist-tagged collection; "constantly open" while building sets — treat as a first-class screen, not a report.

**Full behavior spec (2026-07-06, supersedes this section's earlier column/filter details): `planning/02-features/track-playlist-matrix.md`.** Summary:

- **Columns** (feature spec §3): Import Date, Release Date, Last Played, Play Count (red never/rarely-played marker), BPM, Key (badge per §6.6), Album Title, Artist Name, Track Name, **On Super PL** (`--status-success` green), **On Non-Super PL** (`--brand-magenta`, cell highlighted when > 0) — display labels renamed per issue #11; the CSV export headers stay `On Root PL` / `On Non-Root PL` (frozen contract), per the feature spec — then **one visible column per playlist** (decided — replaces the chip-list column drafted here earlier). File Path optional, hidden by default. **Cover art is cut from build #1 (Ry, 2026-07-06)** — `collection.nml` carries no artwork; tag-art extraction is a possible later update. Column show/hide + reorder, persisted; metadata columns frozen.
- Same borderless dense grid style as S2, read-only cells, virtualized both axes (tens of thousands of rows × 100+ playlist columns).
- **Filtering:** every column sortable + filterable, plus an **FX-channel-styled right-side filter drawer** (feature spec §5 — one toggleable line per filter, Camelot-wheel key selector, Apply + preview count, quick-sort buttons) and a **sentence-form breadcrumb** persisting above the grid (feature spec §6). Drawer, column filters, and NL prompt share one filter/sort state. Every workflow in walkthrough §7.5 must be expressible: e.g. *playlist = "Disco Cosmic" AND root # > 0 AND non-root # = 0*, or *BPM 118–122 AND key = Gm, sort import date ascending*.
- **Natural-language prompt bar — DEFERRED (not in build #1).** When added in a later update it will dock at the top of this screen (§6.7) and emit the same unified filter + sort state, so NL and manual filtering are one system. Build #1: do not render the bar; just keep the filter/sort state a single serializable object (see `planning/02-features/natural-language-prompt.md`).

### 5.4 S4 — Perform Mode (new) — **DEFERRED, not in build #1**

**Status (Ry, 2026-07-06 final review): deferred out of build #1**, like the NL prompt bar — build #1 ships the S2 grid as the live-performance surface (as SM2 was used). The design below is retained for the later update; do not implement, and drop the Perform Mode toolbar button (§5.2) and sidebar "Open in Perform Mode" context item (§4) from build #1.

Source: the help sheet's "Pro user tip" (`04-help-page.png`): *scan across a row and register "T#, M#, Lows, Level, Swap"* — this mode is that tip turned into a screen. Context: on-stage, low light, glanced at between actions, possibly touch (walkthrough §9: used live for 3-hour sets).

- Full-screen, chrome-free (sidebar and toolbars hidden; Esc or corner button exits).
- One transition per row, ≥64px rows, 18–24px text. **Current row** enlarged (~1.5×) and pinned center-third of the viewport; previous rows dimmed to ~40% opacity above; upcoming rows full brightness below.
- Row content reduced to the read-across essentials: Out name → **T#** · In name → **M#** · **Lows / Level / Swap** as large enum chips · Δ if nonzero · the note (truncated, tap to expand). Editor cell shading/boxes (§6.5) are **not** rendered in Perform Mode — they're a prep-time aid only (decided 2026-07-06).
- Advance current row: tap/click anywhere on next row, Space, or ↓. Nothing in this mode edits data except the "I like" cell and a running-time display fed by the Start/Transition columns (walkthrough §5.5's "where do big moments land in real time").
- Touch targets ≥44px throughout. No hover-dependent affordances.

### 5.5 S5 — Playlist Compare Tool

Source: walkthrough §7.4 + code reference §2.5. One section (or tab-within-screen) per compared playlist. Rows are tracks with the 4-value `presence_flag`; render as a **filterable status column**, not row paint:

| `presence_flag` | Chip label | Color |
|---|---|---|
| `Yes-Trak-Playlist` | Match | `--text-muted` gray |
| `Not-Trak-Collection` | Go get | `--status-success` (the actionable bucket) |
| `Not-Trak-Playlist / Yes-Trak-Collection` | Organize | `--accent-orange` |
| `Not-Spotify / Yes-Trak-Playlist` | Traktor® only | `--text-secondary` |

**Full behavior spec: `planning/02-features/comparison-output-table.md` (2026-07-06 — supersedes this section where they differ).** Default view **(decided 2026-07-06, replaces this section's earlier pre-filtered default):** the full interleaved list in `track_collate` order (near-miss joins visible side-by-side) with a one-click **Hide matched** button, flag multi-select and noted-cells filters, and the summary line **"N tracks · M not matched to Traktor®"** above the table. A per-playlist gap-count summary also shows on Home after a pipeline run.

**Columns menu (issue #20, 2026-07-07):** a **Columns** button to the right of **Hide matched** opens a checkbox popover that opts in four extra columns — **Traktor® Artist, Traktor® Album, Spotify® Artist, Spotify® Album** (from the joined CSV), all off by default. The Flag and the two Track columns are non-hideable; Local File and Spotify® Link may be hidden. Shown columns keep a fixed order (each artist/album next to its source's track column); labels carry ® per §1.3. Visibility is shared across all compare playlists and persisted per-screen (localStorage), surviving tab switches and reloads (ruling R5). `table-layout: fixed`: narrow columns fixed-width, text columns share the rest; a computed table min-width lets a wide set scroll rather than crush the text.

### 5.6 S6 — Settings

Source: walkthrough §6.1, §7.3; `01-launchpad-tab.png` field examples. Sections: **Traktor connection** (collection.nml location, superplaylist root folder name — with helper text explaining root vs. non-root per §7.6; and the **Exclude Playlists by Prefix** editable chip list — Traktor® playlists whose names start with any listed prefix are dropped from the pipeline and matrix), **Spotify data** (link to the Import Spotify® Data flow and the S8 Comparison Settings page — behavior in `planning/02-features/exportify-import.md`; the playlist include list now lives entirely on S8, not here), **Display** (the four global options from §3.5: Text Zoom, Font Size, Key Display As, Colorful Keys), and a collapsed-by-default **Advanced Settings** section housing the editable validation lists for Δ / Lows / Level / I like, each with Add/Rename/Remove and a per-field Reset-to-factory (spec: `planning/02-features/advanced-settings-validation-lists.md`). Form style: NI control-strip flavor — uppercase 11px labels above inputs, `--bg-input` fields, no heavy field borders (bottom hairline in `--border-subtle`, `--accent-blue` when focused). Read-only constraint stated in UI copy: SetMaster never writes to the Traktor® collection (walkthrough §6 — load-bearing). **About block (2026-07-06):** at the bottom of S6 — RML mark + "RML SetMaster" lockup (§1.3.4, assets in `docs/design/brand/`), app version, and the §1.3.3 attribution/disclaimer line.

### 5.7 S7 — Help / Reference

Replaces FAQ + HelpExamplePlaylist tabs. Two parts: a searchable FAQ page — **content base: the SM2 FAQ text, extracted verbatim to `docs/sources/05-sm2-faq-text.md` (2026-07-06), with the SM3-note items there rewritten (name-matching rule, web-app question)** — and an **annotated example set** — a real S2 grid populated with the HelpExamplePlaylist content (from `legacy/setmaster-2/`), with callout popovers reproducing the yellow annotation boxes in `04-help-page.png` (column meanings, the transition-event reading, the pro tip). Implement callouts as dismissible coach marks anchored to the relevant columns. Traktor®/Native Instruments® naming per §1.3.2 is applied to the FAQ text (its one systematic edit); the page footer carries the §1.3.3 attribution line.

### 5.8 S8 — Spotify-Traktor Comparison Settings (visual spec; behavior: `planning/02-features/exportify-import.md` §6–7)

Layout decisions confirmed with Ry 2026-07-06 (pre-handoff review). Standard S6 form/grid treatment throughout (§5.6, §6.1–6.3).

**Page toolbar (decided — one top toolbar):** all three actions as buttons, left-aligned after the page title:

- **Import Spotify® Data** — the page's main verb: `--accent-orange` primary variant (§6.2; the one primary per view).
- **Re-read Collection File** — standard button; beside it, small `--text-secondary` staleness text: *"collection.nml last saved <date/time>"* (§5.1 treatment). Runs the pipeline with §7.2 feedback.
- **Open Exportify** — secondary button with external-link icon; opens `https://exportify.net` in a new tab.

**Two independent panels (decided — no row alignment):** side-by-side below the toolbar, Traktor left (~55%), Spotify right (~45%), each its own scroll region with a sticky panel header (uppercase 11px label + count, e.g. `TRAKTOR® PLAYLISTS · 134` (® per §1.3), `SPOTIFY® DATA · 24`). Matching is conveyed per-row (below), never by cross-panel geometry.

**Traktor panel (decided ordering):** search-filter box in the panel header; rows grouped **checked-first** (the working comparison set), then unchecked, each group A–Z by display name. Row anatomy, 32px (§3.4): checkbox (the page's only editable control) · playlist name (`--text-primary`) · right-aligned coverage slot:

- checked + fresh data → quiet `--text-muted` import-age text ("data 2 days old")
- checked + stale/no data → **amber `--status-warn` text** ("no Spotify data" / "data 43 days old") — informational, no row fill (decided)
- unchecked → coverage slot empty

**Spotify panel:** read-only rows: display name · `--type-small` source filename + import date (`--font-mono` for the filename) · match indicator:

- matched → small `--status-success` ✓ with "matched to <Traktor name>" tooltip
- **no Traktor match → soft red row fill derived from `--status-danger` (text kept ≥4.5:1, §9) + stop-sign icon (16px icon set, not emoji)** — unmissable (decided); helper text on hover/expand: *create the playlist in Traktor, save the collection, then Re-read Collection File*
- normalize-conflict (two Traktor playlists collide for one Spotify name — exportify-import §7) → same red treatment with a conflict icon and both candidate paths listed; never silently picked

**Empty states (§7.1 pattern):** no collection read yet → Traktor panel explainer + Read Collection primary action; no Exportify data → Spotify panel explainer + Import Spotify® Data + Open Exportify.

**Responsive (§8):** 1024–1439px, panels stack vertically (Traktor first), toolbar wraps; coarse pointer gets 44px rows and always-visible checkboxes.

---

## 6. Component specifications

### 6.1 Data grid (shared by S2/S3/S5)

Borderless (no gridlines ever), striped, virtualized, 32px rows desktop / 44px touch. Uppercase 11px `--text-secondary` header row, sticky; sort indicator = small triangle, `--accent-blue` by default (as in `traktor-browse-list.png`) — in the **S3 Track–Playlist matrix** the sort triangle is `--accent-orange` (issue #7) so it stays visible on both the blue "sorted" and orange "filtered" column-header states. In the S3 matrix a column header also takes a full-header tint to flag its filter/sort state: **orange** when a per-column filter is engaged (matching the Filter button), **blue** when the column is sorted; orange wins when a column is both filtered and sorted, with the orange sort arrow still showing. Column resize by header-edge drag. Selection: single click selects row (`--bg-selected` full-row); Shift/Ctrl extend. Editable cells (S2 only) show no affordance at rest — affordance appears on focus (inset blue ring) and hover (subtle `--bg-row-hover`).

### 6.2 Buttons & controls (NI style)

From `traktor-mixer-section.png` / `traktor-fx-channel-1.png`: controls are compact, dark, labeled below/beside in uppercase 11px. Primary button: `--bg-panel` fill, 1px `--border-subtle`, text `--text-primary`; hover lightens fill; **primary action** variant fills `--accent-orange` with black text (used sparingly — one per view, e.g. "Read Collection & Remake Tables"). Toggles render as the NI badge pattern (cf. the orange "2" FX badge): inactive = dark chip with muted text, active = `--accent-orange` fill, black text.

### 6.3 Status chip

Pill, 24px tall, 11px uppercase text. Variants: success (green fill/dark text — matches SM2's "Completed" chip verbatim), danger, running (orange outline + spinner), neutral.

### 6.4 Track name cell + typeahead

In Track name entry offers typeahead against the loaded collection (matches on title/artist) as a **typing convenience only**. **Revised (Ry, 2026-07-06 final review): selecting a match inserts the name text — it does not bind the row to a collection track and does not populate BPM/Key** (set-row BPM/Key are always manual; collection metadata is used only on the matrix in build #1). No linked/unlinked distinction exists — all rows are plain text, exactly as in SM2. Free-text entry without a match is normal. `[TAG]` bracketed prefixes parse into chips (§5.2).

### 6.5 Cell formatting (RED / YELLOW / Box — decided by Ry 2026-07-06, replaces the vetoed typed-flag design)

SM2's manual formatting model carries forward as-is: simple, intuitive, no semantics. There are **no typed/semantic flags** anywhere in the app; what a shade or box *means* lives in the user's head or as plain text in FX & Mix Notes (SM2's column P, walkthrough §5.4).

Four toolbar controls (§6.2 button style), each acting on the current selection — a single cell, a rectangular range, or full rows:

| Control | Action |
|---|---|
| **RED** | Fills the selected cell(s) with a red shade derived from `--status-danger` |
| **YELLOW** | Fills the selected cell(s) with a yellow shade derived from `--status-warn` |
| **Box** | Draws a 2px border around the outer perimeter of the selection (calls out a row, range, or single cell — e.g. a key change at a specific cue) |
| **Clear** | Removes all shading and boxes from the selection in one click (SM2's Un-Box / undo-formatting role) |

Rules:

- Shades are cell-level fills tuned so cell text stays ≥4.5:1 contrast (§9) while still reading unmistakably as SM2's red/yellow highlights.
- Box border color: `--text-primary` (light on the dark theme), drawn as an overlay so it doesn't violate the "no gridlines" grid style (§5.2) — it's user annotation, not chrome.
- Applying RED/YELLOW over an existing shade replaces it; Box and shading are independent and can coexist on the same cells.
- Ctrl/Cmd+Z also undoes formatting actions like any other edit (§5.2 undo history).
- Formatting is presentational only: persisted with the set, but carries no data semantics and is not queryable.

The **I like** cell stays a free-form emoji cell with a quick-pick of the known vocabulary (⚠️ default, ✅, 🚀, 🥰, 👎 — the `load`-tab validation list; open set, per code reference §3.2).

### 6.6 Key badge

Renders the track key per the two global options in §3.5: **Key Display As** (flats `Gbm` / sharps `F#m` / Camelot `11A` / Open Key `4m`; default flats) and **Colorful Keys** (on → per-key color from the `load`-tab palette in §3.1; off → `--text-primary`). One canonical internal representation (flats) with display-layer formatting only. The other three notations are pure renames of the same key; color follows the key, not the notation.

**Canonical 24-key conversion table (do not derive at runtime from a formula — use this table):**

| Flats | Sharps | Camelot | Open Key | | Flats | Sharps | Camelot | Open Key |
|---|---|---|---|---|---|---|---|---|
| C | C | 8B | 1d | | Am | Am | 8A | 1m |
| Db | C# | 3B | 8d | | Bbm | A#m | 3A | 8m |
| D | D | 10B | 3d | | Bm | Bm | 10A | 3m |
| Eb | D# | 5B | 10d | | Cm | Cm | 5A | 10m |
| E | E | 12B | 5d | | Dbm | C#m | 12A | 5m |
| F | F | 7B | 12d | | Dm | Dm | 7A | 12m |
| Gb | F# | 2B | 7d | | Ebm | D#m | 2A | 7m |
| G | G | 9B | 2d | | Em | Em | 9A | 2m |
| Ab | G# | 4B | 9d | | Fm | Fm | 4A | 9m |
| A | A | 11B | 4d | | Gbm | F#m | 11A | 4m |
| Bb | A# | 6B | 11d | | Gm | Gm | 6A | 11m |
| B | B | 1B | 6d | | Abm | G#m | 1A | 6m |

(Camelot: majors = B ring, minors = A ring. Open Key: majors = d, minors = m; Open Key number = Camelot number − 7, wrapping 1–12 — but implement from the table, not the formula. The prototype's stage-4 `format_traktor_key()` already maps Open-Key-style codes to flats notation; this table is its display-side inverse.)

### 6.7 NL prompt bar — DEFERRED, not in build #1 (visual spec only — status + behavior in `planning/02-features/natural-language-prompt.md`)

**Do not implement in build #1** (Ry, 2026-07-06 — future update, to be specified later). Retained as a visual sketch for that update: docked full-width at top of S3. Single input, 40px, `--bg-input`, placeholder with the canonical example (*"tracks 128 BPM or greater in C minor, newest release first"* — walkthrough §8). Submitting renders the interpreted result as ordinary filter chips + sort state (§5.3) so the user sees exactly how the query was understood and can hand-edit it. Interpretation errors show inline below the bar, never as modals.

### 6.8 Export dialog (visual spec only — behavior in `planning/02-features/set-export.md`)

Opened from the S2 three-dot menu's **Export…** item or `Ctrl/Cmd+E` (revised 2026-07-06 — no standalone toolbar button). Compact dialog (popover-weight, not a full modal): format selector as three NI-style toggle chips (§6.2) — `CSV` / `XLSX` / `Markdown`, defaulting to the last format exported — an editable filename field pre-filled per the feature spec's naming convention, and a confirm button. Success surfaces as a toast; failures as inline errors within the dialog. Save-location prompting and memory (Chromium file picker with remembered directory, standard-download fallback elsewhere) are behavioral — see the feature spec §4.

---

## 7. States & feedback

### 7.1 Empty states

- New set: grid with one empty row; ghost text in In Track Name cell: "Type the first track of the set…" (data entry starts at In Track — walkthrough §5.1).
- Matrix before first pipeline run: centered explainer + the Read Collection primary action + Settings link.
- Compare with no Exportify CSVs: explainer of the Exportify flow (walkthrough §7.2) + "Import Spotify® Data" primary action + link to S8 (behavior: `planning/02-features/exportify-import.md` §3).

### 7.2 Pipeline run feedback

The Python pipeline stages (read collection → build matrix → compare → join) surface as a step progress list in a Home panel and a compact status chip elsewhere. On completion, chip flips to the green Completed state with timestamp; on failure, the failing stage and its error are disclosed inline. Never block the UI during a run.

### 7.3 Unsaved/sync state

Web app persists continuously (no Excel-style save). A subtle "All changes saved" / "Saving…" text indicator in the set editor toolbar. Undo history per set survives navigation within a session.

---

## 8. Responsive behavior

| Breakpoint | Behavior |
|---|---|
| ≥1440px (primary) | Full layout as specced |
| 1024–1439px | Sidebar auto-collapses to icon rail; S2 hides Start/Transition + A# behind a column-overflow menu; S1 stacks to one column |
| Coarse pointer (any width) | 44px rows, 44px min touch targets, drag handles always visible (no hover reveal), enum cells open as bottom sheets instead of dropdowns |
| <1024px | Out of scope for v1 — show a "best on a larger screen" notice rather than a broken layout |

Perform Mode is touch-first at every size (§5.4).

---

## 9. Accessibility

- Contrast: all text ≥ 4.5:1 against its background (the sampled `--text-secondary` on `--bg-row` passes; verify any tint washes keep cell text compliant). **Key colors:** several `load`-tab palette entries at the blue/violet end (e.g. `#0D21F2` Indigo, `#2B0DF2` Violet) will not reach 4.5:1 on `--bg-row` — lighten those at render time to the minimum lightness that passes, preserving hue. The palette table in §3.1 stays the canonical identity; the contrast-adjusted variants are derived, not hand-picked.
- Color is never the only signal for **system** states: presence chips have labels, key badges are text. Cell shading (§6.5) is user-applied annotation with no system semantics — no non-color equivalent is required, but shaded cells must keep text ≥4.5:1.
- Grid is fully keyboard operable (§5.2); `aria-rowcount`/virtualized-grid semantics; focus visible everywhere via the inset blue ring.
- Perform Mode honors `prefers-reduced-motion` (no animated row transitions).

---

## 10. Assets & open items

- Brand assets (2026-07-06): `docs/design/brand/` — `rml-mark.svg` (the RML sunset mark: gradient semicircle over inverted-triangle reflection; vector recreation of the RML-provided logos — an original vector, if added there, supersedes it) plus the original RML logo files. Header lockup = mark + "RML SetMaster" (white "RML" + light "SetMaster", cf. `01-launchpad-tab.png`) re-set in the web type stack — a redraw, never a bitmap copy. Placement restricted per §1.3.4.
- No Native Instruments®/Traktor® logos or extracted assets anywhere in shipped output (§1.3.1); the `docs/design/` screenshots are reference-only.
- Icons: single 16px stroke set (Lucide or equivalent), `--text-secondary` at rest; rocket icon reserved for Perform Mode.
- ~~Cover art in grids~~ — **cut from build #1** (Ry, 2026-07-06; no artwork source in `collection.nml`). If added later: 24px rounded-2px thumbs from embedded tag art, lazy-loaded, `--bg-input` placeholder.
- **Open items affecting this spec:** none as of the 2026-07-06 final Q&A — the row-flag model (§6.5), the zoom/ribbon drops and "Track X"/In Track label (§5.2), and the Exportify flow (S6/S8, governed by `planning/02-features/exportify-import.md`) are all resolved. History in `planning/04-open-questions.md`. Two non-blocking post-build-#1 follow-ups: zoom hotkeys (§5.2); **user profile / branding personalization** (optional Artist/DJ Name, logo upload, customizable palette re-skinning the app chrome — `00-overview.md` §6, added 2026-07-06; §3.1 tokens already make a palette swap cheap).
- ~~S8 visual spec is still to be written~~ — **done 2026-07-06: §5.8** (independent panels, checked-first ordering + search, single top toolbar, red-fill no-match / amber-text no-data emphasis — decisions confirmed with Ry in the pre-handoff review).
