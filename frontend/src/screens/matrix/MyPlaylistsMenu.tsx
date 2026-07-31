/**
 * "My Playlists" show/hide selector (issue #13). A dropdown modeled on
 * ColumnsMenu (anchor/positioning, click-outside + Esc) but for the playlist
 * COLUMNS of the matrix: a search box, an alphabetical checkbox list of every
 * loaded playlist (checked = column shown), and Show all / Hide all acting on
 * the FULL set (not the search-filtered view). Playlists are keyed by path,
 * displayed by name (CLAUDE.md). The smart part is the one-shot auto-clear —
 * see myPlaylistsLogic.shouldAutoClear.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import type { PreparedMatrix } from "./filtering";
import { MatrixIcon } from "./MatrixIcons";
import { useMatrixStore } from "./matrixStore";
import {
  allShownFor,
  filterPlaylistsByName,
  playlistsContainingVisible,
  shouldAutoClear,
  shownCountFor,
  sortShownFirst,
} from "./myPlaylistsLogic";

const MENU_WIDTH = 300;

export function MyPlaylistsMenu({
  prep,
  visibleRows,
  anchor,
  onClose,
}: {
  prep: PreparedMatrix;
  /** Visible (filtered + sorted) row indices — the #79 action's snapshot. */
  visibleRows: readonly number[];
  anchor: { left: number; top: number };
  onClose: () => void;
}) {
  const hidden = useMatrixStore((s) => s.hiddenPlaylists);
  const setPlaylistHidden = useMatrixStore((s) => s.setPlaylistHidden);
  const showAllPlaylists = useMatrixStore((s) => s.showAllPlaylists);
  const hideAllPlaylists = useMatrixStore((s) => s.hideAllPlaylists);
  const showOnlyPlaylists = useMatrixStore((s) => s.showOnlyPlaylists);

  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  // Hidden set snapshotted at menu open (#13 followup): the list is ordered
  // shown-first against THIS set, so checked playlists sit on top when the
  // menu opens but rows don't re-sort (jump) while the user clicks. The live
  // `hidden` still drives the checkbox states and counts.
  const [pinnedHidden] = useState<ReadonlySet<string>>(() => new Set(hidden));

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Every playlist, already alphabetical (prep.playlistOrder, §11.11) — the
  // FULL set that Show all / Hide all operate on, independent of the search.
  const allPlaylists = useMemo(
    () => prep.playlistOrder.map((i) => prep.playlists[i]),
    [prep],
  );
  const allPaths = useMemo(() => allPlaylists.map((p) => p.path), [allPlaylists]);
  // Shown-at-open pinned on top, alphabetical within each group; the search
  // filter preserves that order.
  const ordered = useMemo(
    () => sortShownFirst(allPlaylists, pinnedHidden),
    [allPlaylists, pinnedHidden],
  );
  const visible = useMemo(
    () => filterPlaylistsByName(ordered, query),
    [ordered, query],
  );

  const allShown = allShownFor(allPaths, hidden);
  const shownCount = shownCountFor(allPaths, hidden);
  const total = allPaths.length;

  const onSearchChange = (next: string) => {
    // One-shot: from the all-shown default, the first search keystroke clears
    // the selection so the user builds up from nothing. Never re-fires while
    // narrowing (case 3); re-arms only after Show all restores all-shown (5).
    if (shouldAutoClear(query, next, allShown)) hideAllPlaylists(allPaths);
    setQuery(next);
  };

  // #79: set the My Playlists selection from the current filtered track list —
  // show exactly the playlists containing ≥1 visible track, hide the rest.
  // One-shot (reads `visible` at click time); zero matches → every playlist
  // hidden. Menu stays open so the user sees the checkboxes update in place.
  const onShowContainingTracks = () => {
    const shown = playlistsContainingVisible(visibleRows, prep.rows, prep.playlists);
    showOnlyPlaylists([...shown], allPaths);
  };

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - MENU_WIDTH - 8));

  return (
    <div
      ref={rootRef}
      className="mx-colmenu mx-plmenu"
      style={{ left, top: anchor.top }}
      role="dialog"
      aria-label="My Playlists"
    >
      <Button
        size="sm"
        variant="ghost"
        className="mx-plmenu__containing"
        title="Selects every playlist containing at least one track in the current filtered track list; unchecks the rest."
        onClick={onShowContainingTracks}
      >
        Show Playlists Containing These Tracks
      </Button>

      <div className="mx-plmenu__search">
        <MatrixIcon name="search" size={13} />
        <input
          type="text"
          value={query}
          placeholder="Search playlists…"
          aria-label="Search playlists"
          autoFocus
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {query !== "" && (
          <button
            type="button"
            className="mx-plmenu__clear"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <MatrixIcon name="close" size={12} />
          </button>
        )}
      </div>

      <div className="mx-plmenu__actions">
        <Button size="sm" variant="ghost" onClick={() => showAllPlaylists()}>
          Show all
        </Button>
        <Button size="sm" variant="ghost" onClick={() => hideAllPlaylists(allPaths)}>
          Hide all
        </Button>
        <span className="mx-plmenu__count">
          {shownCount} of {total} shown
        </span>
      </div>

      <div className="mx-plmenu__list">
        {visible.length === 0 ? (
          <div className="mx-plmenu__empty">No playlists match “{query}”.</div>
        ) : (
          visible.map((pl) => {
            const id = `mx-pl-${pl.path}`;
            return (
              <div key={pl.path} className="mx-colmenu__row mx-plmenu__row">
                <input
                  type="checkbox"
                  id={id}
                  checked={!hidden.has(pl.path)}
                  onChange={(e) => setPlaylistHidden(pl.path, !e.target.checked)}
                />
                <label className="mx-colmenu__label" htmlFor={id} title={pl.path}>
                  {pl.name}
                </label>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
