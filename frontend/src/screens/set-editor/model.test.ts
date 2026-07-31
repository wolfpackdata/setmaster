import { describe, expect, it } from "vitest";
import {
  DEFAULT_I_LIKE,
  bpmDirection,
  canonicalizeKey,
  computeStats,
  computeTiming,
  deriveOuts,
  fmtBpmStat,
  fmtHMM,
  fmtMinutes,
  fmtMinutes1,
  hasIncompleteTiming,
  makeEmptyRow,
  moveBlock,
  moveDropsOutSideData,
  moveRowsPreservingOutSide,
  normalizeMss,
  parseBpm,
  parseMss,
  parseNameTags,
  rowHasContent,
  rowMinutes,
  timingOrderMsg,
  timingOrdered,
} from "./model";
import { EMPTY_ENUM } from "./columns";
import type { SetRow } from "../../lib/api";

function row(partial: Partial<SetRow>): SetRow {
  return { ...makeEmptyRow(), ...partial };
}

describe("makeEmptyRow / rowHasContent", () => {
  it("defaults I like to ⚠️ (§4.2)", () => {
    expect(makeEmptyRow().i_like).toBe(DEFAULT_I_LIKE);
  });

  it("a fresh row has no content", () => {
    expect(rowHasContent(makeEmptyRow())).toBe(false);
  });

  it("any real value counts as content, changed emoji included", () => {
    expect(rowHasContent(row({ in_name: "Track" }))).toBe(true);
    expect(rowHasContent(row({ bpm: "124" }))).toBe(true);
    expect(rowHasContent(row({ m_num: "#3" }))).toBe(true);
    expect(rowHasContent(row({ i_like: "✅" }))).toBe(true);
    expect(rowHasContent(row({ start: "1:00" }))).toBe(true);
  });
});

describe("deriveOuts (§4.2: Out mirrors previous row's In; first row has no Out)", () => {
  it("first row has an empty Out side", () => {
    const outs = deriveOuts([row({ in_name: "A", in_delta: "+1" })]);
    expect(outs[0]).toEqual({ name: "", delta: "" });
  });

  it("each row mirrors the PREVIOUS row's In name/Δ, trimmed", () => {
    const rows = [
      row({ in_name: "  Alpha ", in_delta: "+0.5" }),
      row({ in_name: "Beta", in_delta: "---" }),
      row({ in_name: "Gamma" }),
    ];
    const outs = deriveOuts(rows);
    expect(outs[1]).toEqual({ name: "Alpha", delta: "+0.5" });
    expect(outs[2]).toEqual({ name: "Beta", delta: "---" });
  });

  it("reordering rows re-derives the mirrors (formula semantics, not stored)", () => {
    const rows = [
      row({ in_name: "One" }),
      row({ in_name: "Two" }),
      row({ in_name: "Three" }),
    ];
    const moved = moveBlock(rows, 2, 1, 0); // Three to the top
    const outs = deriveOuts(moved);
    expect(moved.map((r) => r.in_name)).toEqual(["Three", "One", "Two"]);
    expect(outs.map((o) => o.name)).toEqual(["", "Three", "One"]);
  });
});

describe("parseMss (m:ss text, §4.2)", () => {
  it("parses valid m:ss", () => {
    expect(parseMss("0:00")).toBe(0);
    expect(parseMss("3:45")).toBe(225);
    expect(parseMss("12:05")).toBe(725);
    expect(parseMss("180:59")).toBe(180 * 60 + 59); // 3-hour sets
    expect(parseMss(" 4:20 ")).toBe(260);
  });

  it("rejects blank and unparseable text", () => {
    expect(parseMss("")).toBeNull();
    expect(parseMss("   ")).toBeNull();
    expect(parseMss("abc")).toBeNull();
    expect(parseMss("3:75")).toBeNull(); // seconds > 59
    expect(parseMss("3:5")).toBeNull(); // seconds must be 2 digits
    expect(parseMss("3.45")).toBeNull();
    expect(parseMss("-1:00")).toBeNull();
    expect(parseMss("1:2:3")).toBeNull();
  });
});

