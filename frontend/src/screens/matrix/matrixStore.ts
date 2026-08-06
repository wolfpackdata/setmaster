/**
 * S3 store — matrix payload, the APPLIED unified filter/sort state (drawer
 * drafts live locally in the drawer component; the table only updates on
 * Apply, §5), drawer visibility, and the persisted column layout
 * (show/hide + reorder + widths, §3 / §5.3 "persisted").
 */

import { create } from "zustand";
import { ApiError, getMatrix, type MatrixData } from "../../lib/api";
import {
  cloneFilterState,
  columnIdForLine,
  drawerFromApplied,
  emptyDrawerLines,
  emptyFilterState,
  lineForColumn,
  MAPPABLE_LINES,
  mirrorLineToColumn,
  quickSortIdOf,
  QUICK_SORTS,
  type ColumnFilter,
  type DrawerLines,
  type MatrixFilterState,
  type SortLevel,
} from "./filterState";
import { isColumnFilterActive } from "./filterState";
import {
  DEFAULT_HIDDEN,
  DEFAULT_META_ORDER,
  DEFAULT_PLAYLIST_COL_WIDTH,
  defaultColWidth,
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
} from "./columns";
import { SEARCH_COLUMNS, visibleSearchColumns } from "./filtering";

const LAYOUT_KEY = "sm3.matrix.columns";
const SKIP_APPLY_KEY = "sm3.matrix.skipApply";
const HIDDEN_PL_KEY = "sm3.matrix.hiddenPlaylists";

const QUICK_SORT_BY_ID = new Map(QUICK_SORTS.map((q) => [q.id, q]));

/**
 * "Skip Apply" live-filter preference (issue #9). Persisted in localStorage
 * like the other drawer/matrix prefs (column layout, sidebar) — a boolean, so
 * the state stays trivially serializable. Guarded because vitest's node env has
 * no localStorage (same pattern as loadLayout).
 */
function loadSkipApply(): boolean {
  try {
    return localStorage.getItem(SKIP_APPLY_KEY) === "true";
  } catch {
    return false;
  }
}

function saveSkipApply(v: boolean): void {
  try {
    localStorage.setItem(SKIP_APPLY_KEY, v ? "true" : "false");
  } catch {
    /* storage unavailable */
  }
}

/**
 * "My Playlists" show/hide selection (issue #13). Playlist COLUMNS are keyed by
 * full `playlist_path` (paths are the identity; names are display, CLAUDE.md).
 * We persist the HIDDEN set — a playlist is shown iff its path is NOT in the
 * set, so a playlist that appears in a later pipeline run (absent from the set)
 * defaults to SHOWN with no migration. Guarded because vitest's node env has no
 * localStorage (same pattern as loadLayout / loadSkipApply).
 */
