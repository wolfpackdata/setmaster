/**
 * S3 virtualized grid — virtualized on BOTH axes (@tanstack/react-virtual,
 * feature spec §8): rows over the filtered+sorted index list, columns over
 * the playlist columns (the 11 metadata columns stay frozen/sticky-left,
 * mirroring the prototype's freeze at M2). Borderless striped 32px rows per
 * 03-ui-design.md §6.1; sticky uppercase header with always-orange sort
 * triangles and orange "filtered" / blue "sorted" column-header states
 * (issue #7); column resize by header-edge drag.
 *
 * Cell rules (feature spec §3/§11): Play Count 0 explicit red 0, 0 and 1 red;
 * Key per Key Display As + Colorful Keys; Track Name emphasized (brand-cyan);
 * On Super Playlist green; On Non-Super Playlist magenta with cell highlight when > 0;
 * dates M/D/YYYY raw incl. 1/1/YYYY placeholders (issue #6); playlist cells
 * show the track name (non-blank ⇔ membership).
 */

import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { KeyNotation } from "../../lib/keys";
import { formatKey, keyColor } from "../../lib/keys";
import {
  defaultColWidth,
  headerWrapLines,
  META_COLUMN_BY_ID,
  MIN_COL_WIDTH,
  type MetaColumn,
} from "./columns";
import {
  fmtBpm,
  fmtMatrixDate,
  type PreparedMatrix,
  type PreparedRow,
} from "./filtering";
import {
  columnHeaderState,
  isColumnFilterActive,
  playlistColId,
  type MatrixFilterState,
  type SortLevel,
} from "./filterState";
import { MatrixIcon } from "./MatrixIcons";
import { playlistColWidth, useMatrixStore, type ColumnLayout } from "./matrixStore";
import { resizedColumnWidth, zoomFactor } from "./zoom";

// Issue #80: taller uniform header row so the three wrapped labels (Play Count,
// On Super Playlist, On Non-Super Playlist) fit on two lines; single-line
// headers vertically center in it. Sticky-header offset and the virtualized
// body follow because the header keeps its box in normal flow.
const HEADER_H = 42;

// ---------------------------------------------------------------------------
// Header sort triangle — always orange (issue #7) so direction stays visible
// on both blue "sorted" headers and orange "filtered+sorted" headers.
// ---------------------------------------------------------------------------

