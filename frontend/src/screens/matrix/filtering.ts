/**
 * S3 pure filter/sort engine — everything here is client-side over the
 * GET /api/matrix payload (spec §8: all filtering/sorting client-side,
 * interactive at tens of thousands of rows × 100+ playlist columns).
 *
 * `prepareMatrix` runs ONCE per payload and precomputes per-row derived
 * values (numeric dates, casefolded strings, membership sets) so that
 * `filterIndices` / `sortIndices` — which run on every filter edit and feed
 * the live drawer preview count — are cheap linear passes.
 */

import type { MatrixData, MatrixPlaylist, MatrixRow } from "../../lib/api";
import { formatKey, isCanonicalKey, KEY_TABLE, type KeyNotation } from "../../lib/keys";
import {
  isColumnFilterActive,
  isPlaylistCol,
  playlistPathOfCol,
  type ColumnFilter,
  type MatrixFilterState,
  type SortLevel,
} from "./filterState";
import { META_COLUMN_BY_ID } from "./columns";
import { parseSearch, type ParsedClause } from "./searchQuery";

// ---------------------------------------------------------------------------
// Dates. Pipeline emits Traktor-style "YYYY/M/D" strings ("" when unset).
// Display is M/D/YYYY raw (no leading zeros, issue #6), placeholders
// (1/1/YYYY) included (§11.12). These are MATRIX-SCOPED display helpers — the
// Set Editor keeps its own formatting (fmtBpmStat, fmtChipDateTime).
// ---------------------------------------------------------------------------

/** "YYYY/M/D" → sortable/comparable number YYYYMMDD; NaN when blank/invalid. */
export function parseSlashDate(s: string): number {
  if (!s) return NaN;
  const parts = s.split("/");
  if (parts.length !== 3) return NaN;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return y * 10000 + m * 100 + d;
}

/** "YYYY-MM-DD" (native date input) → the same YYYYMMDD number; NaN when blank. */
export function parseIsoDate(s: string | number | null | undefined): number {
  if (s == null || s === "") return NaN;
  if (typeof s === "number") return s;
  const parts = s.split("-");
  if (parts.length !== 3) return NaN;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return y * 10000 + m * 100 + d;
}

/** "YYYY/M/D" → "M/D/YYYY" (no leading zeros; raw dates incl. 1/1/YYYY placeholders, §11.12). */
export function fmtMatrixDate(s: string): string {
  const n = parseSlashDate(s);
  if (Number.isNaN(n)) return s; // blank (or malformed → show raw)
  const y = Math.floor(n / 10000);
  const m = Math.floor((n % 10000) / 100);
  const d = n % 100;
  return `${m}/${d}/${y}`;
}

/** BPM display: whole number, no decimals (issue #6); tabular-nums aligned. */
export function fmtBpm(bpm: number | null): string {
  return bpm == null ? "" : String(Math.round(bpm));
}

// ---------------------------------------------------------------------------
// Key ordering — Camelot-wheel order (number, then A ring before B ring) so
// the "Key" sort walks harmonically around the wheel. Unknown/free-text keys
// sort after the canonical 24, alphabetically.
// ---------------------------------------------------------------------------

const KEY_RANK: ReadonlyMap<string, number> = new Map(
  KEY_TABLE.map((r) => {
    const num = parseInt(r.camelot, 10);
    const ring = r.camelot.endsWith("A") ? 0 : 1;
    return [r.flats, num * 2 + ring] as const;
  }),
);

export function keySortRank(key: string | null): number {
  if (!key) return Infinity;
  return KEY_RANK.get(key) ?? 1000;
}

// ---------------------------------------------------------------------------
// Prepared (indexed) matrix
// ---------------------------------------------------------------------------

export interface PreparedRow {
  row: MatrixRow;
  importN: number;
  releaseN: number;
  releaseYear: number; // NaN when blank
  lastN: number;
  nameCf: string;
  artistCf: string;
  member: Set<number>; // playlist indices (into data.playlists)
}

export interface PreparedMatrix {
  rows: PreparedRow[];
  playlists: MatrixPlaylist[];
  /** Playlist indices in alphabetical display order (§11.11). */
  playlistOrder: number[];
  pathToIndex: Map<string, number>;
  bpmMin: number;
  bpmMax: number;
}