function loadHiddenPlaylists(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_PL_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((p): p is string => typeof p === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveHiddenPlaylists(hidden: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_PL_KEY, JSON.stringify([...hidden]));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Drop hidden paths that no longer exist in the current payload (forward-compat,
 * same intent as loadLayout's stale-id filtering). Pure so it is unit-testable
 * without a live matrix. Returns a NEW set only removing stale paths — never
 * adds, so a brand-new playlist stays out of the set (= shown by default).
 */
export function reconcileHidden(
  hidden: Set<string>,
  existingPaths: readonly string[],
): Set<string> {
  const existing = new Set(existingPaths);
  const next = new Set<string>();
  for (const p of hidden) if (existing.has(p)) next.add(p);
  return next;
}

export interface ColumnLayout {
  /** Metadata column ids in display order (always contains all known ids). */
  order: string[];
  /** Hidden metadata column ids (Last Played, Album Title, File Path hidden by default — issue #77). */
  hidden: string[];
  /** Column id (meta or "pl:<path>") → width px overrides. */
  widths: Record<string, number>;
}

function defaultLayout(): ColumnLayout {
  return {
    order: [...DEFAULT_META_ORDER],
    hidden: [...DEFAULT_HIDDEN],
    widths: {},
  };
}

/**
 * The build-#1 default hidden set — File Path only. A saved layout whose hidden
 * set is EXACTLY this is treated as "user never customized visibility" and is
 * upgraded once to the current DEFAULT_HIDDEN (issue #77 / ruling R5). Any other
 * saved set — including the empty set, or one that merely happens to contain
 * file_path among other columns — is the user's choice and is preserved
 * verbatim.
 */
const LEGACY_DEFAULT_HIDDEN: readonly string[] = ["file_path"];

function isLegacyDefaultHidden(hidden: readonly string[]): boolean {
  return (
    hidden.length === LEGACY_DEFAULT_HIDDEN.length &&
    hidden.every((id, i) => id === LEGACY_DEFAULT_HIDDEN[i])
  );
}

/**
 * Pure parse of a persisted layout string, applying the issue #77 one-time
 * default-hidden migration. Split out of loadLayout so the migration is
 * unit-testable without a live localStorage. Returns the resolved layout and
 * whether the migration fired (loadLayout persists on migration so it happens
 * once). May throw on malformed JSON — loadLayout's try/catch handles that.
 */
export function parseLayout(raw: string | null): { layout: ColumnLayout; migrated: boolean } {
  if (!raw) return { layout: defaultLayout(), migrated: false };
  const parsed = JSON.parse(raw) as Partial<ColumnLayout>;
  const order = Array.isArray(parsed.order)
    ? parsed.order.filter((id) => DEFAULT_META_ORDER.includes(id))
    : [];
  // Append any columns added since the layout was saved.
  for (const id of DEFAULT_META_ORDER) {
    if (!order.includes(id)) order.push(id);
  }
  const savedHidden = Array.isArray(parsed.hidden)
    ? parsed.hidden.filter((id) => DEFAULT_META_ORDER.includes(id))
    : null;
  // Issue #77 migration: an untouched layout (hidden set exactly the build-#1
  // default of ["file_path"]) adopts the new DEFAULT_HIDDEN; any other saved
  // set wins unchanged (ruling R5 — user data is never lost).
  const migrated = savedHidden !== null && isLegacyDefaultHidden(savedHidden);
  const hidden = savedHidden === null || migrated ? [...DEFAULT_HIDDEN] : savedHidden;
  const widths =
    parsed.widths && typeof parsed.widths === "object"
      ? (parsed.widths as Record<string, number>)
      : {};
  return { layout: { order, hidden, widths }, migrated };
}

function loadLayout(): ColumnLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    const { layout, migrated } = parseLayout(raw);
    // Persist the upgraded set so the migration fires exactly once — after this
    // the stored hidden set is no longer the legacy default.
    if (migrated) saveLayout(layout);
    return layout;
  } catch {
    return defaultLayout();
  }
}

function saveLayout(layout: ColumnLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* storage unavailable */
  }
}

/**
 * The drawer's WORKING copy (§5 Apply model: the table updates only on
 * Apply). `quickSort` is the selected quick-sort segment id (null = the
 * current sort is a custom column sort the drawer leaves alone).
 */
export interface DrawerDraft {
  drawer: DrawerLines;
  quickSort: string | null;
}

interface MatrixStore {
  data: MatrixData | null;
  loading: boolean;
  /** 404 — no pipeline run yet (§7.1 empty state). */
  notReady: boolean;
  loadError: string | null;
  load: (force?: boolean) => Promise<void>;

  /** The APPLIED unified filter/sort state (single serializable object). */
  applied: MatrixFilterState;
  setApplied: (next: MatrixFilterState) => void;
  setColumnFilter: (colId: string, filter: ColumnFilter | null) => void;
  setSort: (sort: SortLevel[]) => void;
  /**
   * Free-text search box (issue #15). Writes the RAW typed string into
   * `applied.search` (the single source of truth). Applied live as the user
   * types — the visible row set is memoized on `applied`, so no debounce is
   * needed. Session-only: never persisted. `clearAll` and `clearFilters` both
   * reset it (via emptyFilterState / an explicit `search: ""`).
   */
  setSearch: (text: string) => void;
  /** Breadcrumb ✕ — resets everything (drawer lines, column filters, sort). */
  clearAll: () => void;
  /**
   * Toolbar "Clear All Filters" (issue #10) — clears EVERY filter (drawer
   * lines + `applied.columns` + the drawer draft) but PRESERVES `applied.sort`.
   * Distinct from `clearAll()`, which also nukes the sort. After this no stale
   * mirrors remain anywhere: all #7 filtered header states go dark while a
   * sorted-but-unfiltered column keeps its blue sorted state.
   */
  clearFilters: () => void;
  /** Drawer Reset — all lines off + values cleared (§5); column filters/sort kept. */
  resetDrawerLines: () => void;

