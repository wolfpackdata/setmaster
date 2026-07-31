/**
 * Unified filter/sort state contract tests — the state must stay ONE
 * JSON-serializable plain object (CLAUDE.md hard constraint; the deferred NL
 * prompt bar emits into this shape).
 */

import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  cloneFilterState,
  columnHeaderState,
  columnIdForLine,
  columnsWithoutMirroredLines,
  drawerFromApplied,
  emptyDrawerLines,
  emptyFilterState,
  hasActiveFilters,
  isColumnFilterActive,
  isLineEffective,
  isPlaylistCol,
  lineForColumn,
  MAPPABLE_LINES,
  mirrorLineToColumn,
  playlistColId,
  playlistPathOfCol,
  quickSortIdOf,
  QUICK_SORTS,
  type DrawerLines,
} from "./filterState";

/** The 24 canonical flats keys (matches lib/keys CANONICAL_KEYS ordering). */
const ALL_KEYS = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
  "Am", "Bbm", "Bm", "Cm", "Dbm", "Dm", "Ebm", "Em", "Fm", "Gbm", "Gm", "Abm",
];

/** A drawer-lines object with the named line armed to the given value. */
function drawerWith<K extends keyof DrawerLines>(
  line: K,
  value: DrawerLines[K],
): DrawerLines {
  const d = emptyDrawerLines();
  d[line] = value;
  return d;
}

describe("serializability contract", () => {
  it("round-trips through JSON without loss", () => {
    const s = emptyFilterState();
    s.drawer.playlist = { on: true, path: "$ROOT/RML root/discoCosmic" };
    s.drawer.bpm = { on: true, min: 118, max: 122 };
    s.drawer.keys = { on: true, selected: ["Gm", "Am"] };
    s.columns["pl:$ROOT/wip/setX"] = { blank: "nonblank" };
    s.columns["playcount"] = { min: 0, max: 1 };
    s.sort = [{ col: "import_date", dir: "asc" }];
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(cloneFilterState(s)).toEqual(s);
    expect(cloneFilterState(s)).not.toBe(s);
  });
});

describe("playlist column ids", () => {
  it("prefixes with pl: and round-trips the playlist_path", () => {
    const id = playlistColId("$ROOT/RML root/discoCosmic");
    expect(isPlaylistCol(id)).toBe(true);
    expect(isPlaylistCol("bpm")).toBe(false);
    expect(playlistPathOfCol(id)).toBe("$ROOT/RML root/discoCosmic");
  });
});

describe("line effectiveness / active counting", () => {
  it("a line must be ON and carry values to count (keys: ON alone counts)", () => {
    const s = emptyFilterState();
    expect(hasActiveFilters(s)).toBe(false);
    s.drawer.bpm = { on: true, min: null, max: null };
    expect(isLineEffective(s.drawer, "bpm")).toBe(false);
    s.drawer.bpm.min = 118;
    expect(isLineEffective(s.drawer, "bpm")).toBe(true);
    s.drawer.keys = { on: true, selected: [] };
    expect(isLineEffective(s.drawer, "keys")).toBe(true);
    expect(activeFilterCount(s)).toBe(2);
  });

  it("column filter activity ignores empty shells", () => {
    expect(isColumnFilterActive(undefined)).toBe(false);
    expect(isColumnFilterActive({})).toBe(false);
    expect(isColumnFilterActive({ contains: "  " })).toBe(false);
    expect(isColumnFilterActive({ contains: "x" })).toBe(true);
    expect(isColumnFilterActive({ min: 0 })).toBe(true); // 0 is a real bound
    expect(isColumnFilterActive({ picked: [] })).toBe(false);
    expect(isColumnFilterActive({ blank: "blank" })).toBe(true);
  });
});

describe("quick sorts (§5 — default first: BPM)", () => {
  it("offers the five specced options with BPM first", () => {
    expect(QUICK_SORTS.map((q) => q.id)).toEqual([
      "bpm",
      "release",
      "import",
      "name",
      "key",
    ]);
    expect(QUICK_SORTS[0].sort).toEqual([{ col: "bpm", dir: "asc" }]);
    expect(QUICK_SORTS[1].sort).toEqual([{ col: "release_date", dir: "desc" }]);
    expect(QUICK_SORTS[2].sort).toEqual([{ col: "import_date", dir: "desc" }]);
  });

  it("recognizes the current sort as a quick-sort id (or null when custom)", () => {
    expect(quickSortIdOf([{ col: "bpm", dir: "asc" }])).toBe("bpm");
    expect(quickSortIdOf([{ col: "bpm", dir: "desc" }])).toBeNull();
    expect(
      quickSortIdOf([
        { col: "bpm", dir: "asc" },
        { col: "key", dir: "asc" },
      ]),
    ).toBeNull();
    expect(quickSortIdOf([])).toBeNull();
  });
});