export function prepareMatrix(data: MatrixData): PreparedMatrix {
  const rows: PreparedRow[] = new Array(data.rows.length);
  let bpmMin = Infinity;
  let bpmMax = -Infinity;
  for (let i = 0; i < data.rows.length; i++) {
    const r = data.rows[i];
    if (r.bpm != null) {
      if (r.bpm < bpmMin) bpmMin = r.bpm;
      if (r.bpm > bpmMax) bpmMax = r.bpm;
    }
    const releaseN = parseSlashDate(r.release_date);
    rows[i] = {
      row: r,
      importN: parseSlashDate(r.import_date),
      releaseN,
      releaseYear: Number.isNaN(releaseN) ? NaN : Math.floor(releaseN / 10000),
      lastN: parseSlashDate(r.last_played),
      nameCf: r.name.toLowerCase(),
      artistCf: r.artist.toLowerCase(),
      member: new Set(r.m),
    };
  }
  const playlistOrder = data.playlists
    .map((_, i) => i)
    .sort((a, b) => {
      const cmp = data.playlists[a].name.localeCompare(
        data.playlists[b].name,
        undefined,
        { sensitivity: "base" },
      );
      return cmp !== 0 ? cmp : a - b;
    });
  const pathToIndex = new Map(data.playlists.map((p, i) => [p.path, i]));
  if (!Number.isFinite(bpmMin)) {
    bpmMin = 0;
    bpmMax = 200;
  }
  return {
    rows,
    playlists: data.playlists,
    playlistOrder,
    pathToIndex,
    bpmMin: Math.floor(bpmMin),
    bpmMax: Math.ceil(bpmMax),
  };
}

// ---------------------------------------------------------------------------
// Cell accessors. RAW value is notation-independent (dates "YYYY/M/D", keys
// canonical flats) and is what picklists store; DISPLAY text is what the user
// sees (dates MM/DD/YYYY, keys per Key Display As) and is what `contains`
// header filters match against.
// ---------------------------------------------------------------------------

export function cellRaw(p: PreparedRow, colId: string, prep: PreparedMatrix): string {
  if (isPlaylistCol(colId)) {
    const idx = prep.pathToIndex.get(playlistPathOfCol(colId));
    // Cell = the track name when the track is on that playlist, else blank
    // (non-blank ⇔ membership — faithful to the matrix CSV, §2).
    return idx !== undefined && p.member.has(idx) ? p.row.name : "";
  }
  const r = p.row;
  switch (colId) {
    case "import_date":
      return r.import_date;
    case "release_date":
      return r.release_date;
    case "last_played":
      return r.last_played;
    case "playcount":
      return String(r.playcount);
    case "bpm":
      return r.bpm == null ? "" : String(r.bpm);
    case "key":
      return r.key ?? "";
    case "album":
      return r.album;
    case "artist":
      return r.artist;
    case "name":
      return r.name;
    case "root":
      return String(r.root);
    case "nonroot":
      return String(r.nonroot);
    case "file_path":
      return r.file_path;
    default:
      return "";
  }
}

export function cellDisplay(
  p: PreparedRow,
  colId: string,
  prep: PreparedMatrix,
  notation: KeyNotation,
): string {
  if (isPlaylistCol(colId)) return cellRaw(p, colId, prep);
  const r = p.row;
  switch (colId) {
    case "import_date":
      return fmtMatrixDate(r.import_date);
    case "release_date":
      return fmtMatrixDate(r.release_date);
    case "last_played":
      return fmtMatrixDate(r.last_played);
    case "bpm":
      return fmtBpm(r.bpm);
    case "key":
      return r.key ? formatKey(r.key, notation) : "";
    default:
      return cellRaw(p, colId, prep);
  }
}

