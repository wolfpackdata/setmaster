/**
 * S3 "Export Matrix" (issue #14) tests — CSV serialization (RFC 4180 + BOM),
 * the STABLE column schema (issue #65: fixed 12-column metadata prefix in spec
 * order, blind to column show/hide + reorder, then the My-Playlists-SHOWN
 * playlist tail — revised tail rule, Ry 2026-07-08), filter+sort row fidelity,
 * and the deterministic, filename-safe filename grammar (Search → drawer
 * lines 1-9 → per-column facets; Full View; sanitization; cap).
 *
 * Fixtures are shaped exactly like the real /api/matrix payload (dates
 * "YYYY/M/D", keys canonical flats, membership as playlist indices).
 */

import { describe, expect, it } from "vitest";
import type { MatrixData } from "../../lib/api";
import { formatKey } from "../../lib/keys";
import { META_COLUMNS } from "./columns";
import { applyFilterSort, prepareMatrix } from "./filtering";
import {
  emptyFilterState,
  playlistColId,
  type MatrixFilterState,
} from "./filterState";
import {
  buildExportFilename,
  buildMatrixCsv,
  CSV_BOM,
  escapeCsvField,
  exportColumns,
  exportFilterTokens,
  sanitizeFilenameValue,
  toCsv,
  type MatrixExportContext,
} from "./exportMatrix";

// ---------------------------------------------------------------------------
// Fixture (playlists deliberately NOT alphabetical to exercise ordering)
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
    // 0: on disco + aList; BPM 121.7 → whole 122; key Gm; playcount 0
    row({ tk: "a", name: "Alpha", artist: "Kaskade", album: "Disco, Vol. 1", bpm: 121.7, key: "Gm", release_date: "2013/9/8", playcount: 0, root: 2, m: [0, 2] }),
    // 1: on setX only; name carries a quote + comma (RFC 4180)
    row({ tk: "b", name: 'Bravo "Live", Pt.2', artist: "Métodi", bpm: 128, key: "Ebm", release_date: "2017/3/4", playcount: 5, nonroot: 1, m: [1] }),
    // 2: on nothing; blank bpm/key
    row({ tk: "c", name: "Charlie", artist: "007", bpm: null, key: null, release_date: "", playcount: 0, m: [] }),
  ],
};

const prep = prepareMatrix(DATA);
const NOTATION = "flats" as const;

const ctx: MatrixExportContext = {
  playlistName: (path) => {
    const idx = prep.pathToIndex.get(path);
    return idx !== undefined ? prep.playlists[idx].name : path;
  },
  notation: NOTATION,
};

// ---------------------------------------------------------------------------
// RFC 4180 escaping + serialization
// ---------------------------------------------------------------------------

describe("escapeCsvField (RFC 4180)", () => {
  it("leaves plain fields untouched", () => {
    expect(escapeCsvField("Alpha")).toBe("Alpha");
    expect(escapeCsvField("")).toBe("");
  });

  it("quotes fields containing a comma", () => {
    expect(escapeCsvField("Disco, Vol. 1")).toBe('"Disco, Vol. 1"');
  });

  it("quotes and doubles embedded double-quotes", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes fields containing CR or LF", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("a\r\nb")).toBe('"a\r\nb"');
  });

  it("preserves leading zeros verbatim (text, no numeric coercion)", () => {
    expect(escapeCsvField("007")).toBe("007");
    expect(escapeCsvField("0")).toBe("0");
  });

  it("passes non-ASCII / unicode through unchanged", () => {
    expect(escapeCsvField("Métodi ★ 日本")).toBe("Métodi ★ 日本");
  });
});