  drawerOpen: boolean;
  /** Open initializes the draft from `applied` the first time (values persist across close). */
  openDrawer: () => void;
  closeDrawer: () => void;

  draft: DrawerDraft | null;
  setDraft: (draft: DrawerDraft) => void;
  /** Drawer Apply — commit draft lines (+ chosen quick sort) into `applied`. */
  applyDraft: () => void;

  /**
   * "Skip Apply" live-filter mode (issue #9). When ON, drawer draft edits are
   * committed live (the drawer calls `applyDraft` on change, debounced for
   * value inputs) and the manual Apply button is disabled. Persisted.
   *
   * UI label is "Auto-Apply" (renamed from "Skip Apply", issue #61):
   * `skipApply === true` means Auto-Apply is ON (live-apply active, Apply
   * button disabled). The flag, setter, and localStorage key deliberately keep
   * the original name — don't "fix" the mismatch, and mind the inverted
   * polarity when wiring conditions.
   */
  skipApply: boolean;
  setSkipApply: (v: boolean) => void;

  layout: ColumnLayout;
  setColumnWidth: (colId: string, width: number) => void;
  toggleColumnHidden: (colId: string) => void;
  moveColumn: (colId: string, toIndex: number) => void;
  resetLayout: () => void;

  /**
   * "My Playlists" show/hide selector (issue #13). Set of HIDDEN playlist
   * paths; a playlist column is shown iff its path is absent. Persisted to
   * localStorage; NOT touched by clearFilters (visibility is not a filter).
   */
  hiddenPlaylists: Set<string>;
  /** Show (hidden=false) or hide (hidden=true) a single playlist column. */
  setPlaylistHidden: (path: string, hidden: boolean) => void;
  /** Show all — clears the hidden set (the default all-shown state). */
  showAllPlaylists: () => void;
  /** Hide all — hides every currently-known playlist path. */
  hideAllPlaylists: (allPaths: readonly string[]) => void;
  /**
   * "Show Playlists Containing These Tracks" (issue #79). Replace the hidden
   * set so that EXACTLY `showPaths` are shown — hide every path in `allPaths`
   * not in `showPaths`. `showPaths ⊆ allPaths` is expected; extra paths are
   * simply ignored (they contribute nothing to the hidden set). An empty
   * `showPaths` hides everything ("show none"). Persisted like the other My
   * Playlists mutations; the result is an ordinary hand-editable selection.
   */
  showOnlyPlaylists: (showPaths: readonly string[], allPaths: readonly string[]) => void;
  /** Drop hidden paths that no longer exist in the payload (called on load). */
  reconcilePlaylists: (existingPaths: readonly string[]) => void;
}

