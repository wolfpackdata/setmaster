/**
 * S3 "Export Matrix" (issue #14) — one-click CSV of the CURRENT filtered &
 * sorted view. Everything here is pure and serializes from the in-memory
 * `applyFilterSort` output — NEVER the DOM or the virtualized window, so all
 * matching rows are written (not just the ~visible ones).
 *
 * Columns are a STABLE METADATA SCHEMA (issue #65, superseding #14's
 * visible-columns clause; tail rule revised by Ry 2026-07-08): the CSVs feed
 * downstream systems, so the metadata schema must not vary with grid
 * presentation preferences:
 *   • columns  = fixed prefix: all 12 metadata columns in canonical
 *                META_COLUMNS spec order, ignoring column show/hide and
 *                reorder (File Path included — it is the only
 *                filesystem-stable join key and is hidden on screen by
 *                default); then dynamic tail: the playlist columns currently
 *                SHOWN via the My Playlists selector (#13), alphabetical
 *                (prep.playlistOrder). All playlists hidden → prefix only.
 *                Consumers may rely on prefix POSITIONS but must key playlist
 *                columns by header name.
 *   • headers  = the grid DISPLAY labels (post-#11 "On Super Playlist" /
 *                "On Non-Super Playlist"; playlist name for playlist columns).
 *   • cells    = `cellDisplay` (so #6's M/D/YYYY dates + whole-number BPM +
 *                notation-formatted keys match the grid exactly; playlist cell
 *                = track name where on-playlist, blank otherwise).
 *
 * Output is UTF-8 with BOM (utf-8-sig, the repo's Excel-compat convention,
 * CLAUDE.md) and RFC 4180 quoted (fields with comma/quote/CR/LF are quoted,
 * embedded quotes doubled; CRLF record terminators).
 */

import { formatKey, type KeyNotation } from "../../lib/keys";
import { META_COLUMN_BY_ID, META_COLUMNS } from "./columns";
import { cellDisplay, fmtMatrixDate, type PreparedMatrix } from "./filtering";
import {
  columnsWithoutMirroredLines,
  drawerFromApplied,
  DRAWER_LINE_ORDER,
  isLineEffective,
  isPlaylistCol,
  playlistColId,
  playlistPathOfCol,
  type ColumnFilter,
  type DrawerLines,
  type MatrixFilterState,
} from "./filterState";

// ---------------------------------------------------------------------------
// RFC 4180 CSV serialization
// ---------------------------------------------------------------------------

/** BOM so Excel opens the UTF-8 file with the right encoding (utf-8-sig). */
export const CSV_BOM = "﻿";

const CSV_LINE_END = "\r\n";
/** Fields containing a comma, double-quote, CR or LF must be quoted (RFC 4180). */
const NEEDS_QUOTING = /[",\r\n]/;

/** RFC 4180 field: quote when needed; double embedded quotes. */
export function escapeCsvField(value: string): string {
  return NEEDS_QUOTING.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/**
 * Serialize a header row + data rows to an RFC 4180 CSV string, BOM-prefixed,
 * CRLF-terminated (every record, including the last). A header-only call (no
 * data rows) yields just the header line — the 0-row export contract (§edge).
 */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(escapeCsvField).join(","));
  return CSV_BOM + lines.join(CSV_LINE_END) + CSV_LINE_END;
}

// ---------------------------------------------------------------------------
// Columns — the stable export schema (issue #65): fixed metadata prefix,
// independent of column show/hide + reorder, then the SHOWN playlist columns
// ---------------------------------------------------------------------------

export interface ExportColumn {
  id: string;
  label: string;
}

