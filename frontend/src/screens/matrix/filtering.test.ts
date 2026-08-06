/**
 * S3 filter/sort engine tests — real-shaped fixtures (GET /api/matrix shape:
 * dates "YYYY/M/D", keys canonical flats, membership as playlist indices).
 * Includes the two signature workflows from track-playlist-matrix.md §5/§11
 * and walkthrough §7.5.
 */

import { describe, expect, it } from "vitest";
import type { MatrixData } from "../../lib/api";
import {
  applyFilterSort,
  cellDisplay,
  cellRaw,
  countMatches,
  distinctRawValues,
  filterIndices,
  fmtBpm,
  fmtMatrixDate,
  keySortRank,
  parseIsoDate,
  parseSlashDate,
  prepareMatrix,
  searchPlaceholder,
  sortIndices,
  visibleSearchColumns,
  type SearchColumnId,
} from "./filtering";
import {
  columnIdForLine,
  drawerFromApplied,
  emptyFilterState,
  mirrorLineToColumn,
  playlistColId,
  type ColumnFilter,
  type MatrixFilterState,
} from "./filterState";

// ---------------------------------------------------------------------------
// Fixture — shaped exactly like the real /api/matrix payload.
// Playlists deliberately NOT alphabetical to exercise §11.11 ordering.
// ---------------------------------------------------------------------------

const PL_DISCO = "$ROOT/RML root/discoCosmic";
const PL_SETX = "$ROOT/wip/setX";
const PL_ALIST = "$ROOT/RML root/aList";

function row(over: Partial<MatrixData["rows"][number]>): MatrixData["rows"][number] {
  return {
    tk: over.tk ?? `tk-${Math.random()}`,
    name: "Track",
    artist: "Artist",
    album: "Album",
    bpm: 120,
    key: "Am",
    import_date: "2020/1/15",
    release_date: "2019/1/1",
    last_played: "",
    playcount: 3,
    root: 0,
    nonroot: 0,
    file_path: "C:\\music\\track.mp3",
    m: [],
    ...over,
  };
}

const DATA: MatrixData = {
  generated_at: "2026-07-06T12:00:00",
  playlists: [
    { path: PL_DISCO, name: "discoCosmic", is_root: true },
    { path: PL_SETX, name: "setX", is_root: false },
    { path: PL_ALIST, name: "aList", is_root: true },
  ],
  rows: [
    // 0: on disco only (root 1, nonroot 0) — workflow-A hit
    row({ tk: "a", name: "Alpha", artist: "Kaskade", bpm: 120, key: "Gm", import_date: "2013/9/8", release_date: "2013/1/1", playcount: 0, root: 1, m: [0] }),
    // 1: on disco AND setX (nonroot 1) — workflow-A miss ("already used")
    row({ tk: "b", name: "Bravo", artist: "Kaskade", bpm: 121.5, key: "Gm", import_date: "2017/7/25", release_date: "2017/1/1", playcount: 1, root: 1, nonroot: 1, m: [0, 1] }),
    // 2: on disco, root 1 nonroot 0, but BPM out of the 118–122 band
    row({ tk: "c", name: "Charlie", artist: "Metodi", bpm: 130, key: "Gm", import_date: "2011/11/5", release_date: "", playcount: 7, root: 1, m: [0] }),
    // 3: not on disco; Gm at 119 — workflow-B hit
    row({ tk: "d", name: "Delta", artist: "Fabich", bpm: 119, key: "Gm", import_date: "2025/12/30", release_date: "2025/1/1", playcount: 2, root: 1, m: [2] }),
    // 4: wrong key
    row({ tk: "e", name: "Echo", artist: "Roth", bpm: 120, key: "Ebm", import_date: "2020/11/22", release_date: "2020/6/15", playcount: 0, root: 0, nonroot: 1, m: [1] }),
    // 5: blank bpm/key/dates (blank handling)
    row({ tk: "f", name: "Foxtrot", artist: "", album: "", bpm: null, key: null, import_date: "", release_date: "", last_played: "", playcount: 0, m: [] }),
    // 6: non-canonical free-text key (real data carries "Gmin", "Amaj", …)
    row({ tk: "g", name: "Golf", artist: "Someone", bpm: 118, key: "Gmin", import_date: "2026/1/6", release_date: "1958/1/1", playcount: 4, root: 2, m: [0, 2] }),
  ],
};