export const useMatrixStore = create<MatrixStore>((set, get) => ({
  data: null,
  loading: false,
  notReady: false,
  loadError: null,

  load: async (force = false) => {
    if (get().loading) return;
    if (get().data && !force) return;
    set({ loading: true, loadError: null });
    try {
      const data = await getMatrix();
      set({ data, loading: false, notReady: false, loadError: null });
      // Drop any persisted hidden-playlist paths that no longer exist in this
      // payload (issue #13 forward-compat); new playlists stay shown by default.
      get().reconcilePlaylists(data.playlists.map((p) => p.path));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        set({ data: null, loading: false, notReady: true, loadError: null });
      } else {
        set({
          loading: false,
          loadError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },

  applied: emptyFilterState(),

  setApplied: (next) => set({ applied: cloneFilterState(next) }),

  setColumnFilter: (colId, filter) =>
    set((s) => {
      const columns = { ...s.applied.columns };
      if (filter === null || !isColumnFilterActive(filter)) {
        delete columns[colId];
      } else {
        columns[colId] = filter;
      }
      const applied = { ...s.applied, columns };
      // Issue #8 followup: openDrawer's back-fill only runs on open, so a
      // header edit while the drawer is OPEN must refresh the mirrored line in
      // the live draft too — only the edited column's line, preserving any
      // unapplied edits on the other lines. Without this the drawer shows
      // stale values AND the stale line would clobber the fresh header filter
      // on the next applyDraft / #9 live apply.
      const line = s.drawerOpen && s.draft ? lineForColumn(colId) : null;
      const draft =
        line && s.draft
          ? {
              ...s.draft,
              drawer: { ...s.draft.drawer, [line]: drawerFromApplied(applied)[line] },
            }
          : s.draft;
      return { applied, draft };
    }),

  setSort: (sort) =>
    set((s) => ({
      applied: { ...s.applied, sort },
      // Same staleness as the filter mirror above: keep an open drawer's
      // quick-sort segment tracking the live sort (openDrawer's mapping), so a
      // stale segment can't re-assert the old sort on the next applyDraft.
      draft:
        s.drawerOpen && s.draft
          ? {
              ...s.draft,
              quickSort: sort.length === 0 ? "bpm" : quickSortIdOf(sort),
            }
          : s.draft,
    })),

  setSearch: (text) => set((s) => ({ applied: { ...s.applied, search: text } })),

  clearAll: () =>
    set({
      applied: emptyFilterState(),
      draft: { drawer: emptyDrawerLines(), quickSort: "bpm" },
    }),

  clearFilters: () =>
    set((s) => ({
      // Wipe both filter surfaces (drawer lines + every column filter, incl.
      // #8's mirrored slots and any header-only facets) but keep the sort so
      // the #7 sorted-state stays lit. No mirror survives → every filtered
      // header goes dark. The free-text search box (issue #15) is a filter too,
      // so it is cleared here alongside the drawer/column filters (sort kept).
      applied: { drawer: emptyDrawerLines(), columns: {}, sort: s.applied.sort, search: "" },
      // Reset the drawer's working copy too so its live preview shows the
      // cleared state; the quick-sort selection tracks the preserved sort.
      // (There is no auto-apply effect watching `draft`, so emptying it here
      // cannot resurrect drafts under #9's Skip Apply — the drawer only
      // re-applies from explicit line edits.)
      draft: s.draft
        ? { drawer: emptyDrawerLines(), quickSort: s.draft.quickSort }
        : null,
    })),

  resetDrawerLines: () =>
    set((s) => {
      // Reset (§5) clears the drawer lines. Because the seven mappable lines now
      // live in `applied.columns` (issue #8), also clear the drawer-OWNED fields
      // of each mirrored column — preserving any header-only facets the drawer
      // does not own (blank gestures, text picklists).
      const empty = emptyDrawerLines();
      const columns = { ...s.applied.columns };
      for (const line of MAPPABLE_LINES) {
        const colId = columnIdForLine(line)!;
        const next = mirrorLineToColumn(line, empty, columns[colId]);
        if (next) columns[colId] = next;
        else delete columns[colId];
      }
      const applied = { ...s.applied, drawer: empty, columns };
      return {
        applied,
        draft: {
          drawer: drawerFromApplied(applied),
          quickSort: s.draft?.quickSort ?? "bpm",
        },
      };
    }),

  drawerOpen: false,

  openDrawer: () =>
    // Rebuild the draft from APPLIED on every open (issue #8 two-way sync) so the
    // drawer always shows current reality — including any header-set column
    // filters back-filled into the mappable lines. This intentionally discards
    // an unapplied draft on reopen (the drawer mirrors applied state, not a
    // sticky scratch copy; decision D-032).
    set((s) => ({
      drawerOpen: true,
      draft: {
        drawer: drawerFromApplied(s.applied),
        // No sort yet → the default quick-sort segment (BPM) is lit (§5).
        quickSort:
          s.applied.sort.length === 0 ? "bpm" : quickSortIdOf(s.applied.sort),
      },
    })),

  closeDrawer: () => set({ drawerOpen: false }),

  draft: null,
  setDraft: (draft) => set({ draft }),

  applyDraft: () =>
    set((s) => {
      if (!s.draft) return {};
      const quick = QUICK_SORT_BY_ID.get(s.draft.quickSort ?? "");
      const dd = s.draft.drawer;

      // Mirror each mappable drawer line into its header column (issue #8).
      // SINGLE SOURCE OF TRUTH: the mirrored dimension then lives ONLY in
      // `applied.columns`; its drawer slot is cleared below, so the filter
      // engine applies it exactly once (no double-AND, no stale mirror).
      const columns = { ...s.applied.columns };
      for (const line of MAPPABLE_LINES) {
        const colId = columnIdForLine(line)!;
        const next = mirrorLineToColumn(line, dd, columns[colId]);
        if (next) columns[colId] = next;
        else delete columns[colId];
      }

      // `applied.drawer` keeps ONLY the drawer-only line (One Playlist, ruling
      // R1); every mappable slot — now including Release Year (#60) — is cleared
      // because it lives in `columns`.
      const drawer = emptyDrawerLines();
      drawer.playlist = { ...dd.playlist };

      return {
        applied: {
          ...s.applied,
          drawer,
          columns,
          sort: quick ? quick.sort.map((l) => ({ ...l })) : s.applied.sort,
        },
      };
    }),

  skipApply: loadSkipApply(),

  setSkipApply: (v) => {
    saveSkipApply(v);
    set({ skipApply: v });
  },

  layout: loadLayout(),

  setColumnWidth: (colId, width) =>
    set((s) => {
      const clamped = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(width)));
      const layout = {
        ...s.layout,
        widths: { ...s.layout.widths, [colId]: clamped },
      };
      saveLayout(layout);
      return { layout };
    }),

  toggleColumnHidden: (colId) =>
    set((s) => {
      const hiding = !s.layout.hidden.includes(colId);
      const hidden = hiding
        ? [...s.layout.hidden, colId]
        : s.layout.hidden.filter((id) => id !== colId);
      const layout = { ...s.layout, hidden };
      saveLayout(layout);
      // #15 followup: hiding the LAST searchable text column (Artist Name /
      // Album Title / Track Name) clears the search box — the free text can no
      // longer match anything, and stale text must not silently re-engage when
      // a text column is re-shown later. Only the transition caused by hiding
      // a SEARCH column clears; hiding e.g. BPM while all three are already
      // hidden must not wipe a keyword query typed in that state.
      if (
        hiding &&
        (SEARCH_COLUMNS as readonly string[]).includes(colId) &&
        s.applied.search !== "" &&
        visibleSearchColumns(hidden).length === 0
      ) {
        return { layout, applied: { ...s.applied, search: "" } };
      }
      return { layout };
    }),

  moveColumn: (colId, toIndex) =>
    set((s) => {
      const order = s.layout.order.filter((id) => id !== colId);
      const clamped = Math.max(0, Math.min(order.length, toIndex));
      order.splice(clamped, 0, colId);
      const layout = { ...s.layout, order };
      saveLayout(layout);
      return { layout };
    }),

  resetLayout: () => {
    const layout = defaultLayout();
    saveLayout(layout);
    set({ layout });
  },

  hiddenPlaylists: loadHiddenPlaylists(),

  setPlaylistHidden: (path, hidden) =>
    set((s) => {
      const next = new Set(s.hiddenPlaylists);
      if (hidden) next.add(path);
      else next.delete(path);
      saveHiddenPlaylists(next);
      return { hiddenPlaylists: next };
    }),

  showAllPlaylists: () => {
    const next = new Set<string>();
    saveHiddenPlaylists(next);
    set({ hiddenPlaylists: next });
  },

  hideAllPlaylists: (allPaths) => {
    const next = new Set(allPaths);
    saveHiddenPlaylists(next);
    set({ hiddenPlaylists: next });
  },

  showOnlyPlaylists: (showPaths, allPaths) => {
    const show = new Set(showPaths);
    const next = new Set<string>();
    for (const p of allPaths) if (!show.has(p)) next.add(p);
    saveHiddenPlaylists(next);
    set({ hiddenPlaylists: next });
  },

  reconcilePlaylists: (existingPaths) =>
    set((s) => {
      const next = reconcileHidden(s.hiddenPlaylists, existingPaths);
      if (next.size === s.hiddenPlaylists.size) return {}; // nothing stale dropped
      saveHiddenPlaylists(next);
      return { hiddenPlaylists: next };
    }),
}));

/**
 * Playlist-column width: a user resize (persisted in `layout.widths`) wins;
 * otherwise the DEFAULT is fit to the playlist name so the full header is
 * visible (issue #6), clamped to the resize bounds. `name` is optional so
 * callers without the payload (none today) fall back to the flat default.
 */
export const playlistColWidth = (
  layout: ColumnLayout,
  colId: string,
  name?: string,
): number => {
  const override = layout.widths[colId];
  if (override != null) return override;
  if (name == null) return DEFAULT_PLAYLIST_COL_WIDTH;
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, defaultColWidth(name)));
};