/** Format a RAW value (as stored in `picked`) for display, e.g. in picklists. */
export function rawToDisplay(raw: string, colId: string, notation: KeyNotation): string {
  const meta = META_COLUMN_BY_ID.get(colId);
  if (!meta) return raw; // playlist columns: raw text is the display text
  if (meta.kind === "date") return fmtMatrixDate(raw);
  if (meta.kind === "key") return raw && isCanonicalKey(raw) ? formatKey(raw, notation) : raw;
  return raw;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

type Predicate = (p: PreparedRow) => boolean;

function drawerPredicates(prep: PreparedMatrix, s: MatrixFilterState): Predicate[] {
  const d = s.drawer;
  const preds: Predicate[] = [];

  if (d.playlist.on && d.playlist.path) {
    const idx = prep.pathToIndex.get(d.playlist.path);
    preds.push(idx === undefined ? () => false : (p) => p.member.has(idx));
  }
  if (d.bpm.on && (d.bpm.min != null || d.bpm.max != null)) {
    const min = d.bpm.min;
    const max = d.bpm.max;
    preds.push((p) => {
      const b = p.row.bpm;
      if (b == null) return false;
      if (min != null && b < min) return false;
      if (max != null && b > max) return false;
      return true;
    });
  }
  if (d.keys.on) {
    const sel = new Set(d.keys.selected);
    // All 24 selected = "show all keys" — no constraint (matches unknown keys too).
    if (sel.size < 24) {
      preds.push((p) => p.row.key != null && sel.has(p.row.key));
    }
  }
  if (d.releaseYear.on && (d.releaseYear.min != null || d.releaseYear.max != null)) {
    const min = d.releaseYear.min;
    const max = d.releaseYear.max;
    preds.push((p) => {
      if (Number.isNaN(p.releaseYear)) return false;
      if (min != null && p.releaseYear < min) return false;
      if (max != null && p.releaseYear > max) return false;
      return true;
    });
  }
  if (d.importDate.on && (d.importDate.min !== "" || d.importDate.max !== "")) {
    const min = parseIsoDate(d.importDate.min);
    const max = parseIsoDate(d.importDate.max);
    preds.push((p) => {
      if (Number.isNaN(p.importN)) return false;
      if (!Number.isNaN(min) && p.importN < min) return false;
      if (!Number.isNaN(max) && p.importN > max) return false;
      return true;
    });
  }
  if (d.artistContains.on && d.artistContains.text.trim() !== "") {
    const needle = d.artistContains.text.trim().toLowerCase();
    preds.push((p) => p.artistCf.includes(needle));
  }
  if (d.trackContains.on && d.trackContains.text.trim() !== "") {
    const needle = d.trackContains.text.trim().toLowerCase();
    preds.push((p) => p.nameCf.includes(needle));
  }
  if (d.onRootPl.on && d.onRootPl.min != null) {
    const min = d.onRootPl.min;
    preds.push((p) => p.row.root >= min);
  }
  if (d.onNonRootPl.on && (d.onNonRootPl.min != null || d.onNonRootPl.max != null)) {
    const min = d.onNonRootPl.min;
    const max = d.onNonRootPl.max;
    preds.push((p) => {
      if (min != null && p.row.nonroot < min) return false;
      if (max != null && p.row.nonroot > max) return false;
      return true;
    });
  }
  return preds;
}

// The three text metadata columns the free-text search box scans (issue #15).
// #15 followup: only the VISIBLE subset is scanned — hiding a column via the
// Columns menu removes it from the free-text search (keyword clauses, which
// target their own columns, are unaffected). Callers pass the visible subset
// via the `searchCols` parameter; omitting it scans all three.
export const SEARCH_COLUMNS = ["artist", "album", "name"] as const;
export type SearchColumnId = (typeof SEARCH_COLUMNS)[number];

/** The free-text-searchable columns currently visible (not in layout.hidden). */
export function visibleSearchColumns(hidden: readonly string[]): SearchColumnId[] {
  return SEARCH_COLUMNS.filter((c) => !hidden.includes(c));
}

const SEARCH_COL_LABEL: Record<SearchColumnId, string> = {
  artist: "artist",
  album: "album",
  name: "track",
};

/**
 * Search-box placeholder naming exactly the columns being scanned (#15
 * followup) — "Search artist, album, or track…" down to "Search track…". With
 * NO text column visible the free text is inert, so the placeholder points at
 * the Columns menu while noting that keyword filters (#24) still work.
 */
export function searchPlaceholder(cols: readonly SearchColumnId[]): string {
  const labels = cols.map((c) => SEARCH_COL_LABEL[c]);
  if (labels.length === 0) {
    return "Edit Columns to enable text search — keyword filters (BPM=, Key=…) still work";
  }
  if (labels.length === 1) return `Search ${labels[0]}…`;
  if (labels.length === 2) return `Search ${labels[0]} or ${labels[1]}…`;
  return `Search ${labels[0]}, ${labels[1]}, or ${labels[2]}…`;
}

/** Contains-OR predicate over the visible text columns' display text (issue #15). */
function containsPredicate(
  prep: PreparedMatrix,
  needle: string,
  notation: KeyNotation,
  searchCols: readonly SearchColumnId[],
): Predicate {
  return (p) =>
    searchCols.some((col) =>
      cellDisplay(p, col, prep, notation).toLowerCase().includes(needle),
    );
}

/**
 * A parsed keyword clause (issue #24) → predicate, reusing the SAME comparison
 * primitives as the drawer/column filters so a clause filters IDENTICALLY to
 * the equivalent manual filter:
 *   • num  → `numericValue` min/max (with strict `<`/`>` via the exclusive flags);
 *   • keys → canonical-flats membership over the RAW key (same as a `picked` list);
 *   • date → `numericValue` vs ISO bounds (same as a date column min/max).
 * Rows with a blank/NaN value never pass (matches the column-filter engine).
 */
function clausePredicate(clause: ParsedClause): Predicate {
  const colId = clause.colId;
  if (clause.kind === "keys") {
    const set = new Set(clause.picked);
    return (p) => p.row.key != null && set.has(p.row.key);
  }
  if (clause.kind === "num") {
    const { min, max, minEx, maxEx } = clause;
    return (p) => {
      const v = numericValue(p, colId);
      if (Number.isNaN(v)) return false;
      if (min != null && (minEx ? v <= min : v < min)) return false;
      if (max != null && (maxEx ? v >= max : v > max)) return false;
      return true;
    };
  }
  // date
  const min = clause.min == null ? NaN : parseIsoDate(clause.min);
  const max = clause.max == null ? NaN : parseIsoDate(clause.max);
  return (p) => {
    const v = numericValue(p, colId);
    if (Number.isNaN(v)) return false;
    if (!Number.isNaN(min) && v < min) return false;
    if (!Number.isNaN(max) && v > max) return false;
    return true;
  };
}

/**
 * Search-box predicates (issues #15 + #24). The raw box string (`s.search`) is
 * the single source of truth; here it is parsed at FILTER TIME into a contains
 * needle plus structured clauses (both AND-ed with everything else). When the
 * box holds no recognized clause this reduces to exactly #15's contains-OR
 * search (the raw string is passed through untouched). Empty/whitespace-only →
 * no predicates. Relative-date clauses (`past N unit`) resolve against today
 * here and are never persisted. #15 followup: the contains needle scans only
 * `searchCols` (the visible text columns); with none visible the free text is
 * INERT (no predicate — all rows pass) while keyword clauses still apply.
 */
function searchPredicates(
  prep: PreparedMatrix,
  s: MatrixFilterState,
  notation: KeyNotation,
  searchCols: readonly SearchColumnId[],
): Predicate[] {
  const raw = s.search ?? "";
  if (raw.trim() === "") return [];
  const { contains, clauses } = parseSearch(raw);
  const preds: Predicate[] = [];
  const needle = contains.trim().toLowerCase();
  if (needle !== "" && searchCols.length > 0) {
    preds.push(containsPredicate(prep, needle, notation, searchCols));
  }
  for (const c of clauses) preds.push(clausePredicate(c));
  return preds;
}

/** Numeric value of a column for range filters/sorts; NaN = blank/unsortable. */
function numericValue(p: PreparedRow, colId: string): number {
  switch (colId) {
    case "import_date":
      return p.importN;
    case "release_date":
      return p.releaseN;
    case "last_played":
      return p.lastN;
    case "playcount":
      return p.row.playcount;
    case "bpm":
      return p.row.bpm == null ? NaN : p.row.bpm;
    case "root":
      return p.row.root;
    case "nonroot":
      return p.row.nonroot;
    default:
      return NaN;
  }
}

function columnPredicate(
  prep: PreparedMatrix,
  colId: string,
  f: ColumnFilter,
  notation: KeyNotation,
): Predicate | null {
  if (!isColumnFilterActive(f)) return null;
  const meta = META_COLUMN_BY_ID.get(colId);
  const isDate = meta?.kind === "date";
  const isNum = meta?.kind === "num";
  const preds: Predicate[] = [];

  if (f.blank !== undefined) {
    const wantBlank = f.blank === "blank";
    preds.push((p) => (cellRaw(p, colId, prep) === "") === wantBlank);
  }
  if (f.contains !== undefined && f.contains.trim() !== "") {
    const needle = f.contains.trim().toLowerCase();
    preds.push((p) => cellDisplay(p, colId, prep, notation).toLowerCase().includes(needle));
  }
  if (f.picked !== undefined && f.picked.length > 0) {
    const set = new Set(f.picked);
    preds.push((p) => set.has(cellRaw(p, colId, prep)));
  }
  const hasMin = f.min !== undefined && f.min !== null && f.min !== "";
  const hasMax = f.max !== undefined && f.max !== null && f.max !== "";
  if ((hasMin || hasMax) && (isDate || isNum)) {
    const min = hasMin ? (isDate ? parseIsoDate(f.min as string) : Number(f.min)) : NaN;
    const max = hasMax ? (isDate ? parseIsoDate(f.max as string) : Number(f.max)) : NaN;
    preds.push((p) => {
      const v = numericValue(p, colId);
      if (Number.isNaN(v)) return false;
      if (!Number.isNaN(min) && v < min) return false;
      if (!Number.isNaN(max) && v > max) return false;
      return true;
    });
  }
  if (preds.length === 0) return null;
  if (preds.length === 1) return preds[0];
  return (p) => preds.every((fn) => fn(p));
}

/** Row indices (into prep.rows) matching every active filter, in data order. */
export function filterIndices(
  prep: PreparedMatrix,
  s: MatrixFilterState,
  notation: KeyNotation,
  searchCols: readonly SearchColumnId[] = SEARCH_COLUMNS,
): number[] {
  const preds = drawerPredicates(prep, s);
  preds.push(...searchPredicates(prep, s, notation, searchCols));
  for (const [colId, f] of Object.entries(s.columns)) {
    const pred = columnPredicate(prep, colId, f, notation);
    if (pred) preds.push(pred);
  }
  const out: number[] = [];
  const rows = prep.rows;
  outer: for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    for (let k = 0; k < preds.length; k++) {
      if (!preds[k](p)) continue outer;
    }
    out.push(i);
  }
  return out;
}

