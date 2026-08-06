import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  COLUMN_BY_ID,
  FACTORY_LISTS,
  enumOptions,
  groupSpan,
  EMPTY_ENUM,
  isHotLevel,
  isLegacyEnumValue,
  isReadonlyOutSideCell,
  naturalCompare,
  navColsFor,
  timingCueHighlight,
  gridTemplateFor,
  tracksFor,
  TIMING_TRACK_IDS,
  type ColId,
  type GridTrack,
  type HideId,
  type Selection,
} from "./columns";

// Issue #72: OUT TRACK TIMING super-header over M # / T # / PLAY TIME, header
// renames (Start→M #, Transition→T #), and the calc-track renames.

const calcIndex = (tracks: GridTrack[], calc: "mins" | "mixlen") =>
  tracks.findIndex((t) => t.kind === "calc" && t.calc === calc);
const colIndex = (tracks: GridTrack[], id: ColId) =>
  tracks.findIndex((t) => t.kind === "col" && t.col?.id === id);

describe("timing columns (#72)", () => {
  it("Start/Transition render as M # / T # in the `timing` group", () => {
    const start = COLUMN_BY_ID.get("start")!;
    const transition = COLUMN_BY_ID.get("transition")!;
    expect(start.label).toBe("M #");
    expect(transition.label).toBe("T #");
    expect(start.group).toBe("timing");
    expect(transition.group).toBe("timing");
    // The Out-Track tooltip stays; the `· M#`/`· T#` cue suffix is gone (#72).
    expect(start.timingTip).toBeTruthy();
    expect(transition.timingTip).toBeTruthy();
    expect("cue" in start).toBe(false);
    expect("cue" in transition).toBe(false);
  });

  it("PLAY TIME (mins) sits contiguous with the timing columns, no spacer", () => {
    const tracks = tracksFor();
    const tIdx = colIndex(tracks, "transition");
    const minsIdx = calcIndex(tracks, "mins");
    // Transition is immediately followed by the mins calc track (no spacer).
    expect(minsIdx).toBe(tIdx + 1);
  });

  it("MIX TIMER (mixlen) stays outside the group, behind a spacer", () => {
    const tracks = tracksFor();
    const minsIdx = calcIndex(tracks, "mins");
    const mixlenIdx = calcIndex(tracks, "mixlen");
    expect(tracks[minsIdx + 1].kind).toBe("spacer");
    expect(mixlenIdx).toBe(minsIdx + 2);
  });
});

describe("OUT TRACK TIMING super-header span (#72)", () => {
  it("spans M # / T # / PLAY TIME when all are visible", () => {
    const tracks = tracksFor();
    const span = groupSpan("timing", tracks);
    const startIdx = colIndex(tracks, "start");
    const minsIdx = calcIndex(tracks, "mins");
    // 1-based grid lines: from the first timing member to just past PLAY TIME.
    expect(span.start).toBe(startIdx + 1);
    expect(span.end).toBe(minsIdx + 2);
    // Never reaches MIX TIMER.
    const mixlenIdx = calcIndex(tracks, "mixlen");
    expect(span.end).toBeLessThanOrEqual(mixlenIdx);
  });

  it("collapses to PLAY TIME alone when M #/T # are hidden (narrow)", () => {
    const hidden = new Set<ColId>(["start", "transition"]);
    const tracks = tracksFor(hidden);
    const span = groupSpan("timing", tracks);
    const minsIdx = calcIndex(tracks, "mins");
    expect(span.start).toBe(minsIdx + 1);
    expect(span.end).toBe(minsIdx + 2);
  });

  it("spans the remaining member when only T # is hidden", () => {
    const hidden = new Set<ColId>(["transition"]);
    const tracks = tracksFor(hidden);
    const span = groupSpan("timing", tracks);
    const startIdx = colIndex(tracks, "start");
    const minsIdx = calcIndex(tracks, "mins");
    // M # still contiguous with PLAY TIME (no spacer between them).
    expect(minsIdx).toBe(startIdx + 1);
    expect(span.start).toBe(startIdx + 1);
    expect(span.end).toBe(minsIdx + 2);
  });
});

// Issue #83: cue-cell highlight target + first-row read-only timing cells.

const single = (row: number, col: ColId): Selection => ({
  anchor: { row, col },
  focus: { row, col },
  fullRow: false,
});