const prep = prepareMatrix(DATA);
const NOTATION = "flats" as const;

const state = (over: Partial<MatrixFilterState>): MatrixFilterState => ({
  ...emptyFilterState(),
  ...over,
});

// ---------------------------------------------------------------------------

describe("date parsing/formatting (§11.12)", () => {
  it("parses pipeline YYYY/M/D dates", () => {
    expect(parseSlashDate("2013/9/8")).toBe(20130908);
    expect(parseSlashDate("")).toBeNaN();
    expect(parseSlashDate("junk")).toBeNaN();
  });
  it("parses ISO date-input values onto the same scale", () => {
    expect(parseIsoDate("2013-09-08")).toBe(20130908);
    expect(parseIsoDate("")).toBeNaN();
  });
  it("displays raw dates as M/D/YYYY with no leading zeros (issue #6)", () => {
    expect(fmtMatrixDate("2013/9/8")).toBe("9/8/2013"); // single-digit month AND day
    expect(fmtMatrixDate("2020/12/30")).toBe("12/30/2020"); // two-digit month AND day
    expect(fmtMatrixDate("2019/1/15")).toBe("1/15/2019"); // single-digit month, two-digit day
    expect(fmtMatrixDate("1958/1/1")).toBe("1/1/1958"); // 1/1/YYYY placeholder kept
    expect(fmtMatrixDate("")).toBe(""); // blank stays blank
    expect(fmtMatrixDate("junk")).toBe("junk"); // malformed → raw
  });
  it("formats BPM as a whole number, no decimals (issue #6)", () => {
    expect(fmtBpm(120)).toBe("120");
    expect(fmtBpm(121.5)).toBe("122"); // rounds .5 up
    expect(fmtBpm(121.4833)).toBe("121"); // rounds decimals down
    expect(fmtBpm(0)).toBe("0"); // explicit zero, not blank
    expect(fmtBpm(null)).toBe(""); // null → blank
  });
});

describe("prepareMatrix", () => {
  it("orders playlist columns alphabetically by display name (§11.11)", () => {
    expect(prep.playlistOrder.map((i) => prep.playlists[i].name)).toEqual([
      "aList",
      "discoCosmic",
      "setX",
    ]);
  });
  it("computes the BPM domain ignoring nulls", () => {
    expect(prep.bpmMin).toBe(118);
    expect(prep.bpmMax).toBe(130);
  });
});

describe("signature workflow A — playlist + root ≥ 1 + non-root = 0 in one drawer pass", () => {
  it("matches only never-published discoCosmic tracks", () => {
    const s = state({});
    s.drawer.playlist = { on: true, path: PL_DISCO };
    s.drawer.onRootPl = { on: true, min: 1 };
    s.drawer.onNonRootPl = { on: true, min: 0, max: 0 };
    const hits = filterIndices(prep, s, NOTATION);
    // rows 0, 2, 6 are on disco with nonroot 0; row 1 is excluded (nonroot 1)
    expect(hits).toEqual([0, 2, 6]);
    expect(countMatches(prep, s, NOTATION)).toBe(3);
  });
});

describe("signature workflow B — BPM 118–122 + key Gm + import date oldest first", () => {
  it("filters by BPM band and key, sorts oldest import first", () => {
    const s = state({ sort: [{ col: "import_date", dir: "asc" }] });
    s.drawer.bpm = { on: true, min: 118, max: 122 };
    s.drawer.keys = { on: true, selected: ["Gm"] };
    const out = applyFilterSort(prep, s, NOTATION);
    // rows 0 (2013), 1 (2017), 3 (2025) qualify; row 6 is "Gmin" (free text ≠ canonical Gm)
    expect(out.map((i) => DATA.rows[i].tk)).toEqual(["a", "b", "d"]);
  });
});

