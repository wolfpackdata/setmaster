/**
 * S5 Playlist Compare Tool — pure view logic (comparison-output-table.md).
 * Kept free of React/DOM so vitest (node env) covers it directly:
 * flag label/color mapping, AND-combined filters, sorting, blank-cell note
 * states (gold/noted/clear), summary-line composition, staleness text.
 */

import type {
  ComparisonResultRow,
  NoteSide,
  NotesSummary,
  PresenceFlag,
} from "../../lib/api";

// ---------------------------------------------------------------------------
// Flag chips (§4 + 03-ui-design.md §5.5)
// ---------------------------------------------------------------------------

export interface FlagMeta {
  /** Friendly label (decided by Ry 2026-07-06; ® per §1.3 on rendered copy). */
  label: string;
  /** Chip color token (§5.5). */
  color: string;
  /** Gap flags are the reason the page exists — render loudest (§4). */
  prominent: boolean;
}

export const FLAG_META: Record<PresenceFlag, FlagMeta> = {
  "Yes-Trak-Playlist": {
    label: "Match",
    color: "var(--text-muted)",
    prominent: false,
  },
  "Not-Trak-Collection": {
    label: "Go get",
    color: "var(--status-success)",
    prominent: true,
  },
  "Not-Trak-Playlist / Yes-Trak-Collection": {
    label: "Organize",
    color: "var(--accent-orange)",
    prominent: true,
  },
  "Not-Spotify / Yes-Trak-Playlist": {
    label: "Traktor® only",
    color: "var(--text-secondary)",
    prominent: false,
  },
};

/** All four flags, alphabetical by display label (§7 flag-sort order). */
export const FLAGS_BY_LABEL: PresenceFlag[] = (
  Object.keys(FLAG_META) as PresenceFlag[]
).sort((a, b) => FLAG_META[a].label.localeCompare(FLAG_META[b].label));

/** Display label for a flag; unknown enum values render raw (fail visible). */
export function flagLabel(flag: string): string {
  return (FLAG_META as Record<string, FlagMeta>)[flag]?.label ?? flag;
}

// ---------------------------------------------------------------------------
// Blank-cell notes (§5)
// ---------------------------------------------------------------------------

/**
 * Cell shading state for the two track-name columns:
 *  - "filled": real track name — never editable, never shaded
 *  - "gold":   blank Traktor cell, no note (the gap draws the eye)
 *  - "noted":  blank cell carrying a user note (either column) — no fill;
 *              inherits the row/stripe background, note text renders orange
 *  - "clear":  blank Spotify cell, no note (quiet by design)
 */
export type NoteCellState = "filled" | "gold" | "noted" | "clear";

export function noteCellState(
  row: ComparisonResultRow,
  side: NoteSide,
): NoteCellState {
  const blank =
    side === "traktor" ? !row.traktor_title : !row.spotify_track_name;
  if (!blank) return "filled";
  if (row.note !== null && row.note.side === side) return "noted";
  return side === "traktor" ? "gold" : "clear";
}

/**
 * A note is keyed on the populated side's join key (§5.2): note in the
 * Traktor column → the row's spotify_trackjoin; note in the Spotify column →
 * trak_trackjoin.
 */
export function noteJoinKey(row: ComparisonResultRow, side: NoteSide): string {
  return side === "traktor" ? row.spotify_trackjoin : row.trak_trackjoin;
}

/** Only blank cells with a stable join key accept notes. */
export function isNoteEditable(
  row: ComparisonResultRow,
  side: NoteSide,
): boolean {
  return noteCellState(row, side) !== "filled" && noteJoinKey(row, side) !== "";
}

// ---------------------------------------------------------------------------
// Filters (§8) — AND-combined, client-side view state
// ---------------------------------------------------------------------------

export interface CompareFilters {
  /** Flag multi-select; empty = no flag filtering. */
  flags: PresenceFlag[];
  /** Only rows with a user-noted blank cell. */
  notedOnly: boolean;
  /** One-click "Hide matched tracks" (hides Yes-Trak-Playlist). */
  hideMatched: boolean;
}

