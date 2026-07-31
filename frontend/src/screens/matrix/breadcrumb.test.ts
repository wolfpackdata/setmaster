/**
 * Breadcrumb sentence composition tests (track-playlist-matrix.md §6) —
 * pure function over the unified filter state.
 */

import { describe, expect, it } from "vitest";
import { breadcrumbText, type BreadcrumbCtx } from "./breadcrumb";
import { CANONICAL_KEYS } from "../../lib/keys";
import {
  emptyFilterState,
  hasActiveFilters,
  playlistColId,
  type MatrixFilterState,
} from "./filterState";

const CTX: BreadcrumbCtx = {
  playlistName: (path) => path.split("/").pop() ?? path,
  notation: "flats",
};

const state = (): MatrixFilterState => emptyFilterState();

describe("breadcrumb sentence (§6)", () => {
  it("is empty with no filters and no sort", () => {
    expect(breadcrumbText(state(), CTX)).toBe("");
    expect(hasActiveFilters(state())).toBe(false);
  });

  it("composes the spec's example sentence shape", () => {
    const s = state();
    s.drawer.playlist = { on: true, path: "$ROOT/RML root/discoCosmic" };
    s.drawer.bpm = { on: true, min: 122, max: 126 };
    s.drawer.keys = { on: true, selected: [...CANONICAL_KEYS] };
    s.drawer.releaseYear = { on: true, min: 2025, max: null };
    s.drawer.artistContains = { on: true, text: "Kaskade" };
    expect(breadcrumbText(s, CTX)).toBe(
      "Show tracks only from discoCosmic, with BPM 122 through 126, " +
        "show me all keys, released 2025 through Present, " +
        "where Artist Name contains Kaskade.",
    );
  });

  it("names specific keys when few are selected", () => {
    const s = state();
    s.drawer.keys = { on: true, selected: ["Gm"] };
    expect(breadcrumbText(s, CTX)).toBe("Show tracks in key Gm.");
  });

  it("renders keys in the active notation", () => {
    const s = state();
    s.drawer.keys = { on: true, selected: ["Gm"] };
    expect(breadcrumbText(s, { ...CTX, notation: "camelot" })).toBe(
      "Show tracks in key 6A.",
    );
  });

  it("says 'exactly 0' for the never-published Non-Super Playlist filter (§11.3)", () => {
    const s = state();
    s.drawer.onRootPl = { on: true, min: 1 };
    s.drawer.onNonRootPl = { on: true, min: 0, max: 0 };
    expect(breadcrumbText(s, CTX)).toBe(
      "Show tracks with On Super Playlist at least 1, with On Non-Super Playlist exactly 0.",
    );
  });

  it("phrases playlist-column blank filters as membership (§7.5 gesture)", () => {
    const s = state();
    s.columns[playlistColId("$ROOT/RML root/discoCosmic")] = { blank: "nonblank" };
    expect(breadcrumbText(s, CTX)).toBe("Show tracks on discoCosmic.");
    const t = state();
    t.columns[playlistColId("$ROOT/RML root/discoCosmic")] = { blank: "blank" };
    expect(breadcrumbText(t, CTX)).toBe("Show tracks not on discoCosmic.");
  });

  it("covers column filters and multi-level sort in one sentence", () => {
    const s = state();
    s.columns["playcount"] = { min: 0, max: 1 };
    s.sort = [
      { col: "bpm", dir: "asc" },
      { col: "import_date", dir: "desc" },
    ];
    expect(breadcrumbText(s, CTX)).toBe(
      "Show tracks where Play Count is 0 through 1, sorted by BPM then Import Date newest first.",
    );
  });

  it("renders the mirrored release_date column as a year range (#60)", () => {
    const s = state();
    s.columns["release_date"] = { min: "2019-01-01", max: "2025-12-31" };
    expect(breadcrumbText(s, CTX)).toBe("Show tracks released 2019 through 2025.");
    // Single-year (e.g. "This Year") collapses; max-only reads "through <year>".
    const one = state();
    one.columns["release_date"] = { min: "2026-01-01", max: "2026-12-31" };
    expect(breadcrumbText(one, CTX)).toBe("Show tracks released 2026.");
    const before = state();
    before.columns["release_date"] = { max: "1969-12-31" };
    expect(breadcrumbText(before, CTX)).toBe("Show tracks released through 1969.");
  });

  it("sort alone yields a sentence but does NOT count as an active filter", () => {
    const s = state();
    s.sort = [{ col: "bpm", dir: "asc" }];
    expect(breadcrumbText(s, CTX)).toBe("Show tracks sorted by BPM.");
    expect(hasActiveFilters(s)).toBe(false); // sort is not a filter (badge stays clear)
  });

  it("import date range formats ISO input values as MM/DD/YYYY", () => {
    const s = state();
    s.drawer.importDate = { on: true, min: "2025-01-01", max: "" };
    expect(breadcrumbText(s, CTX)).toBe(
      "Show tracks imported 01/01/2025 through Present.",
    );
  });

  it("toggled-off lines with retained values stay out of the sentence", () => {
    const s = state();
    s.drawer.bpm = { on: false, min: 122, max: 126 };
    expect(breadcrumbText(s, CTX)).toBe("");
  });
});