describe("drawer lines", () => {
  it("keys line with all 24 selected constrains nothing (show all keys)", () => {
    const s = state({});
    s.drawer.keys = {
      on: true,
      selected: [
        "C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B",
        "Am","Bbm","Bm","Cm","Dbm","Dm","Ebm","Em","Fm","Gbm","Gm","Abm",
      ],
    };
    expect(filterIndices(prep, s, NOTATION)).toHaveLength(DATA.rows.length);
  });
  it("keys line with none selected matches nothing", () => {
    const s = state({});
    s.drawer.keys = { on: true, selected: [] };
    expect(filterIndices(prep, s, NOTATION)).toHaveLength(0);
  });
  it("toggled-off lines do not constrain even when values are present", () => {
    const s = state({});
    s.drawer.bpm = { on: false, min: 118, max: 122 };
    expect(filterIndices(prep, s, NOTATION)).toHaveLength(DATA.rows.length);
  });
  it("release year is year-granular (§11.4)", () => {
    const s = state({});
    s.drawer.releaseYear = { on: true, min: 2017, max: 2025 };
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual([
      "b", "d", "e",
    ]);
  });
  it("release_date COLUMN filter (#60) matches the drawer via ISO year bounds", () => {
    // Mirrored column form of the year range above — same rows.
    const s = state({ columns: { release_date: { min: "2017-01-01", max: "2025-12-31" } } });
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual([
      "b", "d", "e",
    ]);
    // Max-only "Before 1970" preset → only the 1958 release.
    const before = state({ columns: { release_date: { max: "1969-12-31" } } });
    expect(filterIndices(prep, before, NOTATION).map((i) => DATA.rows[i].tk)).toEqual(["g"]);
  });
  it("import date range uses ISO inputs against slash dates", () => {
    const s = state({});
    s.drawer.importDate = { on: true, min: "2020-01-01", max: "2025-12-31" };
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual([
      "d",
      "e",
    ]);
  });
  it("artist/track contains are case-insensitive", () => {
    const s = state({});
    s.drawer.artistContains = { on: true, text: "kaskade" };
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual([
      "a", "b",
    ]);
    const t = state({});
    t.drawer.trackContains = { on: true, text: "ALPHA" };
    expect(filterIndices(prep, t, NOTATION).map((i) => DATA.rows[i].tk)).toEqual(["a"]);
  });
});

