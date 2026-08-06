/**
 * S3 unified filter/sort state — ONE serializable plain object shared by the
 * filter drawer (§5), the per-column header filters (§4) and the breadcrumb
 * (§6), per track-playlist-matrix.md §4 ("Unified filter model") and
 * CLAUDE.md ("Keep S3's unified filter/sort state a single serializable
 * object"). The deferred NL prompt bar will emit into this exact shape.
 *
 * JSON shape (everything is plain data — no Maps/Sets/Dates/functions):
 *
 * {
 *   "drawer": {                              // the 9 §5 drawer lines, in line order
 *     "playlist":       { "on": bool, "path": string },              // playlist_path ("" = none picked)
 *     "bpm":            { "on": bool, "min": num|null, "max": num|null },
 *     "keys":           { "on": bool, "selected": string[] },        // canonical flats keys ("Gm", …)
 *     "releaseYear":    { "on": bool, "min": num|null, "max": num|null },   // years (§11.4)
 *     "importDate":     { "on": bool, "min": string, "max": string },      // "YYYY-MM-DD" or ""
 *     "artistContains": { "on": bool, "text": string },
 *     "trackContains":  { "on": bool, "text": string },
 *     "onRootPl":       { "on": bool, "min": num|null },              // §11.3: min only
 *     "onNonRootPl":    { "on": bool, "min": num|null, "max": num|null }   // §11.3: min+max so "= 0" works
 *   },
 *   "columns": {                             // per-column header filters, keyed by column id
 *     "<colId>": {                           // meta ids ("bpm", "name", …) or playlist "pl:<playlist_path>"
 *       "contains"?: string,                 // text match on the DISPLAYED cell text (case-insensitive)
 *       "picked"?: string[],                 // picklist of RAW cell values (dates raw "YYYY/M/D", keys canonical)
 *       "min"?: num|string|null,             // numbers for numeric cols; "YYYY-MM-DD" for date cols
 *       "max"?: num|string|null,
 *       "blank"?: "blank"|"nonblank"         // §4: blank/non-blank on EVERY column incl. playlist columns
 *     }
 *   },
 *   "sort": [ { "col": "<colId>", "dir": "asc"|"desc" } ],  // multi-level, first = primary
 *   "search": string                        // free-text find box (issue #15): the
 *                                            // RAW box string, source of truth. A
 *                                            // single case-insensitive substring OR-ed
 *                                            // across artist/album/name display text.
 *                                            // #24 will layer a keyword parser on this
 *                                            // exact string. Session-only (NOT persisted).
 * }
 *
 * Toggled-off drawer lines RETAIN their values (spec §5 "Toggles") — hence
 * `on` flags instead of deleting values.
 */

export type SortDir = "asc" | "desc";

export interface SortLevel {
  col: string;
  dir: SortDir;
}

export interface ColumnFilter {
  contains?: string;
  picked?: string[];
  min?: number | string | null;
  max?: number | string | null;
  blank?: "blank" | "nonblank";
}

export interface DrawerLines {
  playlist: { on: boolean; path: string };
  bpm: { on: boolean; min: number | null; max: number | null };
  keys: { on: boolean; selected: string[] };
  releaseYear: { on: boolean; min: number | null; max: number | null };
  importDate: { on: boolean; min: string; max: string };
  artistContains: { on: boolean; text: string };
  trackContains: { on: boolean; text: string };
  onRootPl: { on: boolean; min: number | null };
  onNonRootPl: { on: boolean; min: number | null; max: number | null };
}

export interface MatrixFilterState {
  drawer: DrawerLines;
  columns: Record<string, ColumnFilter>;
  sort: SortLevel[];
  /**
   * Free-text search box (issue #15) — the RAW string the user typed, kept as
   * the single source of truth so #24 can layer a keyword parser on top of this
   * exact value without reshaping the state. The derived predicate (a single
   * case-insensitive substring OR-ed across Artist/Album/Track display text)
   * lives in filtering.ts. Empty string = no search. Session-only: NOT persisted
   * to localStorage, but part of the serializable `applied` object per CLAUDE.md.
   */
  search: string;
}