describe("normalizeMss (Start/Transition commit validation, issue #25)", () => {
  // Every row of the issue-body conversion table.
  it.each([
    ["1:01", "1:01"], // already M:SS
    ["101", "1:01"], // plain number: last 2 = seconds, rest = minutes
    ["30", "0:30"],
    ["5", "0:05"],
    ["1234", "12:34"],
    ["1;30", "1:30"], // ; . , all treated as :
    ["1.30", "1:30"],
    ["1,30", "1:30"],
  ])("converts %s → %s", (input, expected) => {
    expect(normalizeMss(input)).toBe(expected);
  });

  it("normalizes minute leading zeros and stray whitespace", () => {
    expect(normalizeMss(" 1:30 ")).toBe("1:30");
    expect(normalizeMss("01:30")).toBe("1:30");
    expect(normalizeMss("0:00")).toBe("0:00");
    expect(normalizeMss("100")).toBe("1:00");
    expect(normalizeMss("00")).toBe("0:00");
  });

  it("accepts unbounded minutes (3-hour sets)", () => {
    expect(normalizeMss("180:59")).toBe("180:59");
    expect(normalizeMss("18059")).toBe("180:59");
  });

  it("treats a lone . / , / ; as a colon (not a decimal)", () => {
    expect(normalizeMss("3.45")).toBe("3:45");
    expect(normalizeMss("12,05")).toBe("12:05");
  });

  it("rejects letters, garbage and blank", () => {
    expect(normalizeMss("")).toBeNull();
    expect(normalizeMss("   ")).toBeNull();
    expect(normalizeMss("abc")).toBeNull();
    expect(normalizeMss("1m30")).toBeNull();
    expect(normalizeMss("1:3o")).toBeNull();
  });

  it("rejects seconds > 59 (separated and pure-digit)", () => {
    expect(normalizeMss("1:75")).toBeNull();
    expect(normalizeMss("12:60")).toBeNull();
    expect(normalizeMss("170")).toBeNull(); // 1:70
    expect(normalizeMss("60")).toBeNull(); // 0:60
  });

  it("rejects one-digit seconds and empty seconds", () => {
    expect(normalizeMss("1:5")).toBeNull();
    expect(normalizeMss("1:")).toBeNull();
    expect(normalizeMss(":30")).toBeNull();
  });

  it("rejects multiple separators and negatives", () => {
    expect(normalizeMss("1:2:3")).toBeNull();
    expect(normalizeMss("1.30.5")).toBeNull();
    expect(normalizeMss("-1:00")).toBeNull();
  });

  it("output round-trips through parseMss (stored value is canonical)", () => {
    for (const input of ["5", "30", "101", "1234", "1;30", "3.45", "180:59"]) {
      const norm = normalizeMss(input)!;
      expect(parseMss(norm)).not.toBeNull();
    }
  });
});

describe("rowMinutes (SM2 `=ROUND(HOUR(R-Q) + MINUTE(R-Q)/60, 2)`)", () => {
  it("transition − start in minutes, rounded to 2", () => {
    expect(rowMinutes("1:00", "4:30")).toBe(3.5);
    expect(rowMinutes("0:00", "0:20")).toBe(0.33);
    expect(rowMinutes("2:15", "2:15")).toBe(0);
  });

  it("blank/unparseable/negative → null (blank cell)", () => {
    expect(rowMinutes("", "4:30")).toBeNull();
    expect(rowMinutes("1:00", "")).toBeNull();
    expect(rowMinutes("junk", "4:30")).toBeNull();
    expect(rowMinutes("5:00", "4:00")).toBeNull();
  });
});

describe("computeTiming (SM2 cols S/T: Play Time + running Mix Timer)", () => {
  it("accumulates across rows, blank rows stay blank without breaking the chain", () => {
    const rows = [
      row({ start: "1:00", transition: "4:00" }), // 3
      row({}), // blank
      row({ start: "0:30", transition: "2:00" }), // 1.5
    ];
    const t = computeTiming(rows);
    expect(t.mins).toEqual([3, null, 1.5]);
    expect(t.cumulative).toEqual([3, null, 4.5]);
    expect(t.mixLength).toBe(4.5);
  });

  it("no timing anywhere → null mixLength", () => {
    expect(computeTiming([row({}), row({})]).mixLength).toBeNull();
  });
});