describe("free-text search box (issue #15) — OR across Artist / Album / Track", () => {
  // Focused fixture: each search token lives in a DIFFERENT column, and no row
  // carries the same token in all three, so OR-vs-AND is unambiguous.
  const SDATA: MatrixData = {
    generated_at: "2026-07-06T12:00:00",
    playlists: [],
    rows: [
      // A: token "disclosure" in ARTIST only
      row({ tk: "A", artist: "Disclosure", album: "Settle", name: "Latch" }),
      // B: token "disclosure" in TRACK NAME only
      row({ tk: "B", artist: "Bicep", album: "Isles", name: "Disclosure Rework" }),
      // C: distinct tokens per column, incl. diacritics in the artist
      row({ tk: "C", artist: "RÜFÜS DU SOL", album: "Solace", name: "Innerbloom" }),
    ],
  };
  const sprep = prepareMatrix(SDATA);
  const search = (q: string): string[] =>
    filterIndices(sprep, state({ search: q }), NOTATION).map((i) => SDATA.rows[i].tk);

  it("matches an artist-only token", () => {
    // "settle" appears only in row A's album; "rüfüs" only in C's artist.
    expect(search("RÜFÜS")).toEqual(["C"]);
  });
  it("matches an album-only token", () => {
    expect(search("solace")).toEqual(["C"]);
    expect(search("settle")).toEqual(["A"]);
  });
  it("matches a track-name-only token", () => {
    expect(search("innerbloom")).toEqual(["C"]);
    expect(search("latch")).toEqual(["A"]);
  });
  it("is a true OR across columns, not an AND (the whole point of #15)", () => {
    // "disclosure" is in A's ARTIST and B's NAME (never both in one row). OR →
    // both rows; three AND-ed contains filters would return ZERO rows.
    expect(search("disclosure")).toEqual(["A", "B"]);
  });
  it("is case-insensitive", () => {
    expect(search("DISCLOSURE")).toEqual(["A", "B"]);
    expect(search("rüfüs du sol")).toEqual(["C"]);
  });
  it("treats the whole query as one substring (not per-word AND)", () => {
    // The literal run must be present; "du sol" matches, "sol du" does not.
    expect(search("du sol")).toEqual(["C"]);
    expect(search("sol du")).toEqual([]);
  });
  it("empty or whitespace-only query applies no search filter (all rows pass)", () => {
    expect(search("")).toEqual(["A", "B", "C"]);
    expect(search("   ")).toEqual(["A", "B", "C"]);
  });
  it("a query matching nothing yields zero rows", () => {
    expect(search("zzzznomatch")).toEqual([]);
  });
  it("ANDs with other filters (coexists — narrows within them)", () => {
    // Add an artist column contains that only B satisfies; searching a token in
    // A's artist then yields the intersection = empty (search AND column).
    const s = state({ search: "disclosure", columns: { artist: { contains: "Bicep" } } });
    expect(filterIndices(sprep, s, NOTATION).map((i) => SDATA.rows[i].tk)).toEqual(["B"]);
  });

  // ---- #15 followup: the free text scans only the VISIBLE text columns ----
  const searchIn = (q: string, cols: readonly SearchColumnId[]): string[] =>
    filterIndices(sprep, state({ search: q }), NOTATION, cols).map(
      (i) => SDATA.rows[i].tk,
    );

  it("a hidden column drops out of the free-text search (#15 followup)", () => {
    // "disclosure" lives in A's ARTIST and B's TRACK NAME only.
    expect(searchIn("disclosure", ["album", "name"])).toEqual(["B"]); // artist hidden
    expect(searchIn("disclosure", ["artist", "album"])).toEqual(["A"]); // track hidden
    expect(searchIn("settle", ["artist", "name"])).toEqual([]); // album (its home) hidden
  });

  it("with a single visible text column, only that column is searched", () => {
    expect(searchIn("disclosure", ["name"])).toEqual(["B"]);
    expect(searchIn("disclosure", ["artist"])).toEqual(["A"]);
    expect(searchIn("settle", ["album"])).toEqual(["A"]);
  });

  it("with NO visible text column the free text is INERT (all rows pass)", () => {
    expect(searchIn("disclosure", [])).toEqual(["A", "B", "C"]);
  });

  it("keyword clauses (#24) filter regardless of text-column visibility", () => {
    // Main fixture: only row d has BPM 119; zero visible text columns.
    const s = state({ search: "BPM=119" });
    expect(filterIndices(prep, s, NOTATION, []).map((i) => DATA.rows[i].tk)).toEqual(
      ["d"],
    );
  });

  it("mixed query: the clause applies while the free text follows visibility", () => {
    // "Kaskade" matches rows a+b via ARTIST; BPM>120 (strict) matches b+c.
    const s = state({ search: "Kaskade BPM>120" });
    // Artist visible → contains AND clause = b.
    expect(
      filterIndices(prep, s, NOTATION, ["artist"]).map((i) => DATA.rows[i].tk),
    ).toEqual(["b"]);
    // No text column visible → free text inert, clause alone = b + c.
    expect(filterIndices(prep, s, NOTATION, []).map((i) => DATA.rows[i].tk)).toEqual(
      ["b", "c"],
    );
  });
});

describe("visibleSearchColumns / searchPlaceholder (#15 followup)", () => {
  it("drops the hidden ids, preserving artist → album → track order", () => {
    expect(visibleSearchColumns(["file_path"])).toEqual(["artist", "album", "name"]);
    expect(visibleSearchColumns(["album"])).toEqual(["artist", "name"]);
    expect(visibleSearchColumns(["name", "artist", "bpm"])).toEqual(["album"]);
    expect(visibleSearchColumns(["artist", "album", "name"])).toEqual([]);
  });

  it("placeholder names exactly the columns being searched", () => {
    expect(searchPlaceholder(["artist", "album", "name"])).toBe(
      "Search artist, album, or track…",
    );
    expect(searchPlaceholder(["artist", "name"])).toBe("Search artist or track…");
    expect(searchPlaceholder(["album"])).toBe("Search album…");
  });

  it("zero visible text columns → Edit Columns message (box stays keyword-capable)", () => {
    expect(searchPlaceholder([])).toBe(
      "Edit Columns to enable text search — keyword filters (BPM=, Key=…) still work",
    );
  });
});