/** Live preview match count (§5) — filter only, no sort. */
export function countMatches(prep: PreparedMatrix, s: MatrixFilterState, notation: KeyNotation): number {
  return filterIndices(prep, s, notation).length;
}

// ---------------------------------------------------------------------------
// Sorting — multi-level (§4), stable (index tiebreak). Blanks always last.
// ---------------------------------------------------------------------------

function compareLevel(prep: PreparedMatrix, a: PreparedRow, b: PreparedRow, level: SortLevel): number {
  const { col, dir } = level;
  const sign = dir === "desc" ? -1 : 1;
  const meta = META_COLUMN_BY_ID.get(col);

  if (col === "key") {
    const ra = keySortRank(a.row.key);
    const rb = keySortRank(b.row.key);
    // Blank keys last regardless of direction.
    if (ra === Infinity || rb === Infinity) {
      return ra === rb ? 0 : ra === Infinity ? 1 : -1;
    }
    if (ra !== rb) return (ra - rb) * sign;
    if (ra === 1000) {
      return (a.row.key as string).localeCompare(b.row.key as string) * sign;
    }
    return 0;
  }
  if (meta && (meta.kind === "num" || meta.kind === "date")) {
    const va = numericValue(a, col);
    const vb = numericValue(b, col);
    const na = Number.isNaN(va);
    const nb = Number.isNaN(vb);
    if (na || nb) return na === nb ? 0 : na ? 1 : -1; // blanks last
    return va === vb ? 0 : (va - vb) * sign;
  }
  // Text (meta text columns + playlist columns). Blanks last.
  const sa = col === "name" ? a.nameCf : col === "artist" ? a.artistCf : cellRaw(a, col, prep).toLowerCase();
  const sb = col === "name" ? b.nameCf : col === "artist" ? b.artistCf : cellRaw(b, col, prep).toLowerCase();
  if (sa === "" || sb === "") return sa === sb ? 0 : sa === "" ? 1 : -1;
  return sa < sb ? -sign : sa > sb ? sign : 0;
}