describe("computeStats (the four SM2 stats, code reference §3.2)", () => {
  it("# Tracks counts rows with a non-empty In name (COUNTA)", () => {
    const rows = [
      row({ in_name: "A" }),
      row({ in_name: "   " }),
      row({ in_name: "B" }),
      row({}),
    ];
    expect(computeStats(rows).trackCount).toBe(2);
  });

  it("BPM Avg. and Crest over numeric BPM cells only", () => {
    const rows = [
      row({ bpm: "120" }),
      row({ bpm: "128.5" }),
      row({ bpm: "not-a-bpm" }),
      row({ bpm: "" }),
      row({ bpm: "116" }),
    ];
    const s = computeStats(rows);
    expect(s.bpmAvg).toBeCloseTo((120 + 128.5 + 116) / 3, 6);
    expect(s.bpmCrest).toBeCloseTo(12.5, 6);
  });

  it("empty set → nulls (rendered as SM2's --- / ----- placeholders)", () => {
    const s = computeStats([row({})]);
    expect(s.trackCount).toBe(0);
    expect(s.mixLength).toBeNull();
    expect(s.bpmAvg).toBeNull();
    expect(s.bpmCrest).toBeNull();
  });

  it("Mix Length is the max cumulative minutes", () => {
    const rows = [
      row({ start: "0:00", transition: "60:00" }),
      row({ start: "0:00", transition: "24:32" }),
    ];
    expect(computeStats(rows).mixLength).toBeCloseTo(84.53, 2);
  });
});

describe("stat display formatting", () => {
  it("minutes render without trailing-zero padding (SM2 shows 84.53, 3.5)", () => {
    expect(fmtMinutes(84.53)).toBe("84.53");
    expect(fmtMinutes(3.5)).toBe("3.5");
    expect(fmtMinutes(3)).toBe("3");
  });
  it("BPM stats round to 1 dp", () => {
    expect(fmtBpmStat(121.4833)).toBe("121.5");
    expect(fmtBpmStat(12)).toBe("12");
  });
});

describe("fmtMinutes1 (grid Play Time / Mix Timer cells, issue #70)", () => {
  it("rounds to 1 dp — never truncates", () => {
    expect(fmtMinutes1(84.53)).toBe("84.5");
    expect(fmtMinutes1(3.44)).toBe("3.4");
    expect(fmtMinutes1(3.46)).toBe("3.5");
    expect(fmtMinutes1(0.33)).toBe("0.3");
  });

  it("rounds 2-dp halves up despite float artifacts (3.45 → 3.5, not 3.4)", () => {
    expect(fmtMinutes1(3.45)).toBe("3.5");
    expect(fmtMinutes1(8.45)).toBe("8.5");
  });

  it("keeps the SM2-style no-padding display", () => {
    expect(fmtMinutes1(3.5)).toBe("3.5");
    expect(fmtMinutes1(12)).toBe("12");
    expect(fmtMinutes1(0)).toBe("0");
  });
});

describe("fmtHMM (Mix Length STAT H:MM display, issue #82)", () => {
  it("rounds decimal minutes to the nearest whole minute", () => {
    expect(fmtHMM(84.53)).toBe("1:25"); // 84.53 → 85 → 1:25
    expect(fmtHMM(84.4)).toBe("1:24"); // 84.4 → 84 → 1:24
  });

  it("renders sub-hour totals with a leading 0 hour", () => {
    expect(fmtHMM(47)).toBe("0:47");
    expect(fmtHMM(0)).toBe("0:00");
    expect(fmtHMM(5.4)).toBe("0:05");
  });

  it("always pads minutes to two digits", () => {
    expect(fmtHMM(65)).toBe("1:05");
    expect(fmtHMM(60)).toBe("1:00");
  });

  it("rolls a rounded 60th minute into the next hour (119.6 → 2:00)", () => {
    expect(fmtHMM(119.6)).toBe("2:00");
    expect(fmtHMM(119.4)).toBe("1:59");
  });

  it("handles multi-hour sets", () => {
    expect(fmtHMM(185)).toBe("3:05");
  });
});