describe("per-column header filters (§4 — every column)", () => {
  it("playlist column non-blank ⇔ membership (the §7.5 isolate gesture)", () => {
    const s = state({ columns: { [playlistColId(PL_SETX)]: { blank: "nonblank" } } });
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual([
      "b", "e",
    ]);
  });
  it("playlist column blank = NOT on that playlist", () => {
    const s = state({ columns: { [playlistColId(PL_DISCO)]: { blank: "blank" } } });
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual([
      "d", "e", "f",
    ]);
  });
  it("blank/non-blank works on metadata columns too", () => {
    const s = state({ columns: { key: { blank: "blank" } } });
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual(["f"]);
  });
  it("numeric range on Play Count", () => {
    const s = state({ columns: { playcount: { min: 0, max: 1 } } });
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual([
      "a", "b", "e", "f",
    ]);
  });
  it("date range on Import Date (ISO min/max)", () => {
    const s = state({ columns: { import_date: { min: "2017-01-01", max: "2021-01-01" } } });
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual([
      "b", "e",
    ]);
  });
  it("picklist matches RAW values (keys canonical)", () => {
    const s = state({ columns: { key: { picked: ["Gm", "Gmin"] } } });
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual([
      "a", "b", "c", "d", "g",
    ]);
  });
  it("contains matches the DISPLAYED text (camelot notation reaches keys)", () => {
    const s = state({ columns: { key: { contains: "6A" } } });
    expect(filterIndices(prep, s, "camelot").map((i) => DATA.rows[i].tk)).toEqual([
      "a", "b", "c", "d",
    ]);
  });
  it("drawer + column filters compose (one unified state)", () => {
    const s = state({ columns: { playcount: { min: 1 } } });
    s.drawer.playlist = { on: true, path: PL_DISCO };
    expect(filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk)).toEqual([
      "b", "c", "g",
    ]);
  });
});

describe("issue #8 — drawer↔column mirror is single-source (no double-apply)", () => {
  // Simulate applyDraft at the engine level: mirror a mappable line into its
  // column and clear the drawer slot, then prove the row set is IDENTICAL to
  // the pure-drawer form (applied exactly once) and back-fills losslessly.
  function applied(line: "bpm" | "keys" | "onNonRootPl", drawerVal: MatrixFilterState): {
    drawerForm: MatrixFilterState;
    mirrored: MatrixFilterState;
  } {
    const col = columnIdForLine(line)!;
    const mirror = mirrorLineToColumn(line, drawerVal.drawer, undefined);
    const columns: Record<string, ColumnFilter> = {};
    if (mirror) columns[col] = mirror;
    return { drawerForm: drawerVal, mirrored: state({ columns }) };
  }

  it("BPM: mirrored column yields the same rows, drawer slot cleared, round-trips", () => {
    const drawerForm = state({});
    drawerForm.drawer.bpm = { on: true, min: 118, max: 122 };
    const { mirrored } = applied("bpm", drawerForm);

    // The mappable dimension now lives ONLY in columns.
    expect(mirrored.drawer.bpm.on).toBe(false);
    expect(mirrored.columns.bpm).toEqual({ min: 118, max: 122 });

    expect(filterIndices(prep, mirrored, NOTATION)).toEqual(
      filterIndices(prep, drawerForm, NOTATION),
    );
    // Reopening the drawer back-fills the identical line.
    expect(drawerFromApplied(mirrored).bpm).toEqual({ on: true, min: 118, max: 122 });
  });

  it("Keys subset: mirrored picklist equals the drawer key predicate", () => {
    const drawerForm = state({});
    drawerForm.drawer.keys = { on: true, selected: ["Gm"] };
    const { mirrored } = applied("keys", drawerForm);
    expect(mirrored.columns.key).toEqual({ picked: ["Gm"] });
    expect(filterIndices(prep, mirrored, NOTATION)).toEqual(
      filterIndices(prep, drawerForm, NOTATION),
    );
  });

  it("On Non-Super Playlist = 0: mirrored min/max matches the drawer bound", () => {
    const drawerForm = state({});
    drawerForm.drawer.onNonRootPl = { on: true, min: 0, max: 0 };
    const { mirrored } = applied("onNonRootPl", drawerForm);
    expect(mirrored.columns.nonroot).toEqual({ min: 0, max: 0 });
    expect(filterIndices(prep, mirrored, NOTATION)).toEqual(
      filterIndices(prep, drawerForm, NOTATION),
    );
  });
});