describe("toCsv", () => {
  it("prefixes the UTF-8 BOM (utf-8-sig)", () => {
    const csv = toCsv(["A"], []);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("terminates every record with CRLF (incl. the last)", () => {
    const csv = toCsv(["A", "B"], [["1", "2"]]);
    expect(csv).toBe(`${CSV_BOM}A,B\r\n1,2\r\n`);
  });

  it("emits a header-only file when there are no rows", () => {
    expect(toCsv(["A", "B"], [])).toBe(`${CSV_BOM}A,B\r\n`);
  });
});

// ---------------------------------------------------------------------------
// Columns — the stable schema contract (issue #65)
// ---------------------------------------------------------------------------

describe("exportColumns — stable schema (#65: fixed prefix + shown-playlist tail)", () => {
  const cols = exportColumns(prep, new Set());

  it("fixed prefix: all 12 metadata columns in canonical spec order", () => {
    // Positional consumption is part of the contract for the prefix.
    expect(cols.slice(0, META_COLUMNS.length).map((c) => c.label)).toEqual([
      "Import Date",
      "Release Date",
      "Last Played",
      "Play Count",
      "BPM",
      "Key",
      "Album Title",
      "Artist Name",
      "Track Name",
      "On Super Playlist",
      "On Non-Super Playlist",
      "File Path",
    ]);
  });

  it("File Path is always exported (hidden on screen by default — the join key)", () => {
    expect(cols.map((c) => c.id)).toContain("file_path");
  });

  it("dynamic tail: playlist columns alphabetical by display name (none hidden)", () => {
    expect(cols.slice(META_COLUMNS.length).map((c) => c.label)).toEqual([
      "aList",
      "discoCosmic",
      "setX",
    ]);
  });

  it("tail honors the My Playlists hidden set (#13) — hidden playlists dropped, prefix untouched", () => {
    const some = exportColumns(prep, new Set([PL_SETX]));
    expect(some.slice(META_COLUMNS.length).map((c) => c.label)).toEqual([
      "aList",
      "discoCosmic",
    ]);
    // The metadata prefix never shrinks, whatever is hidden.
    expect(some.slice(0, META_COLUMNS.length)).toEqual(
      cols.slice(0, META_COLUMNS.length),
    );
  });

  it("ALL playlists hidden → the 12-column metadata prefix only", () => {
    const none = exportColumns(prep, new Set([PL_DISCO, PL_SETX, PL_ALIST]));
    expect(none).toHaveLength(META_COLUMNS.length);
    expect(none.map((c) => c.id)).not.toContain(playlistColId(PL_DISCO));
  });

  it("takes no layout input — column show/hide + reorder cannot affect the schema", () => {
    // The metadata invariance is structural: exportColumns has no `layout`
    // parameter, so two exports of the same payload + My Playlists selection
    // are identical whatever metadata columns the user hid or dragged.
    expect(exportColumns(prep, new Set())).toEqual(cols);
  });
});

// ---------------------------------------------------------------------------
// CSV body fidelity — respects filter + sort; cells match the grid
// ---------------------------------------------------------------------------

describe("buildMatrixCsv", () => {
  const cols = exportColumns(prep, new Set());

  it("writes every filtered row in current sort order (not just a window)", () => {
    const s = emptyFilterState();
    s.sort = [{ col: "name", dir: "asc" }];
    const visible = applyFilterSort(prep, s, NOTATION);
    const csv = buildMatrixCsv(prep, visible, cols, NOTATION);
    const lines = csv.replace(CSV_BOM, "").trimEnd().split("\r\n");
    expect(lines.length).toBe(1 + DATA.rows.length); // header + all 3 rows
    // Alphabetical by name: Alpha, Bravo…, Charlie — Charlie is the last row.
    expect(lines[3]).toContain("Charlie");
  });

  it("formats cells like the grid (whole BPM, M/D/YYYY, playcount 0, key notation)", () => {
    const s = emptyFilterState();
    const visible = applyFilterSort(prep, s, NOTATION);
    const csv = buildMatrixCsv(prep, visible, cols, NOTATION);
    // Alpha row: BPM 121.7 → 122; Release 2013/9/8 → 9/8/2013; playcount 0; key Gm.
    expect(csv).toContain("122");
    expect(csv).toContain("9/8/2013");
    expect(csv).toContain(formatKey("Gm", NOTATION));
  });

  it("playlist cell = track name where on-playlist, blank otherwise; quotes commas/quotes", () => {
    const s = emptyFilterState();
    s.sort = [{ col: "name", dir: "asc" }];
    const visible = applyFilterSort(prep, s, NOTATION);
    const csv = buildMatrixCsv(prep, visible, cols, NOTATION);
    // Alpha is on discoCosmic + aList → its name appears in those columns.
    expect(csv).toContain("Alpha");
    // Bravo's name has a comma + quotes → must be RFC-4180 quoted somewhere.
    expect(csv).toContain('"Bravo ""Live"", Pt.2"');
  });

  it("respects an active filter (only matching rows exported)", () => {
    const s = emptyFilterState();
    s.columns = { bpm: { min: 125 } }; // only Bravo (128)
    const visible = applyFilterSort(prep, s, NOTATION);
    const csv = buildMatrixCsv(prep, visible, cols, NOTATION);
    const lines = csv.replace(CSV_BOM, "").trimEnd().split("\r\n");
    expect(lines.length).toBe(2); // header + Bravo
    expect(csv).toContain("Bravo");
    expect(csv).not.toContain("Alpha");
  });

  it("0 rows → header-only CSV", () => {
    const csv = buildMatrixCsv(prep, [], cols, NOTATION);
    const lines = csv.replace(CSV_BOM, "").trimEnd().split("\r\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("On Super Playlist");
  });
});

// ---------------------------------------------------------------------------
// Filename tokens + assembly
// ---------------------------------------------------------------------------

const BASE = "SetMaster Track-Playlist Matrix Export -- ";

function withState(mut: (s: MatrixFilterState) => void): MatrixFilterState {
  const s = emptyFilterState();
  mut(s);
  return s;
}

describe("buildExportFilename — Full View (R4)", () => {
  it("no filters engaged → Full View", () => {
    expect(buildExportFilename(emptyFilterState(), ctx)).toBe(`${BASE}Full View.csv`);
  });

  it("a sort alone (no filters) is still Full View", () => {
    const s = withState((x) => {
      x.sort = [{ col: "bpm", dir: "asc" }];
    });
    expect(buildExportFilename(s, ctx)).toBe(`${BASE}Full View.csv`);
  });
});

describe("exportFilterTokens — drawer lines (1-9) & wording", () => {
  it("One Playlist → PL <name> (drawer-only)", () => {
    const s = withState((x) => {
      x.drawer.playlist = { on: true, path: PL_DISCO };
    });
    expect(exportFilterTokens(s, ctx)).toEqual(["PL discoCosmic"]);
  });

  it("BPM range / min / max", () => {
    expect(exportFilterTokens(withState((x) => (x.columns = { bpm: { min: 122, max: 126 } })), ctx)).toEqual(["BPM 122-126"]);
    expect(exportFilterTokens(withState((x) => (x.columns = { bpm: { min: 122 } })), ctx)).toEqual(["BPM ge 122"]);
    expect(exportFilterTokens(withState((x) => (x.columns = { bpm: { max: 126 } })), ctx)).toEqual(["BPM le 126"]);
  });

  it("Keys ≤3 list vs. >3 count", () => {
    const three = withState((x) => (x.columns = { key: { picked: ["Gm", "Am"] } }));
    expect(exportFilterTokens(three, ctx)).toEqual([
      `Keys ${formatKey("Gm", NOTATION)},${formatKey("Am", NOTATION)}`,
    ]);
    const many = withState((x) => (x.columns = { key: { picked: ["Gm", "Am", "Ebm", "Bm"] } }));
    expect(exportFilterTokens(many, ctx)).toEqual(["Keys x4"]);
  });

  it("Release Year (mirrored to release_date, #60) → Rel via the drawer view", () => {
    // The year-only release_date column back-fills to the Release Year line, so
    // the export suffix keeps its "Rel" drawer token (no duplicate column token).
    const s = withState((x) => {
      x.columns = { release_date: { min: "2023-01-01", max: "2025-12-31" } };
    });
    expect(exportFilterTokens(s, ctx)).toEqual(["Rel 2023-2025"]);
  });

  it("Import Date range uses .. and ge/le", () => {
    expect(exportFilterTokens(withState((x) => (x.columns = { import_date: { min: "2026-01-01", max: "2026-07-01" } })), ctx)).toEqual([
      "Imp 2026-01-01..2026-07-01",
    ]);
    expect(exportFilterTokens(withState((x) => (x.columns = { import_date: { min: "2026-01-01" } })), ctx)).toEqual([
      "Imp ge 2026-01-01",
    ]);
  });

  it("Artist / Track contains → ~text", () => {
    expect(exportFilterTokens(withState((x) => (x.columns = { artist: { contains: "Kaskade" } })), ctx)).toEqual(["Artist ~Kaskade"]);
    expect(exportFilterTokens(withState((x) => (x.columns = { name: { contains: "Atmosphere" } })), ctx)).toEqual(["Track ~Atmosphere"]);
  });

  it("Super / Non-Super wording (#11)", () => {
    expect(exportFilterTokens(withState((x) => (x.columns = { root: { min: 1 } })), ctx)).toEqual(["Super ge 1"]);
    expect(exportFilterTokens(withState((x) => (x.columns = { nonroot: { min: 0, max: 0 } })), ctx)).toEqual(["NonSuper 0"]);
    expect(exportFilterTokens(withState((x) => (x.columns = { nonroot: { min: 0, max: 2 } })), ctx)).toEqual(["NonSuper 0-2"]);
    expect(exportFilterTokens(withState((x) => (x.columns = { nonroot: { min: 1 } })), ctx)).toEqual(["NonSuper ge 1"]);
  });
});

describe("exportFilterTokens — search first & per-column facets", () => {
  it("Search token comes first (above the drawer, #15)", () => {
    const s = withState((x) => {
      x.search = "disclosure";
      x.drawer.playlist = { on: true, path: PL_DISCO };
      x.columns = { bpm: { min: 122, max: 126 } };
    });
    expect(exportFilterTokens(s, ctx)).toEqual([
      "Search ~disclosure",
      "PL discoCosmic",
      "BPM 122-126",
    ]);
  });

  it("per-column blank/non-blank on a playlist column", () => {
    const s = withState((x) => {
      x.columns = { [playlistColId(PL_DISCO)]: { blank: "nonblank" } };
    });
    expect(exportFilterTokens(s, ctx)).toEqual(["discoCosmic non-blank"]);
  });

  it("per-column date range (non-mappable) uses the display label + ..", () => {
    // last_played has no drawer counterpart (release_date is now mirrored, #60).
    const s = withState((x) => {
      x.columns = { last_played: { min: "2020-01-01", max: "2020-12-31" } };
    });
    expect(exportFilterTokens(s, ctx)).toEqual(["Last Played 2020-01-01..2020-12-31"]);
  });

  it("per-column picked on a text column", () => {
    const s = withState((x) => {
      x.columns = { album: { picked: ["Vol 1", "Vol 2"] } };
    });
    expect(exportFilterTokens(s, ctx)).toEqual(["Album Title Vol 1,Vol 2"]);
  });

  it("does NOT double-count a mirrored dimension (drawer token only, no per-column dup)", () => {
    // BPM lives in applied.columns after #8's Apply — it must surface exactly
    // once, as the drawer 'BPM' token, never also as a 'BPM' column facet.
    const s = withState((x) => (x.columns = { bpm: { min: 122, max: 126 } }));
    expect(exportFilterTokens(s, ctx)).toEqual(["BPM 122-126"]);
  });

  it("keeps a header-only facet on a mirrored column alongside the drawer token", () => {
    const s = withState((x) => {
      x.columns = { bpm: { min: 122, max: 126, blank: "nonblank" } };
    });
    // Range → drawer 'BPM' token; the blank facet → per-column 'BPM' token.
    expect(exportFilterTokens(s, ctx)).toEqual(["BPM 122-126", "BPM non-blank"]);
  });
});

describe("buildExportFilename — assembly, sanitization, cap", () => {
  it("joins tokens with ', ' and appends .csv", () => {
    const s = withState((x) => {
      x.drawer.playlist = { on: true, path: PL_DISCO };
      x.columns = { bpm: { min: 122, max: 126 }, root: { min: 1 } };
    });
    expect(buildExportFilename(s, ctx)).toBe(`${BASE}PL discoCosmic, BPM 122-126, Super ge 1.csv`);
  });

  it("strips filesystem-illegal characters from dynamic values", () => {
    expect(sanitizeFilenameValue('AC/DC: Best? <hits>')).toBe("AC DC Best hits");
    const s = withState((x) => (x.columns = { artist: { contains: "AC/DC: Best?" } }));
    expect(buildExportFilename(s, ctx)).toBe(`${BASE}Artist ~AC DC Best.csv`);
  });

  it("caps the filename length and marks truncation", () => {
    const s = withState((x) => {
      x.search = "x".repeat(400);
    });
    const name = buildExportFilename(s, ctx);
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.endsWith(".csv")).toBe(true);
    expect(name).toContain("…");
  });

  it("drops overflowing trailing tokens but keeps the ones that fit", () => {
    const s = withState((x) => {
      x.drawer.playlist = { on: true, path: PL_DISCO };
      // A long artist contains that will push total past 200 chars.
      x.columns = { artist: { contains: "y".repeat(220) } };
    });
    const name = buildExportFilename(s, ctx);
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name).toContain("PL discoCosmic");
    expect(name).toContain("…");
  });
});