describe("hasIncompleteTiming (Out-Track rows missing timing, issue #82)", () => {
  it("is false when there are no Out-Track rows at all", () => {
    // First row has no Out side; a lone row never triggers the warning.
    expect(hasIncompleteTiming([row({ in_name: "A" })])).toBe(false);
    expect(hasIncompleteTiming([row({})])).toBe(false);
  });

  it("is true when an Out-Track row has no computable timing", () => {
    // Row 1's Out Track = row 0's In name ("A"); row 1 lacks Start/Transition.
    const rows = [row({ in_name: "A" }), row({ in_name: "B" })];
    expect(hasIncompleteTiming(rows)).toBe(true);
  });

  it("is false when every Out-Track row has valid Start + Transition", () => {
    const rows = [
      row({ in_name: "A" }),
      row({ in_name: "B", start: "1:00", transition: "4:30" }),
    ];
    expect(hasIncompleteTiming(rows)).toBe(false);
  });

  it("ignores rows that have timing but no Out Track name", () => {
    // Row 0 has no Out side even with timing typed → not a trigger.
    const rows = [row({ start: "1:00", transition: "4:30" })];
    expect(hasIncompleteTiming(rows)).toBe(false);
  });

  it("treats unparseable or reversed timing as incomplete", () => {
    const unparseable = [row({ in_name: "A" }), row({ in_name: "B", start: "junk", transition: "4:30" })];
    expect(hasIncompleteTiming(unparseable)).toBe(true);
    const reversed = [row({ in_name: "A" }), row({ in_name: "B", start: "4:30", transition: "1:00" })];
    expect(hasIncompleteTiming(reversed)).toBe(true);
  });

  it("flags the set when only some Out-Track rows are missing timing", () => {
    const rows = [
      row({ in_name: "A" }),
      row({ in_name: "B", start: "1:00", transition: "4:30" }),
      row({ in_name: "C" }), // Out Track = "B", no timing
    ];
    expect(hasIncompleteTiming(rows)).toBe(true);
  });
});

describe("timingOrdered (Start < Transition commit validation, issue #70)", () => {
  it("accepts Start strictly before Transition", () => {
    expect(timingOrdered("1:00", "4:30")).toBe(true);
    expect(timingOrdered("0:00", "0:01")).toBe(true);
  });

  it("rejects Start at or after Transition", () => {
    expect(timingOrdered("4:30", "1:00")).toBe(false);
    expect(timingOrdered("2:15", "2:15")).toBe(false);
  });

  it("never blocks when either side is blank or unparseable", () => {
    expect(timingOrdered("", "4:30")).toBe(true);
    expect(timingOrdered("1:00", "")).toBe(true);
    expect(timingOrdered("", "")).toBe(true);
    expect(timingOrdered("junk", "0:01")).toBe(true);
    expect(timingOrdered("99:00", "junk")).toBe(true);
  });

  it("rejection message names the other cell's value", () => {
    expect(timingOrderMsg("start", "4:30")).toBe(
      "Start must be before Transition (4:30).",
    );
    expect(timingOrderMsg("transition", "5:00")).toBe(
      "Transition must be after Start (5:00).",
    );
  });
});

describe("parseNameTags ([TAG] chips, §5.2)", () => {
  it("parses a single leading bracketed prefix", () => {
    expect(parseNameTags("[UNSYNC] Blue Monday")).toEqual({
      tags: ["UNSYNC"],
      text: "Blue Monday",
    });
  });

  it("parses stacked leading tags", () => {
    expect(parseNameTags("[UNSYNC][EDIT] Foo")).toEqual({
      tags: ["UNSYNC", "EDIT"],
      text: "Foo",
    });
  });

  it("leaves mid-name brackets alone", () => {
    expect(parseNameTags("Song [Extended Mix]")).toEqual({
      tags: [],
      text: "Song [Extended Mix]",
    });
  });

  it("no tags → text unchanged (whitespace preserved)", () => {
    expect(parseNameTags("  Plain Name")).toEqual({
      tags: [],
      text: "  Plain Name",
    });
  });

  it("empty brackets are not a tag", () => {
    expect(parseNameTags("[] Weird")).toEqual({ tags: [], text: "[] Weird" });
  });
});