/** Playlist-column ids are "pl:" + playlist_path (paths are the identity key). */
export const PLAYLIST_COL_PREFIX = "pl:";

export const playlistColId = (path: string): string =>
  `${PLAYLIST_COL_PREFIX}${path}`;

export const isPlaylistCol = (colId: string): boolean =>
  colId.startsWith(PLAYLIST_COL_PREFIX);

export const playlistPathOfCol = (colId: string): string =>
  colId.slice(PLAYLIST_COL_PREFIX.length);

export function emptyDrawerLines(): DrawerLines {
  return {
    playlist: { on: false, path: "" },
    bpm: { on: false, min: null, max: null },
    keys: { on: false, selected: [] },
    releaseYear: { on: false, min: null, max: null },
    importDate: { on: false, min: "", max: "" },
    artistContains: { on: false, text: "" },
    trackContains: { on: false, text: "" },
    onRootPl: { on: false, min: null },
    onNonRootPl: { on: false, min: null, max: null },
  };
}

export function emptyFilterState(): MatrixFilterState {
  return { drawer: emptyDrawerLines(), columns: {}, sort: [], search: "" };
}

/** Deep clone via JSON round-trip — the state is serializable by contract. */
export function cloneFilterState(s: MatrixFilterState): MatrixFilterState {
  return JSON.parse(JSON.stringify(s)) as MatrixFilterState;
}

/** True when a drawer line is on AND carries values that constrain rows. */
export function isLineEffective(d: DrawerLines, line: keyof DrawerLines): boolean {
  const l = d[line];
  if (!l.on) return false;
  switch (line) {
    case "playlist":
      return d.playlist.path !== "";
    case "bpm":
      return d.bpm.min != null || d.bpm.max != null;
    case "keys":
      // An enabled key line always "counts" — even all-24 selected shows up
      // in the breadcrumb as "show me all keys" (§6 example sentence).
      return true;
    case "releaseYear":
      return d.releaseYear.min != null || d.releaseYear.max != null;
    case "importDate":
      return d.importDate.min !== "" || d.importDate.max !== "";
    case "artistContains":
      return d.artistContains.text.trim() !== "";
    case "trackContains":
      return d.trackContains.text.trim() !== "";
    case "onRootPl":
      return d.onRootPl.min != null;
    case "onNonRootPl":
      return d.onNonRootPl.min != null || d.onNonRootPl.max != null;
  }
}

export const DRAWER_LINE_ORDER: readonly (keyof DrawerLines)[] = [
  "playlist",
  "bpm",
  "keys",
  "releaseYear",
  "importDate",
  "artistContains",
  "trackContains",
  "onRootPl",
  "onNonRootPl",
] as const;

/** True when a column filter object actually constrains anything. */
export function isColumnFilterActive(f: ColumnFilter | undefined): boolean {
  if (!f) return false;
  return (
    (f.contains !== undefined && f.contains.trim() !== "") ||
    (f.picked !== undefined && f.picked.length > 0) ||
    (f.min !== undefined && f.min !== null && f.min !== "") ||
    (f.max !== undefined && f.max !== null && f.max !== "") ||
    f.blank !== undefined
  );
}

/**
 * Visual state of a column header (issue #7): a column can be filtered and/or
 * sorted. When both are active, ORANGE (filtered) WINS — the header takes the
 * filtered treatment while the orange sort arrow keeps showing direction; BLUE
 * (sorted) appears only on a column that is sorted but NOT filtered (Ry ruling,
 * 2026-07-07). Pure decision logic so it stays unit-testable.
 */
export type ColumnHeaderState = "filtered" | "sorted" | null;