/**
 * ALL 12 metadata columns in canonical META_COLUMNS spec order, then the
 * playlist columns currently SHOWN via My Playlists (#13), alphabetically
 * (prep.playlistOrder). The prefix is deliberately blind to `layout`
 * (show/hide + reorder) — a grid presentation preference, while the metadata
 * schema is a machine-facing contract (#65) identical across every export. In
 * particular File Path (hidden on screen by default) is always present: it is
 * the only filesystem-stable join key for downstream systems. The playlist
 * tail HONORS the hidden set (#65 tail rule, revised by Ry 2026-07-08): with
 * every playlist hidden, the export is the metadata prefix only.
 */
export function exportColumns(
  prep: PreparedMatrix,
  hiddenPlaylists: ReadonlySet<string>,
): ExportColumn[] {
  const meta: ExportColumn[] = META_COLUMNS.map((c) => ({
    id: c.id,
    label: c.label,
  }));
  const pl: ExportColumn[] = prep.playlistOrder
    .filter((i) => !hiddenPlaylists.has(prep.playlists[i].path))
    .map((i) => ({
      id: playlistColId(prep.playlists[i].path),
      label: prep.playlists[i].name,
    }));
  return [...meta, ...pl];
}

/**
 * Build the full CSV string for the given visible (filtered + sorted) row
 * indices and columns. Cell text comes from `cellDisplay` so formatting matches
 * the grid one-for-one. `visible` is the `applyFilterSort` output — pass it
 * straight through so row order = current sort order and count = all matches.
 */
export function buildMatrixCsv(
  prep: PreparedMatrix,
  visible: readonly number[],
  columns: readonly ExportColumn[],
  notation: KeyNotation,
): string {
  const header = columns.map((c) => c.label);
  const rows = visible.map((idx) => {
    const p = prep.rows[idx];
    return columns.map((c) => cellDisplay(p, c.id, prep, notation));
  });
  return toCsv(header, rows);
}

// ---------------------------------------------------------------------------
// Filename — deterministic, self-documenting, filename-safe
// ---------------------------------------------------------------------------

export interface MatrixExportContext {
  /** playlist_path → display name (falls back to the path). */
  playlistName: (path: string) => string;
  notation: KeyNotation;
}

const FILENAME_BASE = "SetMaster Track-Playlist Matrix Export -- ";
const FILENAME_EXT = ".csv";
/** Total filename length cap (includes the extension). */
const FILENAME_MAX = 200;
/** Suffix when no filters are engaged (ruling R4). */
const NO_FILTER_SUFFIX = "Full View";
/** Marker appended when the token list is truncated to fit the cap. */
const TRUNCATE_MARK = " …";

/** Characters illegal in Windows/macOS filenames, plus control chars. */
// eslint-disable-next-line no-control-regex
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Make a dynamic value filename-safe: drop illegal chars, collapse whitespace. */
export function sanitizeFilenameValue(value: string): string {
  return value.replace(ILLEGAL_FILENAME_CHARS, " ").replace(/\s+/g, " ").trim();
}

function numRangeToken(label: string, min: number | null, max: number | null): string | null {
  if (min != null && max != null) return `${label} ${min}-${max}`;
  if (min != null) return `${label} ge ${min}`;
  if (max != null) return `${label} le ${max}`;
  return null;
}

function dateRangeToken(label: string, min: string, max: string): string | null {
  const lo = min !== "" ? min : null;
  const hi = max !== "" ? max : null;
  if (lo && hi) return `${label} ${lo}..${hi}`;
  if (lo) return `${label} ge ${lo}`;
  if (hi) return `${label} le ${hi}`;
  return null;
}

/**
 * Drawer-derived tokens in DRAWER_LINE_ORDER (lines 1-9). `drawerFromApplied`
 * reconstructs the drawer view of the unified state, so the mappable lines
 * (BPM, Keys, Release Year, Import, Artist, Track, Super, Non-Super — issues #8
 * and #60 mirror them into `applied.columns`) surface here with their drawer
 * wording (Release Year's year bounds recovered from the year-only release_date
 * column), while One Playlist comes straight from `applied.drawer`. Super /
 * NonSuper wording per #11 (display-only; ids stay root/nonroot).
 */