const range = (
  aRow: number,
  aCol: ColId,
  fRow: number,
  fCol: ColId,
): Selection => ({
  anchor: { row: aRow, col: aCol },
  focus: { row: fRow, col: fCol },
  fullRow: false,
});

describe("timingCueHighlight (#83)", () => {
  it("timing M # (start) on row N → IN TRACK m_num on row N−1", () => {
    expect(timingCueHighlight(single(5, "start"))).toEqual({
      row: 4,
      col: "m_num",
    });
  });

  it("timing T # (transition) on row N → OUT TRACK t_num on the same row N", () => {
    expect(timingCueHighlight(single(5, "transition"))).toEqual({
      row: 5,
      col: "t_num",
    });
  });

  it("row-0 M # (start) → null (no row above; read-only cell)", () => {
    expect(timingCueHighlight(single(0, "start"))).toBeNull();
  });

  it("row-0 T # (transition) → null (read-only cell never highlights)", () => {
    expect(timingCueHighlight(single(0, "transition"))).toBeNull();
  });

  it("non-timing single selection → null", () => {
    expect(timingCueHighlight(single(3, "bpm"))).toBeNull();
    expect(timingCueHighlight(single(3, "m_num"))).toBeNull();
    expect(timingCueHighlight(single(3, "a_num"))).toBeNull();
  });

  it("range selection including a timing cell → null", () => {
    expect(timingCueHighlight(range(5, "start", 6, "start"))).toBeNull();
    expect(timingCueHighlight(range(5, "notes", 5, "transition"))).toBeNull();
  });

  it("full-row selection → null", () => {
    expect(
      timingCueHighlight({ ...single(5, "start"), fullRow: true }),
    ).toBeNull();
  });

  it("null selection → null", () => {
    expect(timingCueHighlight(null)).toBeNull();
  });
});

describe("isReadonlyOutSideCell (#83, widened by #165)", () => {
  it("row 0 start/transition are read-only", () => {
    expect(isReadonlyOutSideCell(0, "start")).toBe(true);
    expect(isReadonlyOutSideCell(0, "transition")).toBe(true);
  });

  it("row 0 BPM and Key are read-only too (#165)", () => {
    // Same side as the timing pair: stored ON the row while describing the
    // track one row EARLIER, so on row 1 they describe a track that isn't there.
    expect(isReadonlyOutSideCell(0, "bpm")).toBe(true);
    expect(isReadonlyOutSideCell(0, "key")).toBe(true);
  });

  it("row 0 In-side cells stay editable", () => {
    expect(isReadonlyOutSideCell(0, "in_name")).toBe(false);
    expect(isReadonlyOutSideCell(0, "in_delta")).toBe(false);
    expect(isReadonlyOutSideCell(0, "m_num")).toBe(false);
    expect(isReadonlyOutSideCell(0, "notes")).toBe(false);
  });

  it("leaves row 0 T # / A # editable — #165 asked for BPM and Key only", () => {
    // Both are Out-side and equally meaningless on row 1; widening to them was
    // not asked for, and is flagged on the issue rather than done unasked.
    expect(isReadonlyOutSideCell(0, "t_num")).toBe(false);
    expect(isReadonlyOutSideCell(0, "a_num")).toBe(false);
  });

  it("cells below row 0 are editable (position-based, not identity)", () => {
    for (const c of ["start", "transition", "bpm", "key"] as ColId[]) {
      expect(isReadonlyOutSideCell(1, c)).toBe(false);
      expect(isReadonlyOutSideCell(2, c)).toBe(false);
    }
  });
});