export function columnHeaderState(
  s: MatrixFilterState,
  colId: string,
): ColumnHeaderState {
  if (isColumnFilterActive(s.columns[colId])) return "filtered";
  if (s.sort.some((l) => l.col === colId)) return "sorted";
  return null;
}

/**
 * Any filter active? (Sort alone does not count — the breadcrumb strip is
 * hidden when no FILTERS are active, §6.)
 */
export function hasActiveFilters(s: MatrixFilterState): boolean {
  // The free-text search box (issue #15) counts as an active filter so the
  // Clear-All affordance and the Filters badge stay honest.
  if (s.search.trim() !== "") return true;
  if (DRAWER_LINE_ORDER.some((line) => isLineEffective(s.drawer, line))) {
    return true;
  }
  return Object.values(s.columns).some(isColumnFilterActive);
}

/** Count of active filters (drawer lines + column filters) for the toolbar badge. */
export function activeFilterCount(s: MatrixFilterState): number {
  let n = 0;
  // The search box (issue #15) is one active filter when non-empty.
  if (s.search.trim() !== "") n++;
  for (const line of DRAWER_LINE_ORDER) {
    if (isLineEffective(s.drawer, line)) n++;
  }
  for (const f of Object.values(s.columns)) {
    if (isColumnFilterActive(f)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Drawer ↔ column-header filter sync (issue #8, ruling R1; extended by #60).
//
// The Filter drawer (§5) and the per-column header filters (§4) are ONE
// unified state. To keep a single source of truth per column, the clean 1:1
// drawer↔column pairs are MIRRORED: on Apply each mappable drawer line is
// projected into its header column filter, and the drawer line's own slot in
// `applied.drawer` is cleared — so a mirrored dimension lives in exactly ONE
// place (`applied.columns[colId]`) and is never AND-ed twice by the engine.
// `drawerFromApplied` back-fills the drawer from those columns on open, so the
// drawer always shows current reality (bidirectional coherence).
//
// Release Year (issue #60): the Release Date column header filter is now
// YEAR-granular, matching the drawer's Release Year line, so the pair is a
// clean 1:1 and is mirrored like the rest. The column filter stores the year
// bounds as ISO Jan-1 / Dec-31 date strings ("2019-01-01" / "2019-12-31") — the
// established trick (search #74) — so the date-column filter engine is
// untouched; the drawer line and the popover both express YEARS. This
// SUPERSEDES the old R1 carve-out that kept Release Year drawer-only.
//
// DRAWER-ONLY (deliberately NOT mirrored, ruling R1):
//   • One Playlist  — targets a membership predicate, not a single "pl:" column.
// ---------------------------------------------------------------------------

/** The drawer lines that mirror 1:1 to a header column (ruling R1; #60 adds releaseYear). */
export type MappableLine =
  | "bpm"
  | "keys"
  | "releaseYear"
  | "importDate"
  | "artistContains"
  | "trackContains"
  | "onRootPl"
  | "onNonRootPl";

/** Mappable drawer line → header column id (the mirrored pairs, R1 + #60). */
export const LINE_TO_COLUMN: Readonly<Record<MappableLine, string>> = {
  bpm: "bpm",
  keys: "key",
  releaseYear: "release_date",
  importDate: "import_date",
  artistContains: "artist",
  trackContains: "name",
  onRootPl: "root",
  onNonRootPl: "nonroot",
};

export const MAPPABLE_LINES = Object.keys(LINE_TO_COLUMN) as MappableLine[];

const COLUMN_TO_LINE: Readonly<Record<string, MappableLine>> = Object.fromEntries(
  Object.entries(LINE_TO_COLUMN).map(([line, col]) => [col, line]),
) as Record<string, MappableLine>;

/** Header column id a drawer line mirrors to (null = drawer-only line). */
export function columnIdForLine(line: keyof DrawerLines): string | null {
  return (LINE_TO_COLUMN as Record<string, string>)[line] ?? null;
}

/** Drawer line a header column mirrors to (null = not a mirrored column). */
export function lineForColumn(colId: string): MappableLine | null {
  return COLUMN_TO_LINE[colId] ?? null;
}

/**
 * The `ColumnFilter` fields each mappable drawer line OWNS. On Apply/Reset the
 * drawer overwrites (or clears) exactly these fields and preserves any other
 * header-only facets on the column (e.g. a `blank` gesture, or a `picked`
 * picklist on a text column) that the drawer cannot express.
 */
const LINE_OWNED_FIELDS: Readonly<Record<MappableLine, readonly (keyof ColumnFilter)[]>> = {
  bpm: ["min", "max"],
  keys: ["picked"],
  releaseYear: ["min", "max"],
  importDate: ["min", "max"],
  artistContains: ["contains"],
  trackContains: ["contains"],
  onRootPl: ["min"],
  onNonRootPl: ["min", "max"],
};

/**
 * Project one mappable drawer line into its header column filter, MERGING with
 * any header-only facets already on the column. Returns the merged filter, or
 * null when the column should carry no filter afterwards.
 *
 * Keys rule (R1): an all-24 selection (or, degenerately, a 0-key selection —
 * "show nothing" is not representable as a picklist and normalises to "no key
 * constraint") clears the key column; a 1–23 subset mirrors to `picked`.
 */
export function mirrorLineToColumn(
  line: MappableLine,
  d: DrawerLines,
  existing: ColumnFilter | undefined,
): ColumnFilter | null {
  const base: ColumnFilter = { ...(existing ?? {}) };
  for (const field of LINE_OWNED_FIELDS[line]) delete base[field];
  if (isLineEffective(d, line)) {
    switch (line) {
      case "bpm":
        if (d.bpm.min != null) base.min = d.bpm.min;
        if (d.bpm.max != null) base.max = d.bpm.max;
        break;
      case "keys": {
        const n = d.keys.selected.length;
        if (n > 0 && n < 24) base.picked = [...d.keys.selected];
        break;
      }
      case "releaseYear":
        // #60: express year bounds as ISO Jan-1 / Dec-31 so the date-column
        // filter engine (parseIsoDate vs. the full release date) is untouched.
        if (d.releaseYear.min != null) base.min = `${d.releaseYear.min}-01-01`;
        if (d.releaseYear.max != null) base.max = `${d.releaseYear.max}-12-31`;
        break;
      case "importDate":
        if (d.importDate.min !== "") base.min = d.importDate.min;
        if (d.importDate.max !== "") base.max = d.importDate.max;
        break;
      case "artistContains":
        base.contains = d.artistContains.text.trim();
        break;
      case "trackContains":
        base.contains = d.trackContains.text.trim();
        break;
      case "onRootPl":
        if (d.onRootPl.min != null) base.min = d.onRootPl.min;
        break;
      case "onNonRootPl":
        if (d.onNonRootPl.min != null) base.min = d.onNonRootPl.min;
        if (d.onNonRootPl.max != null) base.max = d.onNonRootPl.max;
        break;
    }
  }
  return isColumnFilterActive(base) ? base : null;
}

const colNum = (v: ColumnFilter["min"]): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const colStr = (v: ColumnFilter["min"]): string => (v == null ? "" : String(v));

/** ISO date string ("2019-06-15") → its year (2019); null when blank/invalid. */
const yearOfIso = (v: ColumnFilter["min"]): number | null => {
  if (v == null || v === "") return null;
  const y = Number(String(v).split("-")[0]);
  return Number.isFinite(y) ? y : null;
};

/**
 * Back-fill the drawer lines from the APPLIED state (issue #8 two-way sync) so
 * the drawer always reflects current reality on open. The only drawer-only line
 * (One Playlist) comes straight from `applied.drawer`; each mappable line —
 * including Release Year (#60), reconstructed from the year-only Release Date
 * column filter — is rebuilt from its header column filter's OWNED fields.
 */
export function drawerFromApplied(s: MatrixFilterState): DrawerLines {
  const d = emptyDrawerLines();
  d.playlist = { ...s.drawer.playlist };
  for (const line of MAPPABLE_LINES) {
    const f = s.columns[LINE_TO_COLUMN[line]];
    if (!f) continue;
    switch (line) {
      case "bpm": {
        const min = colNum(f.min);
        const max = colNum(f.max);
        if (min != null || max != null) d.bpm = { on: true, min, max };
        break;
      }
      case "keys":
        if (f.picked && f.picked.length > 0) d.keys = { on: true, selected: [...f.picked] };
        break;
      case "releaseYear": {
        // #60: the year-only Release Date column stores ISO Jan-1 / Dec-31
        // bounds; recover the plain years for the drawer's Release Year line.
        const min = yearOfIso(f.min);
        const max = yearOfIso(f.max);
        if (min != null || max != null) d.releaseYear = { on: true, min, max };
        break;
      }
      case "importDate": {
        const min = colStr(f.min);
        const max = colStr(f.max);
        if (min !== "" || max !== "") d.importDate = { on: true, min, max };
        break;
      }
      case "artistContains":
        if (f.contains && f.contains.trim() !== "")
          d.artistContains = { on: true, text: f.contains };
        break;
      case "trackContains":
        if (f.contains && f.contains.trim() !== "")
          d.trackContains = { on: true, text: f.contains };
        break;
      case "onRootPl": {
        const min = colNum(f.min);
        if (min != null) d.onRootPl = { on: true, min };
        break;
      }
      case "onNonRootPl": {
        const min = colNum(f.min);
        const max = colNum(f.max);
        if (min != null || max != null) d.onNonRootPl = { on: true, min, max };
        break;
      }
    }
  }
  return d;
}

/**
 * For the drawer's live preview ONLY: `applied.columns` with each mappable
 * line's OWNED fields removed, because the draft drawer line re-supplies them.
 * This is what guarantees a mirrored dimension is never AND-ed twice in the
 * preview count (the single-source-of-truth invariant, issue #8). Header-only
 * facets and non-mirrored columns pass through untouched.
 */
export function columnsWithoutMirroredLines(
  columns: Record<string, ColumnFilter>,
): Record<string, ColumnFilter> {
  const out: Record<string, ColumnFilter> = {};
  for (const [colId, f] of Object.entries(columns)) {
    const line = lineForColumn(colId);
    if (!line) {
      out[colId] = f;
      continue;
    }
    const stripped: ColumnFilter = { ...f };
    for (const field of LINE_OWNED_FIELDS[line]) delete stripped[field];
    if (isColumnFilterActive(stripped)) out[colId] = stripped;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quick sort (§5 bottom of drawer): single-choice, applied with Apply.
// ---------------------------------------------------------------------------

export interface QuickSort {
  id: string;
  label: string;
  sort: SortLevel[];
}

/** Options, default first (§5): BPM · Release Date Newest First · Import Date Newest First · Track Name · Key. */
export const QUICK_SORTS: readonly QuickSort[] = [
  { id: "bpm", label: "BPM", sort: [{ col: "bpm", dir: "asc" }] },
  { id: "release", label: "Release Date Newest", sort: [{ col: "release_date", dir: "desc" }] },
  { id: "import", label: "Import Date Newest", sort: [{ col: "import_date", dir: "desc" }] },
  { id: "name", label: "Track Name", sort: [{ col: "name", dir: "asc" }] },
  { id: "key", label: "Key", sort: [{ col: "key", dir: "asc" }] },
] as const;

/** Which quick-sort option (if any) the current sort state corresponds to. */
export function quickSortIdOf(sort: SortLevel[]): string | null {
  for (const q of QUICK_SORTS) {
    if (
      sort.length === q.sort.length &&
      sort.every((l, i) => l.col === q.sort[i].col && l.dir === q.sort[i].dir)
    ) {
      return q.id;
    }
  }
  return null;
}