function drawerTokens(d: DrawerLines, ctx: MatrixExportContext): string[] {
  const tokens: string[] = [];
  const push = (t: string | null) => {
    if (t) tokens.push(t);
  };
  for (const line of DRAWER_LINE_ORDER) {
    if (!isLineEffective(d, line)) continue;
    switch (line) {
      case "playlist":
        push(`PL ${sanitizeFilenameValue(ctx.playlistName(d.playlist.path))}`);
        break;
      case "bpm":
        push(numRangeToken("BPM", d.bpm.min, d.bpm.max));
        break;
      case "keys": {
        const names = d.keys.selected.map((k) => formatKey(k, ctx.notation));
        push(
          names.length <= 3
            ? `Keys ${sanitizeFilenameValue(names.join(","))}`
            : `Keys x${names.length}`,
        );
        break;
      }
      case "releaseYear":
        push(numRangeToken("Rel", d.releaseYear.min, d.releaseYear.max));
        break;
      case "importDate":
        push(dateRangeToken("Imp", d.importDate.min, d.importDate.max));
        break;
      case "artistContains":
        push(`Artist ~${sanitizeFilenameValue(d.artistContains.text.trim())}`);
        break;
      case "trackContains":
        push(`Track ~${sanitizeFilenameValue(d.trackContains.text.trim())}`);
        break;
      case "onRootPl":
        if (d.onRootPl.min != null) push(`Super ge ${d.onRootPl.min}`);
        break;
      case "onNonRootPl": {
        const { min, max } = d.onNonRootPl;
        if (min != null && max != null && min === max) push(`NonSuper ${min}`);
        else push(numRangeToken("NonSuper", min, max));
        break;
      }
    }
  }
  return tokens;
}

/**
 * Per-column header-filter tokens for facets NOT owned by a drawer line
 * (`columnsWithoutMirroredLines` strips the mirrored fields so a mirrored
 * dimension is never double-counted). Deterministic order: metadata columns in
 * spec order, then playlist columns alphabetically by name.
 */
function columnTokens(
  columns: Record<string, ColumnFilter>,
  ctx: MatrixExportContext,
): string[] {
  const remaining = columnsWithoutMirroredLines(columns);
  const ids = Object.keys(remaining);
  const metaIds = META_COLUMNS.map((c) => c.id).filter((id) => ids.includes(id));
  const plIds = ids
    .filter(isPlaylistCol)
    .sort((a, b) =>
      ctx
        .playlistName(playlistPathOfCol(a))
        .localeCompare(ctx.playlistName(playlistPathOfCol(b)), undefined, {
          sensitivity: "base",
        }),
    );
  const tokens: string[] = [];
  const push = (t: string | null) => {
    if (t) tokens.push(t);
  };
  for (const id of [...metaIds, ...plIds]) {
    const f = remaining[id];
    const meta = META_COLUMN_BY_ID.get(id);
    const label = sanitizeFilenameValue(
      isPlaylistCol(id) ? ctx.playlistName(playlistPathOfCol(id)) : (meta?.label ?? id),
    );
    if (f.blank !== undefined) {
      push(`${label} ${f.blank === "blank" ? "blank" : "non-blank"}`);
    }
    if (f.contains !== undefined && f.contains.trim() !== "") {
      push(`${label} ~${sanitizeFilenameValue(f.contains.trim())}`);
    }
    if (f.picked !== undefined && f.picked.length > 0) {
      const vals = f.picked.map((v) =>
        meta?.kind === "date"
          ? fmtMatrixDate(v)
          : meta?.kind === "key"
            ? formatKey(v, ctx.notation)
            : v,
      );
      push(
        vals.length <= 3
          ? `${label} ${sanitizeFilenameValue(vals.join(","))}`
          : `${label} x${vals.length}`,
      );
    }
    const hasMin = f.min !== undefined && f.min !== null && f.min !== "";
    const hasMax = f.max !== undefined && f.max !== null && f.max !== "";
    if (hasMin || hasMax) {
      if (meta?.kind === "date") {
        push(dateRangeToken(label, hasMin ? String(f.min) : "", hasMax ? String(f.max) : ""));
      } else {
        push(numRangeToken(label, hasMin ? Number(f.min) : null, hasMax ? Number(f.max) : null));
      }
    }
  }
  return tokens;
}

