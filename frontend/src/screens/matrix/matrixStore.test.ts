/**
 * matrixStore Apply / open / reset behaviour — issue #8 drawer↔column filter
 * sync (ruling R1). Drives the real store actions to prove bidirectional
 * coherence and the single-source-of-truth invariant end to end.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useMatrixStore, reconcileHidden, parseLayout, type DrawerDraft } from "./matrixStore";
import { DEFAULT_HIDDEN, DEFAULT_META_ORDER } from "./columns";
import {
  activeFilterCount,
  columnHeaderState,
  emptyDrawerLines,
  emptyFilterState,
  hasActiveFilters,
} from "./filterState";

const ALL_KEYS = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
  "Am", "Bbm", "Bm", "Cm", "Dbm", "Dm", "Ebm", "Em", "Fm", "Gbm", "Gm", "Abm",
];

const s = () => useMatrixStore.getState();

function seedDraft(patch: (d: DrawerDraft) => void): void {
  const draft: DrawerDraft = { drawer: emptyDrawerLines(), quickSort: "bpm" };
  patch(draft);
  useMatrixStore.setState({ draft, drawerOpen: true });
}

beforeEach(() => {
  useMatrixStore.setState({
    applied: emptyFilterState(),
    draft: null,
    drawerOpen: false,
    skipApply: false,
  });
});

describe("applyDraft — drawer → column mirror", () => {
  it("mirrors a BPM drawer line into applied.columns and clears the drawer slot", () => {
    seedDraft((d) => {
      d.drawer.bpm = { on: true, min: 120, max: 124 };
    });
    s().applyDraft();

    // The BPM constraint lives ONLY in columns now (single source of truth).
    expect(s().applied.columns.bpm).toEqual({ min: 120, max: 124 });
    expect(s().applied.drawer.bpm.on).toBe(false);
    // Not double-counted — one active filter, not two.
    expect(activeFilterCount(s().applied)).toBe(1);
  });

  it("updating then clearing the drawer line updates then removes the column", () => {
    seedDraft((d) => {
      d.drawer.bpm = { on: true, min: 120, max: 124 };
    });
    s().applyDraft();

    // Re-open back-fills, user narrows the range, applies again.
    s().openDrawer();
    useMatrixStore.setState({
      draft: { drawer: { ...s().draft!.drawer, bpm: { on: true, min: 121, max: 123 } }, quickSort: "bpm" },
    });
    s().applyDraft();
    expect(s().applied.columns.bpm).toEqual({ min: 121, max: 123 });

    // Toggle the line off and apply → the mirrored column is removed.
    s().openDrawer();
    useMatrixStore.setState({
      draft: { drawer: { ...s().draft!.drawer, bpm: { on: false, min: 121, max: 123 } }, quickSort: "bpm" },
    });
    s().applyDraft();
    expect(s().applied.columns.bpm).toBeUndefined();
  });

  it("all-24 keys selected clears the key column (R1)", () => {
    seedDraft((d) => {
      d.drawer.keys = { on: true, selected: [...ALL_KEYS] };
    });
    s().applyDraft();
    expect(s().applied.columns.key).toBeUndefined();

    // A 1–23 subset mirrors to the picklist.
    seedDraft((d) => {
      d.drawer.keys = { on: true, selected: ["Gm", "Am"] };
    });
    s().applyDraft();
    expect(s().applied.columns.key).toEqual({ picked: ["Gm", "Am"] });
  });

  it("leaves the drawer-only line (One Playlist) in applied.drawer; mirrors Release Year to release_date (#60)", () => {
    seedDraft((d) => {
      d.drawer.playlist = { on: true, path: "$ROOT/RML root/discoCosmic" };
      d.drawer.releaseYear = { on: true, min: 2019, max: 2025 };
      d.drawer.bpm = { on: true, min: 118, max: 122 };
    });
    s().applyDraft();
    // One Playlist stays a drawer-only line.
    expect(s().applied.drawer.playlist).toEqual({ on: true, path: "$ROOT/RML root/discoCosmic" });
    // #60: Release Year is now mirrored into the release_date column (ISO year
    // bounds) and its drawer slot is cleared — single source of truth.
    expect(s().applied.drawer.releaseYear).toEqual({ on: false, min: null, max: null });
    expect(s().applied.columns.release_date).toEqual({ min: "2019-01-01", max: "2025-12-31" });
    expect(Object.keys(s().applied.columns).sort()).toEqual(["bpm", "release_date"]);
  });

  it("preserves a header-only facet on a mirrored column when the drawer clears it", () => {
    // Header set BPM blank + the drawer had mirrored a range earlier.
    useMatrixStore.setState({
      applied: { ...emptyFilterState(), columns: { bpm: { min: 118, max: 122, blank: "nonblank" } } },
    });
    seedDraft((d) => {
      d.drawer.bpm = { on: false, min: null, max: null };
    });
    s().applyDraft();
    // Range cleared, blank gesture preserved.
    expect(s().applied.columns.bpm).toEqual({ blank: "nonblank" });
  });
});

describe("openDrawer — column → drawer back-fill (two-way sync)", () => {
  it("preloads mappable drawer lines from header-set column filters", () => {
    useMatrixStore.setState({
      applied: {
        ...emptyFilterState(),
        columns: { bpm: { min: 118, max: 122 }, artist: { contains: "Kaskade" } },
      },
    });
    s().openDrawer();
    expect(s().draft!.drawer.bpm).toEqual({ on: true, min: 118, max: 122 });
    expect(s().draft!.drawer.artistContains).toEqual({ on: true, text: "Kaskade" });
  });

  it("reflects current reality on every open (discards an unapplied draft)", () => {
    // Stale draft with a BPM line the user never applied.
    useMatrixStore.setState({
      draft: { drawer: { ...emptyDrawerLines(), bpm: { on: true, min: 90, max: 99 } }, quickSort: "bpm" },
    });
    s().openDrawer();
    // Nothing applied → the drawer opens clean, not with the stale 90–99.
    expect(s().draft!.drawer.bpm.on).toBe(false);
  });
});

describe("setColumnFilter while drawer is OPEN — live mirror into the draft (#8 followup)", () => {
  it("a header edit on a mirrored column refreshes the open drawer's line immediately", () => {
    s().openDrawer();
    s().setColumnFilter("bpm", { min: 118, max: 122 });
    expect(s().draft!.drawer.bpm).toEqual({ on: true, min: 118, max: 122 });
  });

  it("clearing a header filter turns the open drawer's line off", () => {
    useMatrixStore.setState({
      applied: { ...emptyFilterState(), columns: { bpm: { min: 118, max: 122 } } },
    });
    s().openDrawer();
    expect(s().draft!.drawer.bpm.on).toBe(true);
    s().setColumnFilter("bpm", null);
    expect(s().draft!.drawer.bpm.on).toBe(false);
  });

  it("preserves unapplied draft edits on OTHER lines (only the edited column syncs)", () => {
    s().openDrawer();
    // User typed an artist filter in the drawer but has not applied it yet…
    useMatrixStore.setState({
      draft: {
        drawer: { ...s().draft!.drawer, artistContains: { on: true, text: "Kaskade" } },
        quickSort: "bpm",
      },
    });
    // …then edits BPM from the column header while the drawer stays open.
    s().setColumnFilter("bpm", { min: 120, max: 124 });
    expect(s().draft!.drawer.bpm).toEqual({ on: true, min: 120, max: 124 });
    expect(s().draft!.drawer.artistContains).toEqual({ on: true, text: "Kaskade" });
  });

  it("a subsequent applyDraft keeps the header-set value (no stale-draft clobber)", () => {
    s().openDrawer();
    s().setColumnFilter("bpm", { min: 118, max: 122 });
    // e.g. a #9 live apply fires next — the fresh header value must survive.
    s().applyDraft();
    expect(s().applied.columns.bpm).toEqual({ min: 118, max: 122 });
  });

  it("does not touch the draft when the drawer is closed or the column is unmirrored", () => {
    s().setColumnFilter("bpm", { min: 118, max: 122 });
    expect(s().draft).toBe(null); // drawer closed → openDrawer back-fills later

    s().openDrawer();
    const before = s().draft!;
    // playcount has no drawer counterpart (release_date is now mirrored, #60).
    s().setColumnFilter("playcount", { min: 1, max: null });
    expect(s().draft).toBe(before); // not a mirrored column → draft untouched
  });

  it("a header edit on release_date (#60) live-updates the open drawer's Release Year line", () => {
    s().openDrawer();
    s().setColumnFilter("release_date", { min: "2019-01-01", max: "2025-12-31" });
    expect(s().draft!.drawer.releaseYear).toEqual({ on: true, min: 2019, max: 2025 });
  });
});

describe("setSort while drawer is OPEN — quick-sort segment tracks the live sort", () => {
  it("a header sort updates the open drawer's quick-sort selection", () => {
    s().openDrawer();
    expect(s().draft!.quickSort).toBe("bpm"); // default segment
    s().setSort([{ col: "name", dir: "asc" }]);
    expect(s().draft!.quickSort).toBe("name");
    // A custom sort no quick-sort maps to → segment cleared, not stale.
    s().setSort([{ col: "artist", dir: "desc" }]);
    expect(s().draft!.quickSort).toBe(null);
  });

  it("a stale segment cannot re-assert the old sort on the next applyDraft", () => {
    s().openDrawer(); // quickSort seeds to "bpm"
    s().setSort([{ col: "artist", dir: "desc" }]); // header sort while open
    s().applyDraft(); // e.g. a #9 live apply
    expect(s().applied.sort).toEqual([{ col: "artist", dir: "desc" }]);
  });
});

describe("skipApply — live-filter toggle (issue #9)", () => {
  it("defaults off; Apply button (bound to skipApply) is therefore enabled", () => {
    expect(s().skipApply).toBe(false);
  });

  it("setSkipApply flips the flag that disables the Apply button", () => {
    s().setSkipApply(true);
    expect(s().skipApply).toBe(true); // Apply button renders disabled while on
    s().setSkipApply(false);
    expect(s().skipApply).toBe(false); // back to manual-Apply mode
  });

  it("live apply routes through applyDraft — a BPM edit lands in applied.columns (mirror intact, #8)", () => {
    // Simulate the drawer's live-apply path: Skip Apply on, draft edited, then
    // the drawer commits by calling the SAME applyDraft the Apply button uses.
    s().setSkipApply(true);
    seedDraft((d) => {
      d.drawer.bpm = { on: true, min: 120, max: 124 };
    });
    s().applyDraft();

    // #8 single-source-of-truth mirror holds under live apply: the constraint
    // is projected into applied.columns and the drawer slot is cleared.
    expect(s().applied.columns.bpm).toEqual({ min: 120, max: 124 });
    expect(s().applied.drawer.bpm.on).toBe(false);
    expect(activeFilterCount(s().applied)).toBe(1);
  });

  it("repeated live applies from an evolving draft re-mirror coherently (no stale/double filter)", () => {
    s().setSkipApply(true);
    seedDraft((d) => {
      d.drawer.bpm = { on: true, min: 120, max: 124 };
    });
    s().applyDraft();
    // The draft (drawer's working copy) keeps the mappable line; a later edit +
    // live apply narrows the mirrored column rather than duplicating it.
    useMatrixStore.setState({
      draft: {
        drawer: { ...s().draft!.drawer, bpm: { on: true, min: 121, max: 123 } },
        quickSort: "bpm",
      },
    });
    s().applyDraft();
    expect(s().applied.columns.bpm).toEqual({ min: 121, max: 123 });
    expect(activeFilterCount(s().applied)).toBe(1);
  });
});

describe("clearFilters — toolbar Clear All Filters (issue #10)", () => {
  it("clears drawer lines + every column filter + the draft, but PRESERVES sort", () => {
    useMatrixStore.setState({
      applied: {
        drawer: { ...emptyDrawerLines(), releaseYear: { on: true, min: 2019, max: 2025 } },
        columns: {
          bpm: { min: 118, max: 122 },
          key: { picked: ["Gm"], blank: "nonblank" },
          artist: { contains: "Kaskade" },
        },
        sort: [{ col: "release_date", dir: "desc" }],
        search: "",
      },
      draft: { drawer: { ...emptyDrawerLines(), bpm: { on: true, min: 118, max: 122 } }, quickSort: "release" },
      drawerOpen: true,
    });

    s().clearFilters();

    // Both filter surfaces emptied — including header-only facets (blank).
    expect(s().applied.columns).toEqual({});
    expect(s().applied.drawer).toEqual(emptyDrawerLines());
    expect(hasActiveFilters(s().applied)).toBe(false);
    expect(activeFilterCount(s().applied)).toBe(0);

    // Sort survives (this is the whole point vs. clearAll).
    expect(s().applied.sort).toEqual([{ col: "release_date", dir: "desc" }]);

    // The drawer's working copy is reset to a clean slate; its quick-sort
    // selection still tracks the preserved sort.
    expect(s().draft!.drawer).toEqual(emptyDrawerLines());
    expect(s().draft!.quickSort).toBe("release");
  });

  it("post-clear header states: filtered columns go dark, a sorted column stays sorted (#7)", () => {
    useMatrixStore.setState({
      applied: {
        drawer: emptyDrawerLines(),
        // bpm is filtered; name is sorted-but-not-filtered.
        columns: { bpm: { min: 120, max: 124 } },
        sort: [{ col: "name", dir: "asc" }],
        search: "",
      },
      draft: null,
      drawerOpen: false,
    });
    // Precondition: bpm reads as filtered, name as sorted.
    expect(columnHeaderState(s().applied, "bpm")).toBe("filtered");
    expect(columnHeaderState(s().applied, "name")).toBe("sorted");

    s().clearFilters();

    // Filtered header goes dark; the sorted-only header keeps its blue state.
    expect(columnHeaderState(s().applied, "bpm")).toBe(null);
    expect(columnHeaderState(s().applied, "name")).toBe("sorted");
    // draft was null (drawer closed) → stays null (openDrawer rebuilds it).
    expect(s().draft).toBe(null);
  });

  it("does NOT reuse clearAll: sort is kept where clearAll would drop it", () => {
    useMatrixStore.setState({
      applied: { ...emptyFilterState(), columns: { bpm: { min: 120, max: 124 } }, sort: [{ col: "bpm", dir: "asc" }] },
    });
    s().clearFilters();
    expect(s().applied.sort).toEqual([{ col: "bpm", dir: "asc" }]);
    // Contrast: clearAll would have wiped it.
    s().clearAll();
    expect(s().applied.sort).toEqual([]);
  });

  it("under #9 Skip Apply, clearing empties the draft and does not resurrect it", () => {
    // Live-apply ON, a mirrored filter applied, drawer open with a matching draft.
    s().setSkipApply(true);
    useMatrixStore.setState({
      applied: { ...emptyFilterState(), columns: { bpm: { min: 120, max: 124 } }, sort: [{ col: "bpm", dir: "asc" }] },
      draft: { drawer: { ...emptyDrawerLines(), bpm: { on: true, min: 120, max: 124 } }, quickSort: "bpm" },
      drawerOpen: true,
    });

    s().clearFilters();

    // Filters gone, draft cleared — nothing re-mirrors the old BPM range back
    // in (clearFilters never routes through applyDraft; no watcher re-applies).
    expect(s().applied.columns).toEqual({});
    expect(s().draft!.drawer).toEqual(emptyDrawerLines());
    // Skip Apply preference itself is untouched.
    expect(s().skipApply).toBe(true);
    expect(s().applied.sort).toEqual([{ col: "bpm", dir: "asc" }]);
  });
});

describe("hiddenPlaylists — My Playlists show/hide selector (issue #13)", () => {
  const A = "$ROOT/RML root/discoCosmic";
  const B = "$ROOT/RML root/houseDeep";
  const C = "$ROOT/setX";

  beforeEach(() => {
    useMatrixStore.setState({ hiddenPlaylists: new Set() });
  });

  it("defaults to all shown (empty hidden set)", () => {
    expect(s().hiddenPlaylists.size).toBe(0);
  });

  it("setPlaylistHidden hides then shows a single playlist by path", () => {
    s().setPlaylistHidden(A, true);
    expect(s().hiddenPlaylists.has(A)).toBe(true);
    expect(s().hiddenPlaylists.has(B)).toBe(false);
    // Re-showing removes it (idempotent identity by path).
    s().setPlaylistHidden(A, false);
    expect(s().hiddenPlaylists.has(A)).toBe(false);
  });

  it("hideAllPlaylists hides the full set; showAllPlaylists clears it", () => {
    s().hideAllPlaylists([A, B, C]);
    expect([...s().hiddenPlaylists].sort()).toEqual([A, B, C].sort());
    s().showAllPlaylists();
    expect(s().hiddenPlaylists.size).toBe(0);
  });

  it("showOnlyPlaylists shows exactly the given subset, hiding the rest (#79)", () => {
    // Show only A and C → B is the sole hidden path.
    s().showOnlyPlaylists([A, C], [A, B, C]);
    expect(s().hiddenPlaylists.has(A)).toBe(false);
    expect(s().hiddenPlaylists.has(C)).toBe(false);
    expect(s().hiddenPlaylists.has(B)).toBe(true);
    expect([...s().hiddenPlaylists]).toEqual([B]);
  });

  it("showOnlyPlaylists with an empty subset hides everything ('show none', #79)", () => {
    s().showOnlyPlaylists([], [A, B, C]);
    expect([...s().hiddenPlaylists].sort()).toEqual([A, B, C].sort());
  });

  it("showOnlyPlaylists replaces any prior selection wholesale (#79)", () => {
    s().hideAllPlaylists([A, B, C]); // start all hidden
    s().showOnlyPlaylists([B], [A, B, C]);
    // Only B shown afterwards regardless of the prior hidden set.
    expect(s().hiddenPlaylists.has(B)).toBe(false);
    expect(s().hiddenPlaylists.has(A)).toBe(true);
    expect(s().hiddenPlaylists.has(C)).toBe(true);
  });

  it("reconcilePlaylists drops stale paths and keeps ones that still exist", () => {
    s().hideAllPlaylists([A, B, C]);
    // A later payload no longer has C but adds a new playlist D (never hidden).
    s().reconcilePlaylists([A, B, "$ROOT/newlyAdded"]);
    expect(s().hiddenPlaylists.has(A)).toBe(true);
    expect(s().hiddenPlaylists.has(B)).toBe(true);
    expect(s().hiddenPlaylists.has(C)).toBe(false); // stale → dropped
    // A brand-new playlist is not in the set → shown by default.
    expect(s().hiddenPlaylists.has("$ROOT/newlyAdded")).toBe(false);
  });

  it("reconcileHidden (pure) removes only stale paths, never adds", () => {
    const before = new Set([A, B, C]);
    const after = reconcileHidden(before, [A, B]);
    expect([...after].sort()).toEqual([A, B].sort());
    // A path present in the payload but not hidden stays absent (defaults shown).
    expect(reconcileHidden(new Set([A]), [A, B]).has(B)).toBe(false);
  });

  it("clearFilters does NOT touch playlist visibility (visibility is not a filter)", () => {
    s().hideAllPlaylists([A, B]);
    s().setPlaylistHidden(A, false); // subset: A shown, B hidden
    useMatrixStore.setState({
      applied: { ...emptyFilterState(), columns: { bpm: { min: 120, max: 124 } } },
    });
    s().clearFilters();
    // Filters gone…
    expect(s().applied.columns).toEqual({});
    // …but the playlist selection is untouched.
    expect(s().hiddenPlaylists.has(A)).toBe(false);
    expect(s().hiddenPlaylists.has(B)).toBe(true);
  });
});

describe("free-text search box (issue #15) — store + state semantics", () => {
  it("setSearch stores the RAW string verbatim (source of truth for #24)", () => {
    // Case, internal spacing, and leading/trailing whitespace are all preserved
    // in state — the predicate trims/lower-cases a derived copy, not the source.
    s().setSearch("  Disco Cosmic  ");
    expect(s().applied.search).toBe("  Disco Cosmic  ");
  });

  it("a non-empty (trimmed) search counts as one active filter — badge + hasActiveFilters", () => {
    s().setSearch("disclosure");
    expect(hasActiveFilters(s().applied)).toBe(true);
    expect(activeFilterCount(s().applied)).toBe(1);
  });

  it("a whitespace-only search does NOT count as active", () => {
    s().setSearch("   ");
    expect(hasActiveFilters(s().applied)).toBe(false);
    expect(activeFilterCount(s().applied)).toBe(0);
  });

  it("search adds to the badge alongside other filters", () => {
    useMatrixStore.setState({
      applied: { ...emptyFilterState(), columns: { bpm: { min: 120, max: 124 } } },
    });
    s().setSearch("disclosure");
    // bpm (1) + search (1)
    expect(activeFilterCount(s().applied)).toBe(2);
  });

  it("clearFilters clears the search but preserves the sort", () => {
    useMatrixStore.setState({
      applied: {
        ...emptyFilterState(),
        columns: { bpm: { min: 120, max: 124 } },
        sort: [{ col: "bpm", dir: "asc" }],
        search: "disclosure",
      },
    });
    s().clearFilters();
    expect(s().applied.search).toBe("");
    expect(s().applied.sort).toEqual([{ col: "bpm", dir: "asc" }]);
    expect(hasActiveFilters(s().applied)).toBe(false);
  });

  it("clearAll clears the search too (along with everything else)", () => {
    useMatrixStore.setState({
      applied: { ...emptyFilterState(), search: "disclosure", sort: [{ col: "bpm", dir: "asc" }] },
    });
    s().clearAll();
    expect(s().applied.search).toBe("");
    expect(s().applied.sort).toEqual([]); // clearAll nukes sort (unlike clearFilters)
  });

  it("the in-box ✕ (setSearch '') clears only the search, leaving other filters intact", () => {
    useMatrixStore.setState({
      applied: { ...emptyFilterState(), columns: { bpm: { min: 120, max: 124 } }, search: "disclosure" },
    });
    s().setSearch(""); // the ✕ affordance
    expect(s().applied.search).toBe("");
    expect(s().applied.columns.bpm).toEqual({ min: 120, max: 124 }); // untouched
  });
});

describe("toggleColumnHidden × search (#15 followup) — hiding the last text column clears the box", () => {
  const layoutWithHidden = (hidden: string[]) => ({ ...s().layout, hidden });

  it("hiding the LAST visible text column clears a non-empty search", () => {
    useMatrixStore.setState({
      layout: layoutWithHidden(["artist", "album"]),
      applied: { ...emptyFilterState(), search: "disclosure" },
    });
    s().toggleColumnHidden("name"); // hides the last of the three
    expect(s().layout.hidden).toContain("name");
    expect(s().applied.search).toBe("");
  });

  it("hiding a text column while another remains visible keeps the search", () => {
    useMatrixStore.setState({
      layout: layoutWithHidden([]),
      applied: { ...emptyFilterState(), search: "disclosure" },
    });
    s().toggleColumnHidden("artist");
    expect(s().applied.search).toBe("disclosure");
  });

  it("hiding a NON-text column with all three already hidden keeps a keyword query", () => {
    // A query typed in the keyword-only state (all text columns hidden) must
    // survive unrelated column toggles.
    useMatrixStore.setState({
      layout: layoutWithHidden(["artist", "album", "name"]),
      applied: { ...emptyFilterState(), search: "BPM=120" },
    });
    s().toggleColumnHidden("bpm");
    expect(s().applied.search).toBe("BPM=120");
  });

  it("re-SHOWING a text column never touches the search", () => {
    useMatrixStore.setState({
      layout: layoutWithHidden(["artist", "album", "name"]),
      applied: { ...emptyFilterState(), search: "Key=8A" },
    });
    s().toggleColumnHidden("artist"); // un-hide
    expect(s().layout.hidden).toEqual(["album", "name"]);
    expect(s().applied.search).toBe("Key=8A");
  });

  it("the clear touches ONLY the search — other applied filters survive", () => {
    useMatrixStore.setState({
      layout: layoutWithHidden(["artist", "album"]),
      applied: {
        ...emptyFilterState(),
        search: "disclosure",
        columns: { bpm: { min: 120, max: 124 } },
        sort: [{ col: "bpm", dir: "asc" }],
      },
    });
    s().toggleColumnHidden("name");
    expect(s().applied.search).toBe("");
    expect(s().applied.columns.bpm).toEqual({ min: 120, max: 124 });
    expect(s().applied.sort).toEqual([{ col: "bpm", dir: "asc" }]);
  });
});

describe("parseLayout — #77 default-hidden set + one-time migration (ruling R5)", () => {
  const layoutOf = (partial: Record<string, unknown>) =>
    JSON.stringify(partial);

  it("the new default hidden set is Last Played, Album Title, File Path (spec order)", () => {
    expect([...DEFAULT_HIDDEN]).toEqual(["last_played", "album", "file_path"]);
  });

  it("fresh install (no saved layout) → new defaults, no migration", () => {
    const { layout, migrated } = parseLayout(null);
    expect(layout.hidden).toEqual(["last_played", "album", "file_path"]);
    expect(layout.order).toEqual([...DEFAULT_META_ORDER]);
    expect(migrated).toBe(false);
  });

  it("untouched legacy layout (hidden exactly [file_path]) → migrates once to new defaults", () => {
    const { layout, migrated } = parseLayout(
      layoutOf({ order: [...DEFAULT_META_ORDER], hidden: ["file_path"], widths: {} }),
    );
    expect(migrated).toBe(true);
    expect(layout.hidden).toEqual(["last_played", "album", "file_path"]);
  });

  it("re-parsing an already-migrated layout does NOT migrate again (idempotent)", () => {
    const once = parseLayout(
      layoutOf({ order: [...DEFAULT_META_ORDER], hidden: ["file_path"], widths: {} }),
    );
    const twice = parseLayout(
      layoutOf({ order: once.layout.order, hidden: once.layout.hidden, widths: {} }),
    );
    expect(twice.migrated).toBe(false);
    expect(twice.layout.hidden).toEqual(["last_played", "album", "file_path"]);
  });

  it("customized visibility is preserved verbatim — no migration", () => {
    const { layout, migrated } = parseLayout(
      layoutOf({ order: [...DEFAULT_META_ORDER], hidden: ["import_date", "file_path"], widths: {} }),
    );
    expect(migrated).toBe(false);
    expect(layout.hidden).toEqual(["import_date", "file_path"]);
  });

  it("user who showed EVERYTHING (empty hidden set) is preserved — [] is a choice, not the legacy default", () => {
    const { layout, migrated } = parseLayout(
      layoutOf({ order: [...DEFAULT_META_ORDER], hidden: [], widths: {} }),
    );
    expect(migrated).toBe(false);
    expect(layout.hidden).toEqual([]);
  });

  it("a saved set that already equals the new default is left alone (not re-migrated)", () => {
    const { layout, migrated } = parseLayout(
      layoutOf({ order: [...DEFAULT_META_ORDER], hidden: ["last_played", "album", "file_path"], widths: {} }),
    );
    expect(migrated).toBe(false);
    expect(layout.hidden).toEqual(["last_played", "album", "file_path"]);
  });

  it("a customized set that hides file_path plus others is preserved (order-sensitive, not the legacy default)", () => {
    const { layout, migrated } = parseLayout(
      layoutOf({ order: [...DEFAULT_META_ORDER], hidden: ["file_path", "playcount"], widths: {} }),
    );
    expect(migrated).toBe(false);
    expect(layout.hidden).toEqual(["file_path", "playcount"]);
  });

  it("stale/unknown hidden ids are dropped; a legacy-default remnant still migrates", () => {
    const { layout, migrated } = parseLayout(
      layoutOf({ hidden: ["file_path", "bogus_removed_col"], widths: {} }),
    );
    // bogus id filtered out → real hidden set is exactly [file_path] → migrate.
    expect(migrated).toBe(true);
    expect(layout.hidden).toEqual(["last_played", "album", "file_path"]);
  });

  it("saved widths and reordered columns survive the parse", () => {
    const reordered = [...DEFAULT_META_ORDER].slice().reverse();
    const { layout } = parseLayout(
      layoutOf({ order: reordered, hidden: ["import_date"], widths: { bpm: 200 } }),
    );
    expect(layout.order).toEqual(reordered);
    expect(layout.widths).toEqual({ bpm: 200 });
  });

  it("malformed hidden field falls back to new defaults, no migration", () => {
    const { layout, migrated } = parseLayout(layoutOf({ hidden: "nope" }));
    expect(migrated).toBe(false);
    expect(layout.hidden).toEqual(["last_played", "album", "file_path"]);
  });
});

describe("resetLayout — Reset Columns restores the new default hidden set (#77)", () => {
  it("rebuilds hidden/order/widths from the current defaults, untouched My Playlists", () => {
    useMatrixStore.setState({
      layout: { order: [...DEFAULT_META_ORDER].reverse(), hidden: ["import_date"], widths: { bpm: 300 } },
      hiddenPlaylists: new Set(["$ROOT/keepMe"]),
    });
    s().resetLayout();
    expect(s().layout.hidden).toEqual(["last_played", "album", "file_path"]);
    expect(s().layout.order).toEqual([...DEFAULT_META_ORDER]);
    expect(s().layout.widths).toEqual({});
    // Reset Columns does not touch the My Playlists hidden set.
    expect(s().hiddenPlaylists.has("$ROOT/keepMe")).toBe(true);
  });
});

describe("resetDrawerLines — clears mirrored columns, keeps header-only facets", () => {
  it("clears the drawer-owned column filters but preserves a blank gesture", () => {
    useMatrixStore.setState({
      applied: {
        ...emptyFilterState(),
        columns: {
          bpm: { min: 118, max: 122 },
          key: { picked: ["Gm"], blank: "nonblank" },
        },
        sort: [{ col: "bpm", dir: "asc" }],
      },
    });
    s().resetDrawerLines();
    expect(s().applied.columns.bpm).toBeUndefined(); // fully owned → gone
    expect(s().applied.columns.key).toEqual({ blank: "nonblank" }); // picked gone, blank kept
    // Sort is untouched by a drawer reset.
    expect(s().applied.sort).toEqual([{ col: "bpm", dir: "asc" }]);
  });
});
