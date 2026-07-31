import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComparisonResultRow, PresenceFlag } from "../../lib/api";
import {
  COLUMN_VISIBILITY_KEY,
  COMPARE_COLUMNS,
  EMPTY_FILTERS,
  FLAGS_BY_LABEL,
  FLAG_META,
  applyFilters,
  defaultColumnVisibility,
  filteredCountText,
  filtersActive,
  flagLabel,
  isNoteEditable,
  loadColumnVisibility,
  nextSort,
  noteCellState,
  noteJoinKey,
  notesSummaryText,
  saveColumnVisibility,
  setColumnVisible,
  sortRows,
  spotifyTrackUrl,
  summaryLine,
  toggleFlagFilter,
  visibleColumns,
  type ColumnVisibility,
  type SortColumn,
  applyLinkPaste,
  isPastedUrl,
  noteForExport,
  noteHasLink,
  parseNoteSegments,
} from "./compareLogic";

function row(over: Partial<ComparisonResultRow> = {}): ComparisonResultRow {
  return {
    flag: "Yes-Trak-Playlist",
    traktor_title: "Some Track",
    spotify_track_name: "Some Track",
    traktor_artists: "Some Artist",
    spotify_artists: "Some Artist",
    traktor_release_name: "Some Album",
    spotify_album_name: "Some Album",
    file_paths: ["C:\\music\\some.mp3"],
    spotify_uri: "spotify:track:abc123",
    spotify_trackjoin: "sometrack",
    trak_trackjoin: "sometrack",
    note: null,
    ...over,
  };
}

// A "Go get" gap row: Spotify only, blank Traktor cell.
const goGet = row({
  flag: "Not-Trak-Collection",
  traktor_title: "",
  file_paths: [],
  trak_trackjoin: "",
  spotify_track_name: "Wanted Track",
  spotify_trackjoin: "wantedtrack",
});

// A "Traktor only" row: blank Spotify cell.
const trakOnly = row({
  flag: "Not-Spotify / Yes-Trak-Playlist",
  spotify_track_name: "",
  spotify_uri: "",
  spotify_trackjoin: "",
  traktor_title: "Owned Track",
  trak_trackjoin: "ownedtrack",
});

const organize = row({
  flag: "Not-Trak-Playlist / Yes-Trak-Collection",
  traktor_title: "",
  spotify_track_name: "Organize Me",
  spotify_trackjoin: "organizeme",
});

describe("flag label/color mapping (§4, §5.5)", () => {
  it("maps the four enum values to the decided friendly labels", () => {
    expect(flagLabel("Yes-Trak-Playlist")).toBe("Match");
    expect(flagLabel("Not-Trak-Collection")).toBe("Go get");
    expect(flagLabel("Not-Trak-Playlist / Yes-Trak-Collection")).toBe(
      "Organize",
    );
    expect(flagLabel("Not-Spotify / Yes-Trak-Playlist")).toBe("Traktor® only");
  });

  it("renders unknown flag values raw instead of hiding them", () => {
    expect(flagLabel("Some-Future-Flag")).toBe("Some-Future-Flag");
  });

  it("uses the §5.5 color tokens with the two gap flags prominent", () => {
    expect(FLAG_META["Yes-Trak-Playlist"].color).toBe("var(--text-muted)");
    expect(FLAG_META["Not-Trak-Collection"].color).toBe(
      "var(--status-success)",
    );
    expect(FLAG_META["Not-Trak-Playlist / Yes-Trak-Collection"].color).toBe(
      "var(--accent-orange)",
    );
    expect(FLAG_META["Not-Spotify / Yes-Trak-Playlist"].color).toBe(
      "var(--text-secondary)",
    );
    expect(FLAG_META["Not-Trak-Collection"].prominent).toBe(true);
    expect(
      FLAG_META["Not-Trak-Playlist / Yes-Trak-Collection"].prominent,
    ).toBe(true);
    expect(FLAG_META["Yes-Trak-Playlist"].prominent).toBe(false);
  });

  it("orders flags alphabetically by display label (§7 flag sort)", () => {
    expect(FLAGS_BY_LABEL.map(flagLabel)).toEqual([
      "Go get",
      "Match",
      "Organize",
      "Traktor® only",
    ]);
  });
});