/**
 * The ordered, filename-safe token list for the current filter state:
 * Search first, then drawer lines 1-9, then per-column header facets. Exported
 * for unit tests / debugging; `buildExportFilename` joins + caps them.
 */
export function exportFilterTokens(
  applied: MatrixFilterState,
  ctx: MatrixExportContext,
): string[] {
  const tokens: string[] = [];
  if (applied.search.trim() !== "") {
    tokens.push(`Search ~${sanitizeFilenameValue(applied.search.trim())}`);
  }
  tokens.push(...drawerTokens(drawerFromApplied(applied), ctx));
  tokens.push(...columnTokens(applied.columns, ctx));
  return tokens;
}

/**
 * `SetMaster Track-Playlist Matrix Export -- <suffix>.csv`. Suffix = the
 * engaged-filter tokens joined with ", " (Search → drawer lines → per-column),
 * or `Full View` when none are engaged (R4). Total length capped at
 * FILENAME_MAX: tokens are appended while they fit and a "…" marker is added
 * when any are dropped, so the name is always valid.
 */
export function buildExportFilename(
  applied: MatrixFilterState,
  ctx: MatrixExportContext,
): string {
  const tokens = exportFilterTokens(applied, ctx);
  const budget = FILENAME_MAX - FILENAME_EXT.length;

  let suffix: string;
  if (tokens.length === 0) {
    suffix = NO_FILTER_SUFFIX;
  } else {
    suffix = "";
    let truncated = false;
    for (const tok of tokens) {
      const cand = suffix === "" ? tok : `${suffix}, ${tok}`;
      if ((FILENAME_BASE + cand).length <= budget) suffix = cand;
      else {
        truncated = true;
        break;
      }
    }
    if (truncated) {
      while (suffix !== "" && (FILENAME_BASE + suffix + TRUNCATE_MARK).length > budget) {
        const i = suffix.lastIndexOf(", ");
        suffix = i >= 0 ? suffix.slice(0, i) : "";
      }
      suffix = suffix === "" ? "…" : suffix + TRUNCATE_MARK;
    }
  }
  return FILENAME_BASE + suffix + FILENAME_EXT;
}

// ---------------------------------------------------------------------------
// One-click download (browser anchor + object-URL, ExportDialog pattern)
// ---------------------------------------------------------------------------

function triggerCsvDownload(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportMatrixParams {
  prep: PreparedMatrix;
  /** `applyFilterSort` output — filtered + sorted row indices into prep.rows. */
  visible: readonly number[];
  applied: MatrixFilterState;
  /** My Playlists hidden set (#13) — the playlist tail honors it (#65). */
  hiddenPlaylists: ReadonlySet<string>;
  notation: KeyNotation;
  playlistName: (path: string) => string;
}

/**
 * Build the CSV + filename for the current view and trigger the browser
 * download. Returns the filename and row count so the caller can toast
 * (0 rows → header-only CSV + "0 tracks matched", §edge).
 */
export function exportMatrix(params: ExportMatrixParams): {
  filename: string;
  rowCount: number;
} {
  const columns = exportColumns(params.prep, params.hiddenPlaylists);
  const csv = buildMatrixCsv(params.prep, params.visible, columns, params.notation);
  const filename = buildExportFilename(params.applied, {
    playlistName: params.playlistName,
    notation: params.notation,
  });
  triggerCsvDownload(csv, filename);
  return { filename, rowCount: params.visible.length };
}