describe("columnHeaderState (issue #7 — orange filtered wins over blue sorted)", () => {
  it("returns null for a column that is neither filtered nor sorted", () => {
    const s = emptyFilterState();
    s.columns["bpm"] = { min: 118, max: 122 };
    s.sort = [{ col: "bpm", dir: "asc" }];
    expect(columnHeaderState(s, "key")).toBeNull();
  });

  it("returns 'sorted' for a sorted-but-unfiltered column (blue)", () => {
    const s = emptyFilterState();
    s.sort = [{ col: "import_date", dir: "desc" }];
    expect(columnHeaderState(s, "import_date")).toBe("sorted");
  });

  it("returns 'filtered' for a filtered-but-unsorted column (orange)", () => {
    const s = emptyFilterState();
    s.columns["artist"] = { contains: "moroder" };
    expect(columnHeaderState(s, "artist")).toBe("filtered");
  });

  it("returns 'filtered' when a column is BOTH filtered and sorted (orange wins)", () => {
    const s = emptyFilterState();
    s.columns["bpm"] = { min: 118, max: 122 };
    s.sort = [{ col: "bpm", dir: "asc" }];
    expect(columnHeaderState(s, "bpm")).toBe("filtered");
  });

  it("treats an empty/no-op column filter as not filtered", () => {
    const s = emptyFilterState();
    s.columns["name"] = { contains: "   " }; // whitespace-only = inactive
    s.sort = [{ col: "name", dir: "asc" }];
    // No effective filter → falls through to the blue sorted state.
    expect(columnHeaderState(s, "name")).toBe("sorted");
  });

  it("works for playlist columns keyed by pl:<path>", () => {
    const s = emptyFilterState();
    const col = playlistColId("$ROOT/RML root/discoCosmic");
    s.columns[col] = { blank: "nonblank" };
    expect(columnHeaderState(s, col)).toBe("filtered");
  });
});

// ---------------------------------------------------------------------------
// Issue #8 — drawer ↔ column-header filter sync (ruling R1)
// ---------------------------------------------------------------------------

describe("issue #8 — mappable line ↔ column mapping (R1; #60 adds Release Year)", () => {
  it("maps the eight clean 1:1 pairs incl. Release Year→release_date; only One Playlist is drawer-only", () => {
    expect(columnIdForLine("bpm")).toBe("bpm");
    expect(columnIdForLine("keys")).toBe("key");
    expect(columnIdForLine("releaseYear")).toBe("release_date"); // #60
    expect(columnIdForLine("importDate")).toBe("import_date");
    expect(columnIdForLine("artistContains")).toBe("artist");
    expect(columnIdForLine("trackContains")).toBe("name");
    expect(columnIdForLine("onRootPl")).toBe("root");
    expect(columnIdForLine("onNonRootPl")).toBe("nonroot");
    // One Playlist remains the only drawer-only line (no column mirror).
    expect(columnIdForLine("playlist")).toBeNull();
    expect(MAPPABLE_LINES).toHaveLength(8);
    expect(MAPPABLE_LINES).toContain("releaseYear");
    expect(MAPPABLE_LINES).not.toContain("playlist");
  });

  it("inverts columns back to their line (non-mirrored columns → null)", () => {
    expect(lineForColumn("bpm")).toBe("bpm");
    expect(lineForColumn("key")).toBe("keys");
    expect(lineForColumn("root")).toBe("onRootPl");
    expect(lineForColumn("release_date")).toBe("releaseYear"); // #60
    // Columns with no drawer counterpart.
    expect(lineForColumn("playcount")).toBeNull();
    expect(lineForColumn("last_played")).toBeNull();
    expect(lineForColumn(playlistColId("$ROOT/x"))).toBeNull();
  });
});