export const EMPTY_FILTERS: CompareFilters = {
  flags: [],
  notedOnly: false,
  hideMatched: false,
};

export function filtersActive(f: CompareFilters): boolean {
  return f.flags.length > 0 || f.notedOnly || f.hideMatched;
}

export function applyFilters(
  rows: ComparisonResultRow[],
  f: CompareFilters,
): ComparisonResultRow[] {
  return rows.filter(
    (r) =>
      (f.flags.length === 0 || f.flags.includes(r.flag)) &&
      (!f.notedOnly || r.note !== null) &&
      (!f.hideMatched || r.flag !== "Yes-Trak-Playlist"),
  );
}

export function toggleFlagFilter(
  f: CompareFilters,
  flag: PresenceFlag,
): CompareFilters {
  return f.flags.includes(flag)
    ? { ...f, flags: f.flags.filter((x) => x !== flag) }
    : { ...f, flags: [...f.flags, flag] };
}

// ---------------------------------------------------------------------------
// Columns (issue #20) — the ordered column set, visibility state, persistence
// ---------------------------------------------------------------------------

/**
 * Every column the S5 table can render, in display order (issue #20): the
 * artist/album columns sit adjacent to their source's track column. The id
 * doubles as the sort key (SortColumn) and the visibility key.
 *
 * NON-HIDEABLE (always shown, per Ry): flag, traktorTrack, spotifyTrack.
 * HIDEABLE: the four artist/album columns (default OFF) plus file/link
 * (default ON) — the current default view stays flag · track · track · file
 * · link.
 */
export type CompareColumnId =
  | "flag"
  | "traktorTrack"
  | "traktorArtist"
  | "traktorAlbum"
  | "spotifyTrack"
  | "spotifyArtist"
  | "spotifyAlbum"
  | "file"
  | "link";

export interface CompareColumn {
  id: CompareColumnId;
  /** Rendered header + menu label — ® per 03-ui-design.md §1.3. */
  label: string;
  /** Non-hideable columns (flag + the two track columns) can never be hidden. */
  hideable: boolean;
  /** Whether the column shows by default (the four new cols default OFF). */
  defaultVisible: boolean;
  /**
   * Fixed pixel width for the narrow, non-text columns (flag/file/link).
   * Text columns (track/artist/album) get no fixed width — they share the
   * remaining table width equally under `table-layout: fixed` (see §width
   * strategy in comparison-output-table.md).
   */
  width?: number;
}

export const COMPARE_COLUMNS: CompareColumn[] = [
  { id: "flag", label: "Flag", hideable: false, defaultVisible: true, width: 110 },
  { id: "traktorTrack", label: "Traktor® Track", hideable: false, defaultVisible: true },
  { id: "traktorArtist", label: "Traktor® Artist", hideable: true, defaultVisible: false },
  { id: "traktorAlbum", label: "Traktor® Album", hideable: true, defaultVisible: false },
  { id: "spotifyTrack", label: "Spotify® Track", hideable: false, defaultVisible: true },
  { id: "spotifyArtist", label: "Spotify® Artist", hideable: true, defaultVisible: false },
  { id: "spotifyAlbum", label: "Spotify® Album", hideable: true, defaultVisible: false },
  { id: "file", label: "Local File", hideable: true, defaultVisible: true, width: 130 },
  { id: "link", label: "Spotify® Link", hideable: true, defaultVisible: true, width: 110 },
];

export type ColumnVisibility = Record<CompareColumnId, boolean>;

/** localStorage key — shared across ALL compare playlists (ruling R5). */
export const COLUMN_VISIBILITY_KEY = "sm3.compare.columns.v1";

export function defaultColumnVisibility(): ColumnVisibility {
  return COMPARE_COLUMNS.reduce((acc, c) => {
    acc[c.id] = c.defaultVisible;
    return acc;
  }, {} as ColumnVisibility);
}

/**
 * Enforce the non-hideable invariant: flag + the two track columns are always
 * visible regardless of what a caller (or stale localStorage) says.
 */