describe("blank-cell note state mapping (§5)", () => {
  it("blank Traktor cell without a note is gold", () => {
    expect(noteCellState(goGet, "traktor")).toBe("gold");
  });

  it("blank Traktor cell with a note is noted", () => {
    const noted = { ...goGet, note: { text: "buy it", side: "traktor" as const } };
    expect(noteCellState(noted, "traktor")).toBe("noted");
  });

  it("blank Spotify cell without a note is clear", () => {
    expect(noteCellState(trakOnly, "spotify")).toBe("clear");
  });

  it("blank Spotify cell with a note is the same noted", () => {
    const noted = {
      ...trakOnly,
      note: { text: "don't care", side: "spotify" as const },
    };
    expect(noteCellState(noted, "spotify")).toBe("noted");
  });

  it("non-blank cells are filled and never editable", () => {
    const matched = row();
    expect(noteCellState(matched, "traktor")).toBe("filled");
    expect(noteCellState(matched, "spotify")).toBe("filled");
    expect(isNoteEditable(matched, "traktor")).toBe(false);
    expect(isNoteEditable(matched, "spotify")).toBe(false);
  });

  it("a note on one side does not turn the other side noted", () => {
    const noted = { ...goGet, note: { text: "x", side: "spotify" as const } };
    expect(noteCellState(noted, "traktor")).toBe("gold");
  });

  it("keys notes on the populated side's join key (§5.2)", () => {
    expect(noteJoinKey(goGet, "traktor")).toBe("wantedtrack");
    expect(noteJoinKey(trakOnly, "spotify")).toBe("ownedtrack");
  });

  it("blank editable cells require a join key", () => {
    expect(isNoteEditable(goGet, "traktor")).toBe(true);
    expect(isNoteEditable(trakOnly, "spotify")).toBe(true);
    // a pathological row with no key on the populated side is not editable
    const keyless = { ...goGet, spotify_trackjoin: "" };
    expect(isNoteEditable(keyless, "traktor")).toBe(false);
  });
});

describe("filter combination logic (§8, AND semantics)", () => {
  const match = row();
  const notedGap = { ...goGet, note: { text: "n", side: "traktor" as const } };
  const rows = [match, goGet, notedGap, trakOnly, organize];

  it("no filters returns every row", () => {
    expect(applyFilters(rows, EMPTY_FILTERS)).toHaveLength(5);
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
  });

  it("flag multi-select keeps only selected flags", () => {
    const f = {
      ...EMPTY_FILTERS,
      flags: [
        "Not-Trak-Collection",
        "Not-Trak-Playlist / Yes-Trak-Collection",
      ] as PresenceFlag[],
    };
    expect(applyFilters(rows, f)).toEqual([goGet, notedGap, organize]);
    expect(filtersActive(f)).toBe(true);
  });

  it("hide matched drops only Yes-Trak-Playlist rows", () => {
    const f = { ...EMPTY_FILTERS, hideMatched: true };
    expect(applyFilters(rows, f)).toEqual([goGet, notedGap, trakOnly, organize]);
  });

  it("noted-cells filter keeps only rows with a note", () => {
    const f = { ...EMPTY_FILTERS, notedOnly: true };
    expect(applyFilters(rows, f)).toEqual([notedGap]);
  });

  it("filters AND-combine", () => {
    const f = {
      flags: ["Not-Trak-Collection"] as PresenceFlag[],
      notedOnly: true,
      hideMatched: true,
    };
    expect(applyFilters(rows, f)).toEqual([notedGap]);
    // noted + a flag that has no noted rows -> empty
    const f2 = {
      flags: ["Not-Spotify / Yes-Trak-Playlist"] as PresenceFlag[],
      notedOnly: true,
      hideMatched: false,
    };
    expect(applyFilters(rows, f2)).toEqual([]);
  });

  it("toggleFlagFilter adds then removes a flag", () => {
    let f = toggleFlagFilter(EMPTY_FILTERS, "Not-Trak-Collection");
    expect(f.flags).toEqual(["Not-Trak-Collection"]);
    f = toggleFlagFilter(f, "Not-Trak-Collection");
    expect(f.flags).toEqual([]);
  });
});