describe("issue #8 — mirrorLineToColumn (drawer → column)", () => {
  it("mirrors a BPM range; updates and clears it", () => {
    expect(mirrorLineToColumn("bpm", drawerWith("bpm", { on: true, min: 118, max: 122 }), undefined))
      .toEqual({ min: 118, max: 122 });
    // Update over an existing mirror.
    expect(mirrorLineToColumn("bpm", drawerWith("bpm", { on: true, min: 120, max: 124 }), { min: 118, max: 122 }))
      .toEqual({ min: 120, max: 124 });
    // Toggled off → clears (returns null so the caller deletes the column).
    expect(mirrorLineToColumn("bpm", drawerWith("bpm", { on: false, min: 118, max: 122 }), { min: 118, max: 122 }))
      .toBeNull();
    // Min-only bound survives.
    expect(mirrorLineToColumn("bpm", drawerWith("bpm", { on: true, min: 118, max: null }), undefined))
      .toEqual({ min: 118 });
  });

  it("mirrors a 1–23 key subset to picked; all-24 (and 0) clear the key column", () => {
    expect(mirrorLineToColumn("keys", drawerWith("keys", { on: true, selected: ["Gm", "Am"] }), undefined))
      .toEqual({ picked: ["Gm", "Am"] });
    // All 24 selected = "show all keys" = no constraint → clears.
    expect(mirrorLineToColumn("keys", drawerWith("keys", { on: true, selected: [...ALL_KEYS] }), { picked: ["Gm"] }))
      .toBeNull();
    // Degenerate 0-selected normalises to "no key constraint".
    expect(mirrorLineToColumn("keys", drawerWith("keys", { on: true, selected: [] }), undefined))
      .toBeNull();
    // Off → clears.
    expect(mirrorLineToColumn("keys", drawerWith("keys", { on: false, selected: ["Gm"] }), { picked: ["Gm"] }))
      .toBeNull();
  });

  it("mirrors text contains, count bounds and import date", () => {
    expect(mirrorLineToColumn("artistContains", drawerWith("artistContains", { on: true, text: " Kaskade " }), undefined))
      .toEqual({ contains: "Kaskade" });
    expect(mirrorLineToColumn("trackContains", drawerWith("trackContains", { on: true, text: "Remix" }), undefined))
      .toEqual({ contains: "Remix" });
    expect(mirrorLineToColumn("onRootPl", drawerWith("onRootPl", { on: true, min: 1 }), undefined))
      .toEqual({ min: 1 });
    expect(mirrorLineToColumn("onNonRootPl", drawerWith("onNonRootPl", { on: true, min: 0, max: 0 }), undefined))
      .toEqual({ min: 0, max: 0 });
    expect(mirrorLineToColumn("importDate", drawerWith("importDate", { on: true, min: "2020-01-01", max: "2025-12-31" }), undefined))
      .toEqual({ min: "2020-01-01", max: "2025-12-31" });
  });

  it("mirrors Release Year to the release_date column as ISO Jan-1/Dec-31 bounds (#60)", () => {
    expect(mirrorLineToColumn("releaseYear", drawerWith("releaseYear", { on: true, min: 2019, max: 2025 }), undefined))
      .toEqual({ min: "2019-01-01", max: "2025-12-31" });
    // Min-only (e.g. "2020 onward") and max-only ("Before 1970") bounds.
    expect(mirrorLineToColumn("releaseYear", drawerWith("releaseYear", { on: true, min: 2020, max: null }), undefined))
      .toEqual({ min: "2020-01-01" });
    expect(mirrorLineToColumn("releaseYear", drawerWith("releaseYear", { on: true, min: null, max: 1969 }), undefined))
      .toEqual({ max: "1969-12-31" });
    // Toggled off → clears; a header-only blank facet survives.
    expect(mirrorLineToColumn("releaseYear", drawerWith("releaseYear", { on: false, min: 2019, max: 2025 }), { min: "2019-01-01", max: "2025-12-31" }))
      .toBeNull();
    expect(mirrorLineToColumn("releaseYear", drawerWith("releaseYear", { on: false, min: null, max: null }), { min: "2019-01-01", max: "2025-12-31", blank: "nonblank" }))
      .toEqual({ blank: "nonblank" });
  });

  it("PRESERVES header-only facets the drawer does not own (blank, text picklist)", () => {
    // Clearing the BPM line keeps a header blank gesture on the same column.
    expect(mirrorLineToColumn("bpm", drawerWith("bpm", { on: false, min: null, max: null }), { min: 118, max: 122, blank: "nonblank" }))
      .toEqual({ blank: "nonblank" });
    // Artist contains merges with an existing header picklist.
    expect(mirrorLineToColumn("artistContains", drawerWith("artistContains", { on: true, text: "kas" }), { picked: ["Kaskade"] }))
      .toEqual({ picked: ["Kaskade"], contains: "kas" });
  });
});