function withNonHideableForcedOn(v: ColumnVisibility): ColumnVisibility {
  const out = { ...v };
  for (const c of COMPARE_COLUMNS) {
    if (!c.hideable) out[c.id] = true;
  }
  return out;
}

export function loadColumnVisibility(): ColumnVisibility {
  const base = defaultColumnVisibility();
  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    for (const c of COMPARE_COLUMNS) {
      const val = parsed[c.id];
      if (typeof val === "boolean") base[c.id] = val;
    }
  } catch {
    /* storage unavailable or malformed — fall back to defaults */
  }
  return withNonHideableForcedOn(base);
}

export function saveColumnVisibility(v: ColumnVisibility): void {
  try {
    localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Toggle a column's visibility. Non-hideable columns are refused (returned
 * unchanged) — the menu also disables them, but this is the hard guard.
 */
export function setColumnVisible(
  v: ColumnVisibility,
  id: CompareColumnId,
  visible: boolean,
): ColumnVisibility {
  const col = COMPARE_COLUMNS.find((c) => c.id === id);
  if (!col || !col.hideable) return v; // enforce non-hideable
  return { ...v, [id]: visible };
}

/** The columns to render, in order, given the current visibility state. */
export function visibleColumns(v: ColumnVisibility): CompareColumn[] {
  return COMPARE_COLUMNS.filter((c) => v[c.id]);
}

// ---------------------------------------------------------------------------
// Sorting (§7) — every column sortable; default = pipeline track_collate order
// ---------------------------------------------------------------------------

/** Sort key === column id (issue #20). */
export type SortColumn = CompareColumnId;

export interface SortState {
  column: SortColumn;
  dir: "asc" | "desc";
}

function sortValue(row: ComparisonResultRow, col: SortColumn): string {
  switch (col) {
    case "flag":
      return flagLabel(row.flag); // alphabetical by display label (decided)
    case "traktorTrack":
      return row.traktor_title;
    case "traktorArtist":
      return row.traktor_artists;
    case "traktorAlbum":
      return row.traktor_release_name;
    case "spotifyTrack":
      return row.spotify_track_name;
    case "spotifyArtist":
      return row.spotify_artists;
    case "spotifyAlbum":
      return row.spotify_album_name;
    case "file":
      return row.file_paths[0] ?? "";
    case "link":
      return row.spotify_uri;
  }
}

/** null sort = the pipeline's track_collate interleaving (default view). */
export function sortRows(
  rows: ComparisonResultRow[],
  sort: SortState | null,
): ComparisonResultRow[] {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => [r, i] as const)
    .sort(([a, ia], [b, ib]) => {
      const va = sortValue(a, sort.column);
      const vb = sortValue(b, sort.column);
      if (va === vb) return ia - ib; // stable
      if (va === "") return 1; // blanks last in either direction
      if (vb === "") return -1;
      return (
        va.localeCompare(vb, undefined, { sensitivity: "base" }) * dir ||
        ia - ib
      );
    })
    .map(([r]) => r);
}

/** Header-click cycle: pipeline order → asc → desc → pipeline order. */
export function nextSort(
  current: SortState | null,
  column: SortColumn,
): SortState | null {
  if (!current || current.column !== column) return { column, dir: "asc" };
  if (current.dir === "asc") return { column, dir: "desc" };
  return null;
}

// ---------------------------------------------------------------------------
// Summary lines & links (§6, §9)
// ---------------------------------------------------------------------------

/** Exact §9 format: "646 tracks · 105 not matched to Traktor®". */
export function summaryLine(total: number, notMatched: number): string {
  return `${total} track${total === 1 ? "" : "s"} · ${notMatched} not matched to Traktor®`;
}

/** Visible subset count when filters are active (§8): "141 of 646 tracks". */
export function filteredCountText(shown: number, total: number): string {
  return `${shown} of ${total} tracks`;
}