describe("BPM column width (#134)", () => {
  it("scales with the grid font instead of a fixed pixel track", () => {
    const bpm = COLUMN_BY_ID.get("bpm")!;
    expect(bpm.width).toBe("calc(var(--grid-font-size) * 2.6 + 11px)");
    expect(bpm.align).toBe("right");
  });

  it("the track lands in the grid template ahead of Key", () => {
    const tracks = tracksFor();
    const template = gridTemplateFor(tracks);
    expect(template).toContain("calc(var(--grid-font-size) * 2.6 + 11px)");
    expect(colIndex(tracks, "bpm")).toBeLessThan(colIndex(tracks, "key"));
  });

  it("fits three tabular digits plus the #138 arrow at both ends of the range", () => {
    // Measured in the app: three tabular digits are a steady 1.945em, and the
    // arrow glyph at its 0.75em face is 0.646em. The +11px covers the
    // 4px-a-side padding and the 2px arrow gap, with a pixel to spare.
    const DIGITS_EM = 1.945;
    const ARROW_EM = 0.646;
    for (const fontSize of [10, 13, 16, 20]) {
      const rendered = fontSize * 1.1; // TYPE_SCALE baseline (issue #2)
      const content = rendered * 2.6 + 11 - 8 - 2; // less padding and gap
      expect(content).toBeGreaterThanOrEqual(rendered * (DIGITS_EM + ARROW_EM));
    }
  });
});

describe("FX & Mix Notes is the grid's only flexible track (#140, second pass)", () => {
  // The first pass left the two Name columns at `minmax(150px, 1.1fr)`, so grid
  // split the space freed by hiding the timing columns across all three flexible
  // tracks — the Name columns widened along with notes, which is not where the
  // room was needed. Notes is now the sole `fr` track.
  // `\bfr\b` would never match: the digit before `fr` is a word character, so
  // there is no boundary there. Match the flex factor itself.
  const isFlexible = (width: string) => /\d(?:\.\d+)?fr\b/.test(width);

  it("no column other than notes carries an fr unit", () => {
    const flexible = COLUMNS.filter((c) => isFlexible(c.width)).map((c) => c.id);
    expect(flexible).toEqual(["notes"]);
  });

  it("holds for every hidden-column combination the grid can produce", () => {
    const combos: HideId[][] = [
      [],
      ["mixlen"],
      [...TIMING_TRACK_IDS],
      [...TIMING_TRACK_IDS, "mixlen"],
      ["a_num", "start", "transition"], // the <1440px narrow layout
    ];
    for (const hidden of combos) {
      const tracks = tracksFor(new Set(hidden));
      const flexible = tracks.filter((t) => isFlexible(t.width));
      expect(flexible).toHaveLength(1);
      expect(flexible[0].col?.id).toBe("notes");
    }
  });

  it("pins the Name columns at their OLD minimum, so nothing on screen shrinks", () => {
    // 150px is not a new number: it is the `minmax()` minimum these columns
    // already collapsed to at every layout below the grid's ~1438px min-content,
    // which is all of them at the 1440px primary target. Pinning there hands the
    // whole ~208px freed by hiding the timing group to notes; a wider value eats
    // that budget back and the hide stops widening notes at all — which is how
    // the first attempt at this fix failed.
    expect(COLUMN_BY_ID.get("out_name")!.width).toBe("150px");
    expect(COLUMN_BY_ID.get("in_name")!.width).toBe("150px");
  });

  it("keeps a readable floor on notes for when the grid overflows", () => {
    expect(COLUMN_BY_ID.get("notes")!.width).toBe("minmax(200px, 1fr)");
  });
});

describe("Δ factory fallback is the narrow daily-use range (#163)", () => {
  it("runs -1.5 … +1.5 in 0.5 steps behind the --- placeholder", () => {
    expect(FACTORY_LISTS.delta).toEqual([
      EMPTY_ENUM, "-1.5", "-1", "-0.5", "0", "+0.5", "+1", "+1.5",
    ]);
  });

  it("carries 0 but NOT the wider range a user may add within", () => {
    // The range belongs to the CONSTRAINT ([-12, +12] in 0.5 steps, enforced
    // backend-side), not to the default. A first attempt at #163 seeded all 49
    // semitones here; this is what stops that coming back.
    expect(FACTORY_LISTS.delta).toContain("0");
    expect(isLegacyEnumValue("delta", "0", FACTORY_LISTS)).toBe(false);
    expect(FACTORY_LISTS.delta).not.toContain("+0");
    for (const v of ["+2", "-2", "+12"]) {
      expect(FACTORY_LISTS.delta).not.toContain(v);
    }
  });

  it("still renders a user-added wide value as an ordinary member", () => {
    // Adding +7 is legal, so once it is in the list it must not carry the ◦
    // legacy marker — that signal is reserved for values no longer offered.
    const widened = { ...FACTORY_LISTS, delta: [...FACTORY_LISTS.delta, "+7"] };
    expect(isLegacyEnumValue("delta", "+7", widened)).toBe(false);
    expect(isLegacyEnumValue("delta", "+7", FACTORY_LISTS)).toBe(true);
  });

  it("sorts by signed value in the dropdown, placeholder first (#141)", () => {
    const { options } = enumOptions("delta", FACTORY_LISTS);
    expect(options).toEqual([
      EMPTY_ENUM, "-1.5", "-1", "-0.5", "0", "+0.5", "+1", "+1.5",
    ]);
    // 0 lands between the two half-steps that straddle it, not among the texts.
    const i = options.indexOf("0");
    expect(options[i - 1]).toBe("-0.5");
    expect(options[i + 1]).toBe("+0.5");
  });
});