describe("sorting (§4 multi-level, stable, blanks last)", () => {
  const all = DATA.rows.map((_, i) => i);
  it("multi-level: BPM asc then import date desc", () => {
    const out = sortIndices(prep, all, [
      { col: "bpm", dir: "asc" },
      { col: "import_date", dir: "desc" },
    ]);
    expect(out.map((i) => DATA.rows[i].tk)).toEqual([
      "g", // 118
      "d", // 119
      "e", // 120, imported 2020 (desc → before a's 2013)
      "a", // 120, imported 2013
      "b", // 121.5
      "c", // 130
      "f", // blank BPM last
    ]);
  });
  it("blank dates sort last in both directions", () => {
    const asc = sortIndices(prep, all, [{ col: "release_date", dir: "asc" }]);
    expect(DATA.rows[asc[asc.length - 1]].tk === "f" || DATA.rows[asc[asc.length - 1]].tk === "c").toBe(true);
    const desc = sortIndices(prep, all, [{ col: "release_date", dir: "desc" }]);
    const lastTwo = desc.slice(-2).map((i) => DATA.rows[i].tk).sort();
    expect(lastTwo).toEqual(["c", "f"]); // both blank release dates
  });
  it("key sort walks the Camelot wheel; unknown keys after canonical, blanks last", () => {
    expect(keySortRank("Am")).toBeLessThan(keySortRank("C")); // 8A before 8B
    expect(keySortRank("Gm")).toBeLessThan(keySortRank("Gmin"));
    expect(keySortRank(null)).toBe(Infinity);
    const out = sortIndices(prep, all, [{ col: "key", dir: "asc" }]);
    expect(DATA.rows[out[out.length - 1]].tk).toBe("f"); // blank key last
  });
  it("text sort is case-insensitive with blanks last", () => {
    const out = sortIndices(prep, all, [{ col: "artist", dir: "asc" }]);
    expect(DATA.rows[out[out.length - 1]].tk).toBe("f"); // blank artist last
  });
});

describe("cell accessors", () => {
  const p0 = prep.rows[0];
  it("playlist cells carry the track name when on the playlist, else blank", () => {
    expect(cellRaw(p0, playlistColId(PL_DISCO), prep)).toBe("Alpha");
    expect(cellRaw(p0, playlistColId(PL_SETX), prep)).toBe("");
  });
  it("display formats dates and keys; raw stays canonical", () => {
    expect(cellDisplay(p0, "import_date", prep, NOTATION)).toBe("9/8/2013");
    expect(cellRaw(p0, "import_date", prep)).toBe("2013/9/8");
    expect(cellDisplay(p0, "key", prep, "camelot")).toBe("6A");
    expect(cellRaw(p0, "key", prep)).toBe("Gm");
  });
  it("distinct raw values for picklists, sorted per kind", () => {
    // Keys sort in Camelot-wheel order (Ebm=2A, Gm=6A), unknown last.
    expect(distinctRawValues(prep, "key")).toEqual(["Ebm", "Gm", "Gmin"]);
    expect(distinctRawValues(prep, "import_date")[0]).toBe("2011/11/5");
  });
});