describe("sorting (§7)", () => {
  const a = row({ traktor_title: "Alpha", flag: "Yes-Trak-Playlist" });
  const b = { ...goGet }; // blank traktor title, flag label "Go get"
  const c = row({
    traktor_title: "beta",
    flag: "Not-Spotify / Yes-Trak-Playlist",
  });
  const rows = [c, a, b];

  it("null sort preserves the pipeline (track_collate) order", () => {
    expect(sortRows(rows, null)).toEqual(rows);
  });

  it("sorts a text column case-insensitively with blanks last", () => {
    const asc = sortRows(rows, { column: "traktorTrack", dir: "asc" });
    expect(asc.map((r) => r.traktor_title)).toEqual(["Alpha", "beta", ""]);
    const desc = sortRows(rows, { column: "traktorTrack", dir: "desc" });
    expect(desc.map((r) => r.traktor_title)).toEqual(["beta", "Alpha", ""]);
  });

  it("flag column sorts alphabetically by display label", () => {
    const asc = sortRows(rows, { column: "flag", dir: "asc" });
    expect(asc.map((r) => flagLabel(r.flag))).toEqual([
      "Go get",
      "Match",
      "Traktor® only",
    ]);
  });

  it("is a stable sort (equal keys keep pipeline order)", () => {
    const x = row({ traktor_title: "Same", spotify_track_name: "First" });
    const y = row({ traktor_title: "Same", spotify_track_name: "Second" });
    const sorted = sortRows([x, y], { column: "traktorTrack", dir: "asc" });
    expect(sorted.map((r) => r.spotify_track_name)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("header-click cycles asc → desc → default", () => {
    const s1 = nextSort(null, "flag");
    expect(s1).toEqual({ column: "flag", dir: "asc" });
    const s2 = nextSort(s1, "flag");
    expect(s2).toEqual({ column: "flag", dir: "desc" });
    expect(nextSort(s2, "flag")).toBeNull();
    // clicking a different column starts asc there
    expect(nextSort(s2, "spotifyTrack")).toEqual({
      column: "spotifyTrack",
      dir: "asc",
    });
  });
});

describe("summary lines (§9) and links (§6)", () => {
  it('composes the exact "N tracks · M not matched to Traktor®" line', () => {
    expect(summaryLine(646, 105)).toBe("646 tracks · 105 not matched to Traktor®");
    expect(summaryLine(1, 0)).toBe("1 track · 0 not matched to Traktor®");
  });

  it("composes the filtered-count text", () => {
    expect(filteredCountText(141, 646)).toBe("141 of 646 tracks");
  });

  it("composes the notes carry-forward summary", () => {
    expect(notesSummaryText({ restored: 0, dropped: 2 })).toBe(
      "2 notes dropped (gaps resolved)",
    );
    expect(notesSummaryText({ restored: 1, dropped: 1 })).toBe(
      "1 note restored · 1 note dropped (gaps resolved)",
    );
    expect(notesSummaryText({ restored: 0, dropped: 0 })).toBeNull();
    expect(notesSummaryText(null)).toBeNull();
  });

  it("renders spotify URIs as open.spotify.com links", () => {
    expect(spotifyTrackUrl("spotify:track:2XZT7w9AtfsE9ICdUBV9RG")).toBe(
      "https://open.spotify.com/track/2XZT7w9AtfsE9ICdUBV9RG",
    );
    expect(spotifyTrackUrl("")).toBeNull();
    expect(spotifyTrackUrl("spotify:album:xyz")).toBeNull();
    expect(spotifyTrackUrl("javascript:alert(1)")).toBeNull();
  });
});

// ComparePage keeps itself mounted across tab switches (#22 — no key={slug}
// remount), so per-playlist view state is reset on slug change to the values
// below. These assert the leak-prevention contract in pure terms: the reset
// targets (EMPTY_FILTERS + null sort), applied to the next playlist's rows,
// must reproduce that playlist's full, untouched, pipeline-ordered view — i.e.
// the previous playlist's filtering/sorting can never carry over.
describe("per-playlist state reset on tab switch (#22)", () => {
  const match = row();
  const nextPlaylistRows = [organize, match, goGet, trakOnly];

  it("reset filters (EMPTY_FILTERS) show every row of the next playlist", () => {
    // Previous playlist had an active flag filter + noted-only.
    const prevFilters = {
      flags: ["Not-Trak-Collection"] as PresenceFlag[],
      notedOnly: true,
      hideMatched: true,
    };
    expect(applyFilters(nextPlaylistRows, prevFilters).length).toBeLessThan(
      nextPlaylistRows.length,
    );
    // After reset, nothing is filtered out.
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
    expect(applyFilters(nextPlaylistRows, EMPTY_FILTERS)).toEqual(
      nextPlaylistRows,
    );
  });

  it("reset sort (null) restores the next playlist's pipeline order", () => {
    const prevSort = {
      column: "traktorTrack" as SortColumn,
      dir: "desc" as const,
    };
    // The previous playlist's sort would reorder these rows...
    expect(sortRows(nextPlaylistRows, prevSort)).not.toEqual(nextPlaylistRows);
    // ...but the reset value (null) leaves pipeline order intact.
    expect(sortRows(nextPlaylistRows, null)).toEqual(nextPlaylistRows);
  });
});

// ---------------------------------------------------------------------------
// Column visibility (issue #20, ruling R5): shared across ALL compare
// playlists, persisted in one per-screen localStorage key (not per-playlist,
// not uiStore). The vitest env is "node" (no localStorage), so we stub an
// in-memory store.
// ---------------------------------------------------------------------------

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe("column visibility (#20 / R5)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults: 4 artist/album columns OFF; file + link ON; track cols ON", () => {
    const v = defaultColumnVisibility();
    // The four opt-in columns are hidden by default.
    expect(v.traktorArtist).toBe(false);
    expect(v.traktorAlbum).toBe(false);
    expect(v.spotifyArtist).toBe(false);
    expect(v.spotifyAlbum).toBe(false);
    // The existing default view (flag · track · track · file · link) stays on.
    expect(v.flag).toBe(true);
    expect(v.traktorTrack).toBe(true);
    expect(v.spotifyTrack).toBe(true);
    expect(v.file).toBe(true);
    expect(v.link).toBe(true);
  });

  it("default visible set is exactly the original 5-column view, in order", () => {
    expect(visibleColumns(defaultColumnVisibility()).map((c) => c.id)).toEqual([
      "flag",
      "traktorTrack",
      "spotifyTrack",
      "file",
      "link",
    ]);
  });

  it("renders visible columns in the fixed #20 order when all are on", () => {
    const all = COMPARE_COLUMNS.reduce((acc, c) => {
      acc[c.id] = true;
      return acc;
    }, {} as ColumnVisibility);
    expect(visibleColumns(all).map((c) => c.id)).toEqual([
      "flag",
      "traktorTrack",
      "traktorArtist",
      "traktorAlbum",
      "spotifyTrack",
      "spotifyArtist",
      "spotifyAlbum",
      "file",
      "link",
    ]);
  });

  it("persists to (and reloads from) the per-screen localStorage key", () => {
    const v = setColumnVisible(defaultColumnVisibility(), "traktorArtist", true);
    saveColumnVisibility(v);
    // The single shared key holds the whole state (not keyed by playlist).
    expect(localStorage.getItem(COLUMN_VISIBILITY_KEY)).toContain(
      "traktorArtist",
    );
    // A fresh load (e.g. after reload, or on any other playlist tab) sees it.
    const reloaded = loadColumnVisibility();
    expect(reloaded.traktorArtist).toBe(true);
    expect(reloaded.spotifyAlbum).toBe(false);
  });

  it("load falls back to defaults when storage is empty or malformed", () => {
    expect(loadColumnVisibility()).toEqual(defaultColumnVisibility());
    localStorage.setItem(COLUMN_VISIBILITY_KEY, "not json{");
    expect(loadColumnVisibility()).toEqual(defaultColumnVisibility());
  });

  it("shared across playlists: one key drives every playlist's columns", () => {
    // Turn a column on "on playlist A", persist, then "open playlist B" (a
    // fresh load): the choice is already there — there is no per-slug key.
    saveColumnVisibility(
      setColumnVisible(defaultColumnVisibility(), "spotifyAlbum", true),
    );
    const onPlaylistB = loadColumnVisibility();
    expect(onPlaylistB.spotifyAlbum).toBe(true);
  });

  it("enforces non-hideable columns: they cannot be turned off", () => {
    let v = defaultColumnVisibility();
    for (const id of ["flag", "traktorTrack", "spotifyTrack"] as const) {
      v = setColumnVisible(v, id, false);
      expect(v[id]).toBe(true); // refused — stays visible
    }
  });

  it("forces non-hideable columns on even if storage says otherwise", () => {
    // Simulate a tampered/stale payload hiding the track columns.
    localStorage.setItem(
      COLUMN_VISIBILITY_KEY,
      JSON.stringify({ flag: false, traktorTrack: false, spotifyTrack: false }),
    );
    const v = loadColumnVisibility();
    expect(v.flag).toBe(true);
    expect(v.traktorTrack).toBe(true);
    expect(v.spotifyTrack).toBe(true);
  });

  it("hideable columns toggle both directions", () => {
    let v = defaultColumnVisibility();
    v = setColumnVisible(v, "file", false); // hide an on-by-default column
    expect(v.file).toBe(false);
    v = setColumnVisible(v, "traktorAlbum", true); // show an off-by-default column
    expect(v.traktorAlbum).toBe(true);
    expect(visibleColumns(v).map((c) => c.id)).toEqual([
      "flag",
      "traktorTrack",
      "traktorAlbum",
      "spotifyTrack",
      "link",
    ]);
  });
});

describe("markdown links in comparison notes (#142)", () => {
  describe("isPastedUrl", () => {
    it("recognises the URLs a note link would use", () => {
      expect(isPastedUrl("https://open.spotify.com/track/abc")).toBe(true);
      expect(isPastedUrl("http://example.com")).toBe(true);
      expect(isPastedUrl("  https://example.com  ")).toBe(true);
      expect(isPastedUrl("www.example.com")).toBe(true);
      expect(isPastedUrl("mailto:me@example.com")).toBe(true);
    });

    it("leaves ordinary pasted text alone", () => {
      expect(isPastedUrl("just some text")).toBe(false);
      expect(isPastedUrl("")).toBe(false);
      expect(isPastedUrl("https://a.com and more")).toBe(false);
    });
  });

  describe("applyLinkPaste", () => {
    it("wraps the selected text as a markdown link", () => {
      const r = applyLinkPaste("get the remix", 4, 13, "https://x.com/a");
      expect(r.text).toBe("get [the remix](https://x.com/a)");
      expect(r.caret).toBe(r.text.length);
    });

    it("inserts the bare URL when nothing is selected", () => {
      // Wrapping an empty selection would make an invisible `[](url)` link.
      const r = applyLinkPaste("see ", 4, 4, "https://x.com/a");
      expect(r.text).toBe("see https://x.com/a");
    });

    it("keeps the surrounding text intact", () => {
      const r = applyLinkPaste("abcdef", 2, 4, "https://x.com");
      expect(r.text).toBe("ab[cd](https://x.com)ef");
    });
  });

  describe("parseNoteSegments", () => {
    it("splits a link out of surrounding text", () => {
      expect(parseNoteSegments("go [here](https://x.com) now")).toEqual([
        { kind: "text", text: "go " },
        { kind: "link", text: "here", url: "https://x.com" },
        { kind: "text", text: " now" },
      ]);
    });

    it("handles a note that is nothing but a link", () => {
      expect(parseNoteSegments("[x](https://x.com)")).toEqual([
        { kind: "link", text: "x", url: "https://x.com" },
      ]);
    });

    it("finds more than one link", () => {
      const segs = parseNoteSegments("[a](https://a.com) and [b](https://b.com)");
      expect(segs.filter((s) => s.kind === "link")).toHaveLength(2);
    });

    it("renders malformed markdown as literal text rather than crashing", () => {
      for (const bad of [
        "[unclosed](https://x.com",
        "[no url]()",
        "](https://x.com)[",
        "[](https://x.com)", // empty label — would be an invisible link
        "plain text",
        "",
      ]) {
        const segs = parseNoteSegments(bad);
        expect(segs.every((s) => s.kind === "text")).toBe(true);
        expect(segs.map((s) => s.text).join("")).toBe(bad);
      }
    });

    it("refuses schemes it will not open, leaving them literal", () => {
      const segs = parseNoteSegments("[x](javascript:alert(1))");
      expect(segs.every((s) => s.kind === "text")).toBe(true);
      expect(parseNoteSegments("[x](/etc/passwd)").every((s) => s.kind === "text")).toBe(
        true,
      );
    });

    it("interprets ONLY the link syntax — this is not a markdown editor", () => {
      const segs = parseNoteSegments("**bold** and # heading");
      expect(segs).toEqual([{ kind: "text", text: "**bold** and # heading" }]);
    });

    it("round-trips the original text when segments are rejoined", () => {
      const note = "see [the remix](https://x.com/a) before **Friday**";
      const rebuilt = parseNoteSegments(note)
        .map((s) => (s.kind === "link" ? `[${s.text}](${s.url})` : s.text))
        .join("");
      expect(rebuilt).toBe(note);
    });
  });

  describe("noteHasLink / noteForExport", () => {
    it("detects a link", () => {
      expect(noteHasLink("[a](https://a.com)")).toBe(true);
      expect(noteHasLink("no link here")).toBe(false);
    });

    it("exports the bare URL, dropping the title (forward-looking rule)", () => {
      expect(noteForExport("go [here](https://x.com) now")).toBe(
        "go https://x.com now",
      );
      expect(noteForExport("plain note")).toBe("plain note");
    });
  });
});