/** Post-run notes carry-forward summary, e.g. "2 notes dropped (gaps resolved)". */
export function notesSummaryText(s: NotesSummary | null): string | null {
  if (!s) return null;
  const parts: string[] = [];
  if (s.restored > 0) {
    parts.push(`${s.restored} note${s.restored === 1 ? "" : "s"} restored`);
  }
  if (s.dropped > 0) {
    parts.push(
      `${s.dropped} note${s.dropped === 1 ? "" : "s"} dropped (gaps resolved)`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** spotify:track:<id> → https://open.spotify.com/track/<id> (§6). */
export function spotifyTrackUrl(uri: string): string | null {
  const m = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri.trim());
  return m ? `https://open.spotify.com/track/${m[1]}` : null;
}

/** Stale-results banner copy (§9 + exportify-import §3.5). */
export const STALE_BANNER =
  "This comparison predates the latest Spotify® data import — run the pipeline to refresh it.";

// ---------------------------------------------------------------------------
// Markdown links in comparison notes (issue #142)
// ---------------------------------------------------------------------------

/**
 * Links are stored as PLAIN MARKDOWN inside the note string — `[text](url)`.
 * No rich text, no new fields. That is load-bearing: comparison notes ride the
 * fail-safe snapshot-merge (01-data-model.md §1, §6.3), which stays
 * string-based, so a link cannot introduce a new way to lose a note on a
 * pipeline run.
 *
 * Only the LINK syntax is interpreted. Bold, headings and lists render as
 * literal characters — this is not a markdown editor.
 */

/** Matches `[text](url)`; the url runs to the first unescaped `)`. */
const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Schemes a note link may use. Anything else renders as literal text. */
const SAFE_SCHEME = /^(https?:|mailto:)/i;

/** Loose test for "the user pasted a URL" — the paste-to-wrap trigger. */
export function isPastedUrl(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  return SAFE_SCHEME.test(t) || /^www\./i.test(t);
}

/**
 * Apply the paste-over-selection gesture to a note being edited: pasting a URL
 * while text is selected wraps that text as `[selected](url)`.
 *
 * With NO selection the raw URL is inserted as-is — wrapping empty text would
 * produce `[](url)`, which renders as an invisible link.
 *
 * Returns the new text and where the caret should land.
 */
export function applyLinkPaste(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  pasted: string,
): { text: string; caret: number } {
  const url = pasted.trim();
  const selected = value.slice(selectionStart, selectionEnd);
  const insert = selected ? `[${selected}](${url})` : url;
  return {
    text: value.slice(0, selectionStart) + insert + value.slice(selectionEnd),
    caret: selectionStart + insert.length,
  };
}

export type NoteSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; url: string };

/**
 * Split a stored note into renderable segments. Anything that is not a
 * well-formed link with a safe scheme stays literal text — malformed markdown
 * is displayed, never swallowed and never a crash.
 */
export function parseNoteSegments(note: string): NoteSegment[] {
  const out: NoteSegment[] = [];
  let last = 0;
  MD_LINK.lastIndex = 0;
  for (let m = MD_LINK.exec(note); m !== null; m = MD_LINK.exec(note)) {
    const [whole, label, url] = m;
    // A link needs a label and a scheme we are willing to open; otherwise the
    // source text passes through untouched.
    if (!label || !SAFE_SCHEME.test(url)) continue;
    if (m.index > last) {
      out.push({ kind: "text", text: note.slice(last, m.index) });
    }
    out.push({ kind: "link", text: label, url });
    last = m.index + whole.length;
  }
  if (last < note.length) out.push({ kind: "text", text: note.slice(last) });
  return out;
}

/** True when the note contains at least one renderable link. */
export function noteHasLink(note: string): boolean {
  return parseNoteSegments(note).some((s) => s.kind === "link");
}

/**
 * Export rendering for a note (forward-looking rule, #142): a `[title](url)`
 * is emitted as the BARE URL, title dropped. Compare export does not exist
 * yet — this records the decision next to the parser so the two cannot drift
 * when it ships.
 */
export function noteForExport(note: string): string {
  return parseNoteSegments(note)
    .map((s) => (s.kind === "link" ? s.url : s.text))
    .join("");
}