function SortMark({ sort, colId }: { sort: SortLevel[]; colId: string }) {
  const idx = sort.findIndex((l) => l.col === colId);
  if (idx < 0) return null;
  return (
    <span className="mx-hcell__sort" aria-hidden="true">
      {sort[idx].dir === "asc" ? "▲" : "▼"}
      {sort.length > 1 && <span className="mx-hcell__sortlevel">{idx + 1}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Column resize (header-edge drag, §6.1)
// ---------------------------------------------------------------------------

function ResizeHandle({
  colId,
  width,
  defaultWidth,
  zoom,
}: {
  colId: string;
  width: number;
  /** Double-click restores this (issue #6 header-derived default). */
  defaultWidth: number;
  /** Matrix zoom percentage (issue #81) — drag deltas divide by its factor. */
  zoom: number;
}) {
  const setColumnWidth = useMatrixStore((s) => s.setColumnWidth);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  return (
    <span
      className="mx-hcell__resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={(e) => {
        drag.current = { startX: e.clientX, startW: width };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        // The grid is rendered under CSS `zoom` (#81): the pointer delta is in
        // screen px but stored widths are unzoomed logical px, so divide the
        // delta by the zoom factor for the edge to track the cursor 1:1.
        setColumnWidth(
          colId,
          Math.max(
            MIN_COL_WIDTH,
            resizedColumnWidth(drag.current.startW, e.clientX - drag.current.startX, zoom),
          ),
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onDoubleClick={() => setColumnWidth(colId, defaultWidth)}
    />
  );
}

// ---------------------------------------------------------------------------
// Metadata cell renderer
// ---------------------------------------------------------------------------

function metaCellClass(col: MetaColumn, p: PreparedRow): string {
  const cls = ["mx-cell"];
  if (col.kind === "num" || col.kind === "date") cls.push("mx-cell--num");
  if (col.align === "center") cls.push("mx-cell--center");
  switch (col.id) {
    case "name":
      cls.push("mx-cell--trackname");
      break;
    case "playcount":
      if (p.row.playcount <= 1) cls.push("mx-cell--playred");
      break;
    case "root":
      cls.push("mx-cell--root");
      break;
    case "nonroot":
      cls.push("mx-cell--nonroot");
      if (p.row.nonroot > 0) cls.push("mx-cell--nonroot-hit");
      break;
    case "file_path":
      cls.push("mx-cell--mono", "mx-cell--muted");
      break;
  }
  return cls.join(" ");
}

function metaCellContent(
  col: MetaColumn,
  p: PreparedRow,
  notation: KeyNotation,
  colorfulKeys: boolean,
): React.ReactNode {
  const r = p.row;
  switch (col.id) {
    case "import_date":
      return fmtMatrixDate(r.import_date);
    case "release_date":
      return fmtMatrixDate(r.release_date);
    case "last_played":
      return fmtMatrixDate(r.last_played);
    case "playcount":
      // §11.9: 0 renders as an explicit red 0, never blank.
      return String(r.playcount);
    case "bpm":
      return fmtBpm(r.bpm);
    case "key": {
      if (!r.key) return "";
      const color = keyColor(r.key, colorfulKeys);
      const text = formatKey(r.key, notation);
      return color ? <span style={{ color }}>{text}</span> : text;
    }
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

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function MatrixGrid({
  prep,
  visible,
  applied,
  layout,
  rowHeight,
  notation,
  colorfulKeys,
  zoom,
  onSortClick,
  onOpenFilter,
}: {
  prep: PreparedMatrix;
  /** Row indices into prep.rows, already filtered + sorted. */
  visible: number[];
  applied: MatrixFilterState;
  layout: ColumnLayout;
  rowHeight: number;
  notation: KeyNotation;
  colorfulKeys: boolean;
  /** Grid-only zoom percentage (issue #81); 100 = no zoom. */
  zoom: number;
  /** Header label click: plain = cycle single sort, shift = add level. */
  onSortClick: (colId: string, additive: boolean) => void;
  onOpenFilter: (colId: string, rect: DOMRect) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Frozen metadata columns in user order, hidden ones dropped.
  const metaCols = useMemo(
    () =>
      layout.order
        .filter((id) => !layout.hidden.includes(id))
        .map((id) => META_COLUMN_BY_ID.get(id))
        .filter((c): c is MetaColumn => c !== undefined),
    [layout.order, layout.hidden],
  );
  const metaWidths = useMemo(
    () => metaCols.map((c) => layout.widths[c.id] ?? c.width),
    [metaCols, layout.widths],
  );
  const frozenW = useMemo(
    () => metaWidths.reduce((a, b) => a + b, 0),
    [metaWidths],
  );

  // Playlist columns, alphabetical (§11.11), minus the ones hidden via the
  // "My Playlists" selector (issue #13). Filtered in this ONE place so the
  // header row, body cells, and the column virtualizer below all agree.
  const hiddenPlaylists = useMatrixStore((s) => s.hiddenPlaylists);
  const plIndices = useMemo(
    () => prep.playlistOrder.filter((i) => !hiddenPlaylists.has(prep.playlists[i].path)),
    [prep.playlistOrder, prep.playlists, hiddenPlaylists],
  );

  const rowVirt = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const colVirt = useVirtualizer({
    horizontal: true,
    count: plIndices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) =>
      playlistColWidth(
        layout,
        playlistColId(prep.playlists[plIndices[i]].path),
        prep.playlists[plIndices[i]].name,
      ),
    overscan: 4,
    getItemKey: (i) => prep.playlists[plIndices[i]].path,
  });

  // Re-measure when widths change OR the visible playlist set changes (issue
  // #13: the horizontal virtualizer must re-measure when columns are shown or
  // hidden so offsets/total width stay correct).
  useEffect(() => {
    colVirt.measure();
  }, [layout.widths, plIndices, colVirt]);
  useEffect(() => {
    rowVirt.measure();
  }, [rowHeight, rowVirt]);

  const innerW = frozenW + colVirt.getTotalSize();
  const vRows = rowVirt.getVirtualItems();
  const vCols = colVirt.getVirtualItems();

  // Issue #7: orange "filtered" / blue "sorted" treatment on the OUTER header
  // cell. Applied identically to the frozen-meta and playlist column headers.
  const hcellStateClass = (colId: string): string => {
    const st = columnHeaderState(applied, colId);
    return st ? ` mx-hcell--${st}` : "";
  };

  const headerCell = (col: {
    id: string;
    label: string;
    align?: string;
    wrapHeader?: boolean;
  }) => {
    const active = isColumnFilterActive(applied.columns[col.id]);
    // Issue #80: the three flagged columns render on two lines (label verbatim)
    // so their default width tracks the longest line, not the full label.
    const wrapLines = col.wrapHeader ? headerWrapLines(col.label) : null;
    return (
      <>
        <button
          type="button"
          className={`mx-hcell__label${wrapLines ? " mx-hcell__label--wrap" : ""}`}
          title={col.label}
          // Header label follows the column alignment (issue #6): right and
          // center columns carry it inline; left is the inherited default.
          style={
            col.align === "right" || col.align === "center"
              ? { textAlign: col.align }
              : undefined
          }
          onClick={(e) => onSortClick(col.id, e.shiftKey)}
        >
          {wrapLines
            ? wrapLines.map((line, i) => (
                <span key={i} className="mx-hcell__line">
                  {line}
                </span>
              ))
            : col.label}
        </button>
        <SortMark sort={applied.sort} colId={col.id} />
        <button
          type="button"
          className={`mx-hcell__filter${active ? " mx-hcell__filter--active" : ""}`}
          aria-label={`Filter ${col.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenFilter(col.id, (e.currentTarget as HTMLElement).getBoundingClientRect());
          }}
        >
          <MatrixIcon name="funnel" size={12} />
        </button>
      </>
    );
  };

  return (
    // Issue #81: grid-only zoom (ruling R4) — CSS `zoom` scales this whole
    // subtree (headers, cells, widths, padding) while participating in layout,
    // so both virtualizers, the sticky header, and scroll extents stay
    // consistent. The flex OUTER box of .mx-gridwrap is unaffected by `zoom`, so
    // the sibling drawer and everything outside the grid stay at 100%.
    <div className="mx-gridwrap" style={{ zoom: zoomFactor(zoom) }}>
      <div
        className="mx-scroll"
        ref={scrollRef}
        role="grid"
        aria-rowcount={visible.length}
        aria-colcount={metaCols.length + plIndices.length}
      >
        <div className="mx-inner" style={{ width: innerW }}>
          {/* ---- Sticky header ---- */}
          <div className="mx-header" style={{ height: HEADER_H, width: innerW }} role="row">
            <div className="mx-header__frozen" style={{ width: frozenW, height: HEADER_H }}>
              {metaCols.map((col, i) => (
                <div
                  key={col.id}
                  className={`mx-hcell${hcellStateClass(col.id)}`}
                  style={{ width: metaWidths[i] }}
                  role="columnheader"
                >
                  {headerCell(col)}
                  <ResizeHandle colId={col.id} width={metaWidths[i]} defaultWidth={col.width} zoom={zoom} />
                </div>
              ))}
            </div>
            {vCols.map((vc) => {
              const pl = prep.playlists[plIndices[vc.index]];
              const colId = playlistColId(pl.path);
              return (
                <div
                  key={vc.key}
                  className={`mx-hcell mx-hcell--pl${hcellStateClass(colId)}`}
                  style={{ left: frozenW + vc.start, width: vc.size }}
                  role="columnheader"
                  title={pl.path}
                >
                  {headerCell({ id: colId, label: pl.name })}
                  <ResizeHandle colId={colId} width={vc.size} defaultWidth={defaultColWidth(pl.name)} zoom={zoom} />
                </div>
              );
            })}
          </div>

          {/* ---- Virtualized body ---- */}
          <div className="mx-body" style={{ height: rowVirt.getTotalSize() }}>
            {vRows.map((vr) => {
              const p = prep.rows[visible[vr.index]];
              return (
                <div
                  key={vr.key}
                  className={`mx-row ${vr.index % 2 === 0 ? "mx-row--even" : "mx-row--odd"}`}
                  style={{
                    transform: `translateY(${vr.start}px)`,
                    height: vr.size,
                    width: innerW,
                  }}
                  role="row"
                  aria-rowindex={vr.index + 1}
                >
                  <div className="mx-row__frozen" style={{ width: frozenW }}>
                    {metaCols.map((col, i) => (
                      <div
                        key={col.id}
                        className={metaCellClass(col, p)}
                        style={{ width: metaWidths[i] }}
                        role="gridcell"
                      >
                        <span>{metaCellContent(col, p, notation, colorfulKeys)}</span>
                      </div>
                    ))}
                  </div>
                  {vCols.map((vc) => {
                    const plIdx = plIndices[vc.index];
                    const member = p.member.has(plIdx);
                    return (
                      <div
                        key={vc.key}
                        className="mx-cell mx-cell--pl"
                        style={{ left: frozenW + vc.start, width: vc.size }}
                        role="gridcell"
                      >
                        {member && <span>{p.row.name}</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
