/**
 * S3 metadata column definitions — spec order and exact SM2/CSV header labels
 * (track-playlist-matrix.md §3). Last Played, Album Title, and File Path are
 * the default-hidden columns (issue #77); the user can show/hide any column
 * freely, but the default set is fixed. Playlist columns (one per playlist,
 * alphabetical §11.11) are generated from the /api/matrix payload, not listed
 * here.
 */

export type ColKind = "date" | "num" | "text" | "key";

export interface MetaColumn {
  id: string;
  label: string;
  kind: ColKind;
  width: number;
  align: "left" | "right" | "center";
  /** Hidden unless the user shows it (Last Played, Album Title, File Path — §3). */
  optionalHidden?: boolean;
  /**
   * Issue #80: render this header on two lines (label verbatim, no abbreviation)
   * so its default width is driven by the longest wrapped LINE, not the full
   * label. Set on the three widest count/number columns only. See HEADER_WRAP.
   */
  wrapHeader?: boolean;
}

/**
 * Issue #80 — two-line header splits. The label text is kept verbatim (exact
 * SM2 vocabulary); wrapping just moves the width driver from the full label to
 * the longest line. Only these three columns wrap; every other header stays a
 * single line. The split points are hand-chosen so both lines read naturally.
 */
const HEADER_WRAP: Readonly<Record<string, readonly [string, string]>> = {
  "Play Count": ["Play", "Count"],
  "On Super Playlist": ["On Super", "Playlist"],
  "On Non-Super Playlist": ["On Non-Super", "Playlist"],
};

/**
 * The two lines a wrapped header renders as, or `null` for a single-line label.
 * MatrixGrid uses this to emit one span per line; defaultColWidth uses it to
 * size the column to the longest line.
 */
export function headerWrapLines(label: string): readonly string[] | null {
  return HEADER_WRAP[label] ?? null;
}

/**
 * Issue #6: default column width fits the (uppercased, letterspaced) header
 * label so the full header name is always visible — width is HEADER-driven,
 * never data-driven. The chrome allowance covers the cell padding, the always-
 * present funnel button, inter-element gaps, and a sort-arrow reserve so a
 * sorted header doesn't clip its own label. Playlist columns reuse this helper
 * on the playlist name (see matrixStore.playlistColWidth). Album Title, Artist
 * Name, and Track Name keep their hand-tuned widths (issue #6: "look good").
 *
 * Issue #80: for a wrapped header (`wrap`), the driver is the longest wrapped
 * line rather than the whole label — the full header still shows in full, on
 * two lines, at this narrower default. Refines #6 rather than breaking it.
 */
const HEADER_CHAR_W = 7.4; // avg advance of the 12px/600 uppercase label glyph incl. 0.06em tracking
const HEADER_CHROME = 52; // padding (16) + funnel (18) + gaps + sort-arrow reserve

export function defaultColWidth(label: string, wrap = false): number {
  const lines = wrap ? headerWrapLines(label) : null;
  const drivenChars = lines
    ? Math.max(...lines.map((l) => l.length))
    : label.length;
  return Math.ceil(drivenChars * HEADER_CHAR_W) + HEADER_CHROME;
}

export const META_COLUMNS: readonly MetaColumn[] = [
  { id: "import_date", label: "Import Date", kind: "date", width: defaultColWidth("Import Date"), align: "center" },
  { id: "release_date", label: "Release Date", kind: "date", width: defaultColWidth("Release Date"), align: "center" },
  { id: "last_played", label: "Last Played", kind: "date", width: defaultColWidth("Last Played"), align: "center", optionalHidden: true },
  { id: "playcount", label: "Play Count", kind: "num", width: defaultColWidth("Play Count", true), align: "center", wrapHeader: true },
  { id: "bpm", label: "BPM", kind: "num", width: defaultColWidth("BPM"), align: "center" },
  { id: "key", label: "Key", kind: "key", width: defaultColWidth("Key"), align: "center" },
  { id: "album", label: "Album Title", kind: "text", width: 168, align: "left", optionalHidden: true },
  { id: "artist", label: "Artist Name", kind: "text", width: 168, align: "left" },
  { id: "name", label: "Track Name", kind: "text", width: 250, align: "left" },
  { id: "root", label: "On Super Playlist", kind: "num", width: defaultColWidth("On Super Playlist", true), align: "center", wrapHeader: true },
  { id: "nonroot", label: "On Non-Super Playlist", kind: "num", width: defaultColWidth("On Non-Super Playlist", true), align: "center", wrapHeader: true },
  {
    id: "file_path",
    label: "File Path",
    kind: "text",
    width: 280,
    align: "left",
    optionalHidden: true,
  },
] as const;

export const META_COLUMN_BY_ID: ReadonlyMap<string, MetaColumn> = new Map(
  META_COLUMNS.map((c) => [c.id, c]),
);

export const DEFAULT_META_ORDER: readonly string[] = META_COLUMNS.map((c) => c.id);

export const DEFAULT_HIDDEN: readonly string[] = META_COLUMNS.filter(
  (c) => c.optionalHidden,
).map((c) => c.id);

export const DEFAULT_PLAYLIST_COL_WIDTH = 128;
export const MIN_COL_WIDTH = 40;
export const MAX_COL_WIDTH = 640;
