/**
 * S3 — Track-Playlist Matrix (03-ui-design.md §5.3,
 * planning/02-features/track-playlist-matrix.md). The whole-catalog working
 * surface: one row per track, one column per playlist, compound filter/sort
 * that Traktor® can't do. Read-only — a lens over the pipeline output.
 *
 * The drawer (including its live sentence preview) and the per-column header
 * filters all read/write ONE serializable filter/sort state (matrixStore.applied
 * — see filterState.ts for the documented JSON shape); the deferred NL prompt
 * bar will emit into that same object.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button";
import { StatusChip } from "../../components/StatusChip";
import { Stepper } from "../../components/Stepper";
import { comparisonSkipped, usePipelineStatus } from "../../lib/usePipelineStatus";
import { useSettingsStore, gridRowHeight } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { type BreadcrumbCtx } from "./breadcrumb";
import { exportMatrix } from "./exportMatrix";
import { ColumnsMenu } from "./ColumnsMenu";
import { FilterDrawer } from "./FilterDrawer";
import {
  applyFilterSort,
  prepareMatrix,
  searchPlaceholder,
  visibleSearchColumns,
  type PreparedMatrix,
} from "./filtering";
import {
  activeFilterCount,
  type ColumnFilter,
  type SortLevel,
} from "./filterState";
import { HeaderFilterPopover, type PopoverAnchor } from "./HeaderFilterPopover";
import { MatrixGrid } from "./MatrixGrid";
import { MatrixIcon } from "./MatrixIcons";
import { MyPlaylistsMenu } from "./MyPlaylistsMenu";
import { useMatrixStore } from "./matrixStore";
import {
  MATRIX_ZOOM_MAX,
  MATRIX_ZOOM_MIN,
  MATRIX_ZOOM_STEP,
} from "./zoom";
import "./matrix.css";

// ---------------------------------------------------------------------------
// Empty state (§7.1): no pipeline run yet → explainer + Read Collection +
// Settings link. Trademark rule (§1.3): rendered "Traktor" carries ®.
// ---------------------------------------------------------------------------

function MatrixEmptyState({ reload }: { reload: () => void }) {
  const { status, start } = usePipelineStatus();
  const [startError, setStartError] = useState<string | null>(null);
  const running = status?.state === "running";

  useEffect(() => {
    if (status?.state === "completed") reload();
  }, [status?.state, reload]);

  return (
    <div className="mx-empty">
      <div className="mx-empty__box">
        <h2 className="mx-empty__title">No matrix yet</h2>
        <p className="mx-empty__text">
          The Track-Playlist Matrix is built from your Traktor® collection —
          one row per track, one column per playlist. Save your collection in
          Traktor®, then read it here. SetMaster never writes to your Traktor®
          collection file.
        </p>
        <Button variant="primary" disabled={running} onClick={() => void start().then(setStartError)}>
          Read Collection &amp; Remake Tables
        </Button>
        {running && <StatusChip variant="running">Reading collection…</StatusChip>}
        {(startError ?? status?.error) && (
          <p className="mx-empty__text" style={{ color: "var(--status-danger)" }}>
            {startError ?? status?.error}
          </p>
        )}
        <p className="mx-empty__text">
          Collection file not configured? <Link to="/settings">Open Settings</Link>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function MatrixScreen() {
  const data = useMatrixStore((s) => s.data);
  const loading = useMatrixStore((s) => s.loading);
  const notReady = useMatrixStore((s) => s.notReady);
  const loadError = useMatrixStore((s) => s.loadError);
  const load = useMatrixStore((s) => s.load);
  const applied = useMatrixStore((s) => s.applied);
  const setColumnFilter = useMatrixStore((s) => s.setColumnFilter);
  const setSort = useMatrixStore((s) => s.setSort);
  const setSearch = useMatrixStore((s) => s.setSearch);
  const drawerOpen = useMatrixStore((s) => s.drawerOpen);
  const openDrawer = useMatrixStore((s) => s.openDrawer);
  const closeDrawer = useMatrixStore((s) => s.closeDrawer);
  const clearFilters = useMatrixStore((s) => s.clearFilters);
  const layout = useMatrixStore((s) => s.layout);
  const hiddenPlaylists = useMatrixStore((s) => s.hiddenPlaylists);
  const toast = useUiStore((s) => s.toast);

  // Issue #5: when a run built the matrix but skipped the Spotify® comparison
  // (empty/missing Exportify folder), surface a calm, non-error note — the
  // matrix table itself still renders exactly as usual.
  const { status: pipelineStatus } = usePipelineStatus();
  const noSpotifyComparison = comparisonSkipped(pipelineStatus);

  const display = useSettingsStore((s) => s.settings.display);
  const updateSettings = useSettingsStore((s) => s.update);
  const notation = display.key_display_as;
  // #105 — one shared basis with the Set Editor. This used to call
  // computeRowHeight with the RAW font_size while the Set Editor passed the
  // scaled font, so the two grids differed by the type-scale factor and the
  // matrix's rows were shorter than the font its own CSS renders.
  const rowHeight = gridRowHeight(display);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => void load(true), [load]);

  // Prepared (indexed) matrix — computed once per payload (§8 performance).
  const prep: PreparedMatrix | null = useMemo(
    () => (data ? prepareMatrix(data) : null),
    [data],
  );

  // The free-text search scans only the VISIBLE text columns (#15 followup) —
  // hiding Artist/Album/Track via the Columns menu drops it from the search.
  const searchCols = useMemo(
    () => visibleSearchColumns(layout.hidden),
    [layout.hidden],
  );

  // The visible row set — memoized so filter edits are the only recomputes.
  const visible = useMemo(
    () => (prep ? applyFilterSort(prep, applied, notation, searchCols) : []),
    [prep, applied, notation, searchCols],
  );

  const playlistName = useCallback(
    (path: string) => {
      const idx = prep?.pathToIndex.get(path);
      return idx !== undefined && prep ? prep.playlists[idx].name : path;
    },
    [prep],
  );
  const crumbCtx = useMemo<BreadcrumbCtx>(
    () => ({ playlistName, notation }),
    [playlistName, notation],
  );

  // Header interactions.
  const [filterAnchor, setFilterAnchor] = useState<PopoverAnchor | null>(null);
  const [colMenuAnchor, setColMenuAnchor] = useState<{ left: number; top: number } | null>(null);
  const [plMenuAnchor, setPlMenuAnchor] = useState<{ left: number; top: number } | null>(null);

  const onSortClick = useCallback(
    (colId: string, additive: boolean) => {
      const cur = applied.sort;
      const idx = cur.findIndex((l) => l.col === colId);
      let next: SortLevel[];
      if (additive) {
        // Shift+click: add as another level / cycle its direction / drop.
        if (idx < 0) next = [...cur, { col: colId, dir: "asc" }];
        else if (cur[idx].dir === "asc")
          next = cur.map((l, i) => (i === idx ? { ...l, dir: "desc" as const } : l));
        else next = cur.filter((_, i) => i !== idx);
      } else {
        // Plain click: single-level cycle asc → desc → none.
        if (idx < 0 || cur.length > 1) next = [{ col: colId, dir: "asc" }];
        else if (cur[idx].dir === "asc") next = [{ col: colId, dir: "desc" }];
        else next = [];
      }
      setSort(next);
    },
    [applied.sort, setSort],
  );

  const onOpenFilter = useCallback((colId: string, rect: DOMRect) => {
    setFilterAnchor({ colId, left: rect.left - 100, top: rect.bottom + 4 });
  }, []);

  // Issue #14: one-click CSV export of the current filtered + sorted view.
  // Serializes from `visible` (the applyFilterSort output) — every matching
  // row, not just the virtualized window. Columns are the STABLE metadata
  // schema (issue #65): all 12 metadata columns regardless of on-screen
  // show/hide or reorder, then the My-Playlists-shown playlist columns.
  const onExport = useCallback(() => {
    if (!prep) return;
    const { filename, rowCount } = exportMatrix({
      prep,
      visible,
      applied,
      hiddenPlaylists,
      notation,
      playlistName,
    });
    if (rowCount === 0) {
      toast(`0 tracks matched — exported header row only (${filename})`, "info");
    } else {
      toast(`Exported ${rowCount.toLocaleString("en-US")} tracks — ${filename}`, "success");
    }
  }, [prep, visible, applied, hiddenPlaylists, notation, playlistName, toast]);

  const activeCount = activeFilterCount(applied);

  // ---- Render states ----
  if (notReady) {
    return (
      <div className="mx-screen">
        <MatrixEmptyState reload={reload} />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="mx-screen">
        <div className="mx-empty">
          <div className="mx-empty__box">
            <h2 className="mx-empty__title">Couldn't load the matrix</h2>
            <p className="mx-empty__text">{loadError}</p>
            <Button onClick={reload}>Retry</Button>
          </div>
        </div>
      </div>
    );
  }
  if (!prep || loading) {
    return (
      <div className="mx-screen">
        <div className="mx-empty">
          <div className="mx-empty__box">
            <p className="mx-empty__text">Loading matrix…</p>
          </div>
        </div>
      </div>
    );
  }

  const total = prep.rows.length;
  // "N of M playlists" (issue #13): the shown subset vs. the full playlist set.
  const totalPlaylists = prep.playlists.length;
  const shownPlaylists = prep.playlists.reduce(
    (n, p) => (hiddenPlaylists.has(p.path) ? n : n + 1),
    0,
  );
  const playlistLabel =
    shownPlaylists === totalPlaylists
      ? `${totalPlaylists} playlists`
      : `${shownPlaylists} of ${totalPlaylists} playlists`;
  const popoverFilter: ColumnFilter = filterAnchor
    ? (applied.columns[filterAnchor.colId] ?? {})
    : {};

  return (
    <div className="mx-screen">
      {/* ---- Toolbar ---- */}
      <div className="mx-toolbar">
        <span className="mx-toolbar__title">Track-Playlist Matrix</span>
        <span className="mx-toolbar__count">
          {visible.length === total
            ? `${total.toLocaleString("en-US")} tracks · ${playlistLabel}`
            : `${visible.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} tracks · ${playlistLabel}`}
        </span>
        <span className="mx-toolbar__spacer" />
        <span className="mx-toolbar__opt">
          <span className="mx-line__label">Zoom</span>
          <Stepper
            value={display.matrix_zoom}
            min={MATRIX_ZOOM_MIN}
            max={MATRIX_ZOOM_MAX}
            step={MATRIX_ZOOM_STEP}
            format={(v) => `${v}%`}
            ariaLabel="Zoom"
            onChange={(v) => void updateSettings({ display: { matrix_zoom: v } })}
          />
        </span>
        <span className="mx-toolbar__opt">
          <span className="mx-line__label">Spacing</span>
          <Stepper
            value={display.line_spacing}
            min={70}
            max={150}
            step={10}
            format={(v) => `${v}%`}
            ariaLabel="Spacing"
            onChange={(v) => void updateSettings({ display: { line_spacing: v } })}
          />
        </span>
        <span className="mx-toolbar__opt">
          <span className="mx-line__label">Font</span>
          <Stepper
            value={display.font_size}
            min={10}
            max={20}
            step={1}
            format={(v) => `${v}px`}
            ariaLabel="Font Size"
            onChange={(v) => void updateSettings({ display: { font_size: v } })}
          />
        </span>
        <Button
          size="sm"
          title="Show or hide playlist columns"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setPlMenuAnchor({ left: rect.right - 300, top: rect.bottom + 4 });
          }}
        >
          <MatrixIcon name="list" size={14} /> My Playlists
        </Button>
        <Button
          size="sm"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setColMenuAnchor({ left: rect.right - 240, top: rect.bottom + 4 });
          }}
        >
          <MatrixIcon name="columns" size={14} /> Columns
        </Button>
        <Button
          size="sm"
          onClick={onExport}
          title="Download the current filtered & sorted view as a CSV"
        >
          <MatrixIcon name="download" size={14} /> Export Matrix
        </Button>
        <Button
          size="sm"
          className={activeCount > 0 ? "mx-clear-active" : undefined}
          onClick={clearFilters}
          title="Clear all filters (does not change sorting)"
        >
          <MatrixIcon name="funnelOff" size={14} /> Clear All Filters
        </Button>
        <Button
          size="sm"
          className={drawerOpen ? "btn--primary" : undefined}
          onClick={() => (drawerOpen ? closeDrawer() : openDrawer())}
        >
          <MatrixIcon name="funnel" size={14} /> Filters
          {activeCount > 0 && <span className="mx-badge">{activeCount}</span>}
        </Button>
      </div>

      {/* ---- Search row (issue #15): free-text find across the VISIBLE text
             columns (Artist / Album / Track, per the Columns menu — #15
             followup), in the band #12 vacated. Filters ROWS live as you type;
             ANDed with every drawer/column filter; not persisted. Keyword
             clauses (#24) work regardless of text-column visibility. ---- */}
      <div className="mx-search">
        <span className="mx-search__icon" aria-hidden="true">
          <MatrixIcon name="search" size={15} />
        </span>
        <input
          type="text"
          className="mx-search__input"
          value={applied.search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder(searchCols)}
          aria-label={searchPlaceholder(searchCols).replace(/…$/, "")}
          spellCheck={false}
          autoComplete="off"
        />
        {applied.search !== "" && (
          <button
            type="button"
            className="mx-search__clear"
            onClick={() => setSearch("")}
            title="Clear search"
            aria-label="Clear search"
          >
            <MatrixIcon name="close" size={13} />
          </button>
        )}
      </div>

      {/* ---- Comparison-skipped notice (issue #5): calm, non-error ---- */}
      {noSpotifyComparison && (
        <div className="mx-notice" role="status">
          <span className="mx-notice__icon">
            <MatrixIcon name="info" size={15} />
          </span>
          <span>
            Comparison columns are unavailable until Spotify® data is imported —
            the matrix built from your Traktor® collection as usual.{" "}
            <Link to="/comparison-settings">Open Comparison Settings</Link> to
            add your Spotify® exports.
          </span>
        </div>
      )}

      {/* ---- Grid + drawer side by side (§11.5: table stays visible) ---- */}
      <div className="mx-main">
        <MatrixGrid
          prep={prep}
          visible={visible}
          applied={applied}
          layout={layout}
          rowHeight={rowHeight}
          notation={notation}
          colorfulKeys={display.colorful_keys}
          zoom={display.matrix_zoom}
          onSortClick={onSortClick}
          onOpenFilter={onOpenFilter}
        />
        {drawerOpen && <FilterDrawer prep={prep} notation={notation} ctx={crumbCtx} />}
      </div>

      {/* ---- Popovers ---- */}
      {filterAnchor && (
        <HeaderFilterPopover
          prep={prep}
          anchor={filterAnchor}
          filter={popoverFilter}
          notation={notation}
          playlistName={playlistName}
          onChange={(next) => setColumnFilter(filterAnchor.colId, next)}
          onClose={() => setFilterAnchor(null)}
        />
      )}
      {colMenuAnchor && (
        <ColumnsMenu anchor={colMenuAnchor} onClose={() => setColMenuAnchor(null)} />
      )}
      {plMenuAnchor && (
        <MyPlaylistsMenu
          prep={prep}
          visibleRows={visible}
          anchor={plMenuAnchor}
          onClose={() => setPlMenuAnchor(null)}
        />
      )}
    </div>
  );
}