describe("issue #8 — drawerFromApplied (column → drawer back-fill)", () => {
  it("reconstructs each mappable line from its header column filter", () => {
    const s = emptyFilterState();
    s.columns = {
      bpm: { min: 118, max: 122 },
      key: { picked: ["Gm", "Am"] },
      release_date: { min: "2019-01-01", max: "2025-12-31" },
      import_date: { min: "2020-01-01", max: "2025-12-31" },
      artist: { contains: "Kaskade" },
      name: { contains: "Remix" },
      root: { min: 1 },
      nonroot: { min: 0, max: 0 },
    };
    const d = drawerFromApplied(s);
    expect(d.bpm).toEqual({ on: true, min: 118, max: 122 });
    expect(d.keys).toEqual({ on: true, selected: ["Gm", "Am"] });
    // #60: the year-only release_date column back-fills to plain years.
    expect(d.releaseYear).toEqual({ on: true, min: 2019, max: 2025 });
    expect(d.importDate).toEqual({ on: true, min: "2020-01-01", max: "2025-12-31" });
    expect(d.artistContains).toEqual({ on: true, text: "Kaskade" });
    expect(d.trackContains).toEqual({ on: true, text: "Remix" });
    expect(d.onRootPl).toEqual({ on: true, min: 1 });
    expect(d.onNonRootPl).toEqual({ on: true, min: 0, max: 0 });
  });

  it("back-fills a max-only Release Year (Before 1970) from the column", () => {
    const s = emptyFilterState();
    s.columns = { release_date: { max: "1969-12-31" } };
    expect(drawerFromApplied(s).releaseYear).toEqual({ on: true, min: null, max: 1969 });
  });

  it("takes the drawer-only line (One Playlist) straight from applied.drawer", () => {
    const s = emptyFilterState();
    s.drawer.playlist = { on: true, path: "$ROOT/RML root/discoCosmic" };
    const d = drawerFromApplied(s);
    expect(d.playlist).toEqual({ on: true, path: "$ROOT/RML root/discoCosmic" });
    // No mirrored columns → mappable lines (incl. Release Year) stay off.
    expect(d.bpm.on).toBe(false);
    expect(d.keys.on).toBe(false);
    expect(d.releaseYear.on).toBe(false);
  });

  it("leaves the keys line off when the key column carries only a non-picked facet", () => {
    const s = emptyFilterState();
    s.columns = { key: { blank: "blank" } };
    expect(drawerFromApplied(s).keys).toEqual({ on: false, selected: [] });
  });
});

describe("issue #8 — columnsWithoutMirroredLines (preview de-dup)", () => {
  it("strips a mirrored column's OWNED fields, keeps header-only facets and non-mirrored columns", () => {
    const cols = {
      bpm: { min: 118, max: 122 }, // fully owned → dropped
      key: { picked: ["Gm"], blank: "nonblank" as const }, // picked owned, blank kept
      root: { min: 1, max: 3 }, // onRootPl owns min only → max survives
      release_date: { min: "2020-01-01", blank: "nonblank" as const }, // #60: min owned → dropped, blank kept
      last_played: { min: "2020-01-01" }, // not mirrored → passes through
      [playlistColId("$ROOT/x")]: { blank: "nonblank" as const }, // playlist col → passes through
    };
    const out = columnsWithoutMirroredLines(cols);
    expect(out.bpm).toBeUndefined();
    expect(out.key).toEqual({ blank: "nonblank" });
    expect(out.root).toEqual({ max: 3 });
    expect(out.release_date).toEqual({ blank: "nonblank" }); // #60: year bounds stripped
    expect(out.last_played).toEqual({ min: "2020-01-01" });
    expect(out[playlistColId("$ROOT/x")]).toEqual({ blank: "nonblank" });
  });
});