describe("isHotLevel (#136 — LEVEL containing HOT, case-insensitive)", () => {
  it("matches the exact SM2 value", () => {
    expect(isHotLevel("HOT")).toBe(true);
  });

  it("matches values CONTAINING hot, in any case", () => {
    expect(isHotLevel("HOT-LP")).toBe(true);
    expect(isHotLevel("hot-lp")).toBe(true);
    expect(isHotLevel("Hot")).toBe(true);
    expect(isHotLevel("HOT-silence")).toBe(true);
    // Embedded mid-string, e.g. a legacy value no longer in the list.
    expect(isHotLevel("LP-HOT-swell")).toBe(true);
  });

  it("does not match values without it", () => {
    expect(isHotLevel("LP")).toBe(false);
    expect(isHotLevel("HP-silence")).toBe(false);
    expect(isHotLevel("open")).toBe(false);
    expect(isHotLevel("")).toBe(false);
    expect(isHotLevel(EMPTY_ENUM)).toBe(false);
  });
});

describe("hiding the derived calc tracks (#140)", () => {
  const hide = (...ids: HideId[]) => tracksFor(new Set<HideId>(ids));

  it("hides the Mix Timer track and its leading spacer", () => {
    const tracks = hide("mixlen");
    expect(calcIndex(tracks, "mixlen")).toBe(-1);
    expect(calcIndex(tracks, "mins")).toBeGreaterThan(-1);
    // Nothing trails Play Time — no orphaned spacer at the end.
    expect(tracks[tracks.length - 1].kind).toBe("calc");
    expect(tracks[tracks.length - 1].calc).toBe("mins");
  });

  it("hides the whole OUT TRACK TIMING group, Play Time included", () => {
    const tracks = hide(...TIMING_TRACK_IDS);
    expect(colIndex(tracks, "start")).toBe(-1);
    expect(colIndex(tracks, "transition")).toBe(-1);
    expect(calcIndex(tracks, "mins")).toBe(-1);
    // Mix Timer survives on its own, still behind its spacer.
    const mixlen = calcIndex(tracks, "mixlen");
    expect(mixlen).toBeGreaterThan(-1);
    expect(tracks[mixlen - 1].kind).toBe("spacer");
  });

  it("hides both groups at once, leaving notes as the last track", () => {
    const tracks = hide(...TIMING_TRACK_IDS, "mixlen");
    expect(calcIndex(tracks, "mins")).toBe(-1);
    expect(calcIndex(tracks, "mixlen")).toBe(-1);
    const last = tracks[tracks.length - 1];
    expect(last.kind).toBe("col");
    expect(last.col?.id).toBe("notes");
  });

  it("keeps Play Time contiguous with M #/T # when only Mix Timer is hidden", () => {
    const tracks = hide("mixlen");
    expect(calcIndex(tracks, "mins")).toBe(colIndex(tracks, "transition") + 1);
  });

  it("gives Play Time its own spacer when the M #/T # columns are hidden", () => {
    const tracks = hide("start", "transition");
    const mins = calcIndex(tracks, "mins");
    expect(tracks[mins - 1].kind).toBe("spacer");
    expect(tracks[mins - 2].col?.id).toBe("notes");
  });
});