describe("moveBlock (row reordering)", () => {
  const arr = ["a", "b", "c", "d", "e"];

  it("moves a single row down", () => {
    expect(moveBlock(arr, 0, 1, 2)).toEqual(["b", "a", "c", "d", "e"]);
  });

  it("moves a single row up", () => {
    expect(moveBlock(arr, 3, 1, 1)).toEqual(["a", "d", "b", "c", "e"]);
  });

  it("moves a multi-row block", () => {
    expect(moveBlock(arr, 1, 2, 5)).toEqual(["a", "d", "e", "b", "c"]);
    expect(moveBlock(arr, 3, 2, 0)).toEqual(["d", "e", "a", "b", "c"]);
  });

  it("gaps inside (or hugging) the block are no-ops", () => {
    expect(moveBlock(arr, 1, 2, 1)).toEqual(arr);
    expect(moveBlock(arr, 1, 2, 2)).toEqual(arr);
    expect(moveBlock(arr, 1, 2, 3)).toEqual(arr);
  });

  it("out-of-range args return a copy unchanged", () => {
    expect(moveBlock(arr, -1, 1, 0)).toEqual(arr);
    expect(moveBlock(arr, 4, 2, 0)).toEqual(arr);
  });
});

describe("moveRowsPreservingOutSide (#133 — Out side follows the Out Track)", () => {
  /**
   * Four tracks A B C D. Each row's In side names its own track; its Out side
   * carries values tagged with the track they describe — the one stored one row
   * EARLIER. Track A's Out side therefore lives on row 1, B's on row 2, C's on
   * row 3, and D (last) has none. Row 0's Out side is the phantom slot: it
   * describes nothing, so it is seeded with a value that must never travel.
   */
  const fixture = (): SetRow[] => [
    row({ id: "rA", in_name: "A", bpm: "999", key: "PHANTOM", t_num: "#9", start: "9:00", transition: "9:30" }),
    row({ id: "rB", in_name: "B", bpm: "101", key: "Am", t_num: "#1", a_num: "#1", start: "0:10", transition: "1:10" }),
    row({ id: "rC", in_name: "C", bpm: "102", key: "Bm", t_num: "#2", a_num: "#2", start: "0:20", transition: "1:20" }),
    row({ id: "rD", in_name: "D", bpm: "103", key: "Cm", t_num: "#3", a_num: "#3", start: "0:30", transition: "1:30" }),
  ];

  /** `<track the row's Out side should describe>=<value it actually carries>`. */
  const assoc = (rows: readonly SetRow[]): string[] =>
    rows.map((r, i) => `${i === 0 ? "phantom" : rows[i - 1].in_name}=${r.bpm || "-"}`);

  const names = (rows: readonly SetRow[]): string[] => rows.map((r) => r.in_name);

  it("a single row moved up carries every Out-side field to the right track", () => {
    const moved = moveRowsPreservingOutSide(fixture(), 2, 1, 1); // C above B
    expect(names(moved)).toEqual(["A", "C", "B", "D"]);
    expect(assoc(moved)).toEqual([
      "phantom=999",
      "A=101",
      "C=103",
      "B=102",
    ]);
    // All six Out-side fields move together, not just BPM.
    expect(moved[2]).toMatchObject({
      bpm: "103", key: "Cm", t_num: "#3", a_num: "#3", start: "0:30", transition: "1:30",
    });
  });

  it("a single row moved down carries its Out side too", () => {
    const moved = moveRowsPreservingOutSide(fixture(), 1, 1, 3); // B below C
    expect(names(moved)).toEqual(["A", "C", "B", "D"]);
    expect(assoc(moved)).toEqual(["phantom=999", "A=101", "C=103", "B=102"]);
  });

  it("a block moved across the top boundary keeps its associations", () => {
    const moved = moveRowsPreservingOutSide(fixture(), 1, 2, 0); // B,C to the top
    expect(names(moved)).toEqual(["B", "C", "A", "D"]);
    expect(assoc(moved)).toEqual([
      "phantom=999", // row 0's Out side never travels
      "B=102",
      "C=103",
      "A=101",
    ]);
  });

  it("a track moved to the very bottom loses the Out side it can no longer store", () => {
    const moved = moveRowsPreservingOutSide(fixture(), 0, 1, 4); // A to the end
    expect(names(moved)).toEqual(["B", "C", "D", "A"]);
    expect(assoc(moved)).toEqual(["phantom=999", "B=102", "C=103", "D=-"]);
    // The last row's Out-side cells are cleared to their empty values, not left
    // holding the previous occupant's data.
    expect(moved[3]).toMatchObject({
      bpm: "", key: "", t_num: EMPTY_ENUM, a_num: EMPTY_ENUM, start: "", transition: "",
    });
  });

  describe("moveDropsOutSideData — the #166 guard on that loss", () => {
    it("fires when a track carrying Out-side data becomes last", () => {
      // A's Out side lives on row 1 and would have nowhere to go.
      expect(moveDropsOutSideData(fixture(), 0, 1, 4)).toBe(true);
      // Same for a block whose LAST member lands at the bottom.
      expect(moveDropsOutSideData(fixture(), 0, 2, 4)).toBe(true);
    });

    it("stays quiet when the bottom track does not change", () => {
      expect(moveDropsOutSideData(fixture(), 0, 1, 2)).toBe(false); // A between B and C
      expect(moveDropsOutSideData(fixture(), 2, 1, 1)).toBe(false); // C above B
    });

    it("fires when the track PUSHED to the bottom is not the one being moved", () => {
      // Move D (last, and the one track with no Out side of its own) UP to index
      // 1. That leaves C at the bottom, and C's Out side — stored on D's old row
      // — has nowhere to go. The loss follows whoever ENDS UP last, not whoever
      // was dragged, which is exactly the case a "did I move a row down?" check
      // would miss.
      expect(moveDropsOutSideData(fixture(), 3, 1, 1)).toBe(true);
      const moved = moveRowsPreservingOutSide(fixture(), 3, 1, 1);
      expect(names(moved)).toEqual(["A", "D", "B", "C"]);
      expect(moved[3].bpm).toBe("102"); // C's row carries B's Out side...
      expect(assoc(moved)).toEqual(["phantom=999", "A=101", "D=-", "B=102"]);
      // ...and C's own Out side (103) is nowhere in the result.
      expect(moved.map((r) => r.bpm)).not.toContain("103");
    });

    it("stays quiet when the track becoming last carries nothing to lose", () => {
      // Blank A's Out side (stored on row 1). Moving A to the bottom now drops
      // nothing, so the prompt must not appear — an empty row is the common case.
      const rows = fixture();
      rows[1] = {
        ...rows[1],
        bpm: "", key: "", t_num: EMPTY_ENUM, a_num: EMPTY_ENUM, start: "", transition: "",
      };
      expect(moveDropsOutSideData(rows, 0, 1, 4)).toBe(false);
    });

    it("fires on any single Out-side field, not just BPM", () => {
      const fields = [
        { key: "Am" }, { t_num: "#1" }, { a_num: "#2" },
        { start: "0:10" }, { transition: "1:10" },
      ];
      for (const only of fields) {
        const rows = fixture();
        rows[1] = {
          ...rows[1],
          bpm: "", key: "", t_num: EMPTY_ENUM, a_num: EMPTY_ENUM, start: "", transition: "",
          ...only,
        };
        expect(moveDropsOutSideData(rows, 0, 1, 4), JSON.stringify(only)).toBe(true);
      }
    });

    it("stays quiet on no-op and out-of-range moves", () => {
      expect(moveDropsOutSideData(fixture(), 1, 2, 2)).toBe(false);
      expect(moveDropsOutSideData(fixture(), -1, 1, 0)).toBe(false);
      expect(moveDropsOutSideData(fixture(), 3, 2, 0)).toBe(false);
      expect(moveDropsOutSideData([], 0, 1, 1)).toBe(false);
    });

    it("appending rows first is what makes the same move lossless", () => {
      // This is exactly what confirming the prompt does: append, then move.
      const rows = fixture();
      const padded = [...rows, row({ id: "p1", in_name: "" })];
      expect(moveDropsOutSideData(padded, 0, 1, 4)).toBe(false);
      const moved = moveRowsPreservingOutSide(padded, 0, 1, 4);
      expect(names(moved)).toEqual(["B", "C", "D", "A", ""]);
      // A keeps every one of its six Out-side values, now stored on the row below.
      expect(moved[4]).toMatchObject({
        bpm: "101", key: "Am", t_num: "#1", a_num: "#1", start: "0:10", transition: "1:10",
      });
    });
  });

  it("row 0 is untouched by a move that happens entirely below it", () => {
    const before = fixture();
    const moved = moveRowsPreservingOutSide(before, 3, 1, 1); // D up to index 1
    expect(moved[0]).toEqual(before[0]);
    expect(names(moved)).toEqual(["A", "D", "B", "C"]);
    expect(assoc(moved)).toEqual(["phantom=999", "A=101", "D=-", "B=102"]);
  });

  it("In-side fields and the row id travel with the row", () => {
    const moved = moveRowsPreservingOutSide(fixture(), 2, 1, 0); // C to the top
    expect(moved.map((r) => r.id)).toEqual(["rC", "rA", "rB", "rD"]);
    expect(names(moved)).toEqual(["C", "A", "B", "D"]);
  });

  it("no-op and out-of-range moves leave the rows unchanged", () => {
    const before = fixture();
    expect(moveRowsPreservingOutSide(before, 1, 2, 2)).toEqual(before);
    expect(moveRowsPreservingOutSide(before, -1, 1, 0)).toEqual(before);
    expect(moveRowsPreservingOutSide(before, 3, 2, 0)).toEqual(before);
  });

  it("Mix Timer stays a cumulative top-to-bottom sum after a move (verify, not build)", () => {
    const moved = moveRowsPreservingOutSide(fixture(), 1, 2, 0);
    const timing = computeTiming(moved);
    // Recomputed from scratch every render, so it must equal a running sum of
    // the per-row Play Time values in their NEW order.
    let running = 0;
    const expected = timing.mins.map((m) => {
      if (m === null) return null;
      running = Math.round((running + m) * 100) / 100;
      return running;
    });
    expect(timing.cumulative).toEqual(expected);
    expect(timing.mixLength).toBe(running);
  });
});