/** Sort row indices by the multi-level sort spec (stable). Returns a new array. */
export function sortIndices(
  prep: PreparedMatrix,
  indices: number[],
  sort: SortLevel[],
): number[] {
  if (sort.length === 0) return indices;
  const rows = prep.rows;
  return [...indices].sort((ia, ib) => {
    const a = rows[ia];
    const b = rows[ib];
    for (const level of sort) {
      const c = compareLevel(prep, a, b, level);
      if (c !== 0) return c;
    }
    return ia - ib; // stable
  });
}

/** Filter + sort in one call — the visible row set. */
export function applyFilterSort(
  prep: PreparedMatrix,
  s: MatrixFilterState,
  notation: KeyNotation,
  searchCols: readonly SearchColumnId[] = SEARCH_COLUMNS,
): number[] {
  return sortIndices(prep, filterIndices(prep, s, notation, searchCols), s.sort);
}

/** Distinct RAW cell values of a column (for header picklists), sorted for display. */
export function distinctRawValues(prep: PreparedMatrix, colId: string): string[] {
  const seen = new Set<string>();
  for (const p of prep.rows) {
    const v = cellRaw(p, colId, prep);
    if (v !== "") seen.add(v);
  }
  const meta = META_COLUMN_BY_ID.get(colId);
  const values = [...seen];
  if (meta?.kind === "date") {
    values.sort((a, b) => parseSlashDate(a) - parseSlashDate(b));
  } else if (meta?.kind === "num") {
    values.sort((a, b) => Number(a) - Number(b));
  } else if (meta?.kind === "key") {
    values.sort((a, b) => keySortRank(a) - keySortRank(b) || a.localeCompare(b));
  } else {
    values.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
  return values;
}