describe("groupSpan with hidden timing members (#140)", () => {
  it("shrinks to M #/T # when only Play Time is hidden", () => {
    const tracks = tracksFor(new Set<HideId>(["mins"]));
    const span = groupSpan("timing", tracks);
    expect(span.start).toBe(colIndex(tracks, "start") + 1);
    expect(span.end).toBe(colIndex(tracks, "transition") + 2);
  });

  it("shrinks to Play Time alone when M #/T # are hidden", () => {
    const tracks = tracksFor(new Set<HideId>(["start", "transition"]));
    const mins = calcIndex(tracks, "mins");
    const span = groupSpan("timing", tracks);
    expect(span.start).toBe(mins + 1);
    expect(span.end).toBe(mins + 2);
  });

  it("reports no span at all when every member is hidden", () => {
    const tracks = tracksFor(new Set<HideId>(TIMING_TRACK_IDS));
    // start === -1 is how the screen decides not to render the super-header.
    expect(groupSpan("timing", tracks).start).toBe(-1);
  });
});

describe("navColsFor with the widened hidden set (#140)", () => {
  it("drops the stored timing columns and ignores the calc ids", () => {
    const nav = navColsFor(new Set<HideId>([...TIMING_TRACK_IDS, "mixlen"]));
    expect(nav).not.toContain("start");
    expect(nav).not.toContain("transition");
    expect(nav).toContain("notes");
    expect(nav).toContain("bpm");
  });
});

describe("naturalCompare (#141 — natural/numeric-aware ordering)", () => {
  const sort = (v: string[]) => [...v].sort(naturalCompare);

  it("orders signed pitch shifts by value, not lexically", () => {
    expect(sort(["+1", "-1.5", "+0.5", "-0.5", "+1.5", "-1"])).toEqual([
      "-1.5", "-1", "-0.5", "+0.5", "+1", "+1.5",
    ]);
    expect(sort(["+2", "-2", "+1", "-1"])).toEqual(["-2", "-1", "+1", "+2"]);
  });

  it("orders embedded cue numbers 1, 2 … 10 rather than 1, 10, 2", () => {
    expect(sort(["#10", "#2", "#1", "#9"])).toEqual(["#1", "#2", "#9", "#10"]);
  });

  it("orders pure text alphabetically", () => {
    expect(sort(["open", "HOT", "LP", "cut"])).toEqual(["cut", "HOT", "LP", "open"]);
  });

  it("puts numbers before text in a mixed list", () => {
    const out = sort(["open", "0.5", "cut"]);
    expect(out[0]).toBe("0.5");
    expect(out.slice(1)).toEqual(["cut", "open"]);
  });

  it("orders values that differ only by case deterministically", () => {
    const out = sort(["hot", "HOT"]);
    expect(out).toHaveLength(2);
    expect(sort(["HOT", "hot"])).toEqual(out); // stable regardless of input order
  });

  it("handles an empty list", () => {
    expect(sort([])).toEqual([]);
  });
});

describe("enumOptions natural ordering (#141)", () => {
  const lists = {
    delta: ["+1.5", "---", "-0.5", "+0.5", "-1.5", "+1", "-1"],
    lows: ["open", "cut", "0.5", "cut-swell"],
    level: ["LP", "HOT", "silence", "open"],
    i_like: [],
  };

  it("sorts the Δ dropdown by signed value with --- pinned first", () => {
    expect(enumOptions("delta", lists).options).toEqual([
      "---", "-1.5", "-1", "-0.5", "+0.5", "+1", "+1.5",
    ]);
  });

  it("sorts Lows and Level, always leading with the placeholder", () => {
    expect(enumOptions("lows", lists).options).toEqual([
      "---", "0.5", "cut", "cut-swell", "open",
    ]);
    expect(enumOptions("level", lists).options).toEqual([
      "---", "HOT", "LP", "open", "silence",
    ]);
  });

  it("leaves the clear-to values alone", () => {
    expect(enumOptions("delta", lists).clearsTo).toBe(EMPTY_ENUM);
    expect(enumOptions("lows", lists).clearsTo).toBe("");
    expect(enumOptions("level", lists).clearsTo).toBe("");
  });

  it("does not mutate the stored list (display-only sort)", () => {
    const before = [...lists.delta];
    enumOptions("delta", lists);
    expect(lists.delta).toEqual(before);
  });

  it("still recognises a legacy value regardless of ordering", () => {
    expect(isLegacyEnumValue("level", "HOT", lists)).toBe(false);
    expect(isLegacyEnumValue("level", "HOT-LP", lists)).toBe(true);
  });
});