describe("canonicalizeKey (display-layer key parsing, §6.6)", () => {
  it("accepts all four notations, case-insensitively", () => {
    expect(canonicalizeKey("Gbm")).toBe("Gbm");
    expect(canonicalizeKey("F#m")).toBe("Gbm");
    expect(canonicalizeKey("11A")).toBe("Gbm");
    expect(canonicalizeKey("11a")).toBe("Gbm");
    expect(canonicalizeKey("4m")).toBe("Gbm");
    expect(canonicalizeKey("gm")).toBe("Gm");
    expect(canonicalizeKey(" C ")).toBe("C");
  });

  it("free text is not a key", () => {
    expect(canonicalizeKey("")).toBeNull();
    expect(canonicalizeKey("H")).toBeNull();
    expect(canonicalizeKey("Gm / Bb")).toBeNull();
    expect(canonicalizeKey("13A")).toBeNull();
  });
});

describe("bpmDirection (#138 — BPM cue vs the row above)", () => {
  it("flags a genuine numeric increase and decrease", () => {
    expect(bpmDirection("124", "128")).toBe("up");
    expect(bpmDirection("128", "124")).toBe("down");
    expect(bpmDirection("124", "124.5")).toBe("up");
  });

  it("renders nothing when there is nothing to compare", () => {
    expect(bpmDirection(undefined, "128")).toBeNull(); // first row
    expect(bpmDirection("128", "")).toBeNull(); // blank BPM
    expect(bpmDirection("", "128")).toBeNull(); // blank above
    expect(bpmDirection("   ", "128")).toBeNull(); // whitespace above
    expect(bpmDirection("128", "128")).toBeNull(); // equal
  });

  it("never coerces the free text a hand-typed cell can hold", () => {
    // BPM is typed by hand (§4.2), so non-numeric values are expected.
    expect(bpmDirection("128", "fast")).toBeNull();
    expect(bpmDirection("slow", "128")).toBeNull();
    // Number("") is 0 — a blank must not read as a drop from 128 to zero.
    expect(bpmDirection("128", " ")).toBeNull();
  });

  it("compares against the immediately preceding row, blank included", () => {
    // A blank row between two filled ones breaks the chain rather than
    // reaching further up for something to compare against.
    const rows = [row({ bpm: "124" }), row({ bpm: "" }), row({ bpm: "128" })];
    expect(bpmDirection(rows[1].bpm, rows[2].bpm)).toBeNull();
  });
});

describe("parseBpm (#138)", () => {
  it("reads numeric cells and rejects everything else", () => {
    expect(parseBpm("128")).toBe(128);
    expect(parseBpm(" 128.5 ")).toBe(128.5);
    expect(parseBpm("")).toBeNull();
    expect(parseBpm(undefined)).toBeNull();
    expect(parseBpm("128bpm")).toBeNull();
  });
});
