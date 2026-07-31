import { describe, expect, it } from "vitest";
import {
  EMPTY_FORMATTING,
  applyBox,
  applyFill,
  buildFillMap,
  cellKey,
  clearFormatting,
  computeBoxEdges,
} from "./formatting";
import type { SetFormatting } from "../../lib/api";

describe("applyFill (§6.5: fills replace fills; boxes independent)", () => {
  it("adds fills for every cell in the range", () => {
    const f = applyFill(EMPTY_FORMATTING, ["r1", "r2"], ["bpm", "key"], "red");
    expect(f.fills).toHaveLength(4);
    expect(f.fills).toContainEqual({ row_id: "r2", col: "key", color: "red" });
  });

  it("re-applying over an existing shade REPLACES it (no duplicates)", () => {
    let f = applyFill(EMPTY_FORMATTING, ["r1"], ["bpm"], "red");
    f = applyFill(f, ["r1"], ["bpm"], "yellow");
    expect(f.fills).toEqual([{ row_id: "r1", col: "bpm", color: "yellow" }]);
  });

  it("leaves fills outside the range and all boxes untouched", () => {
    let f: SetFormatting = {
      fills: [{ row_id: "rX", col: "notes", color: "yellow" }],
      boxes: [{ row_ids: ["rX"], cols: ["notes"] }],
    };
    f = applyFill(f, ["r1"], ["bpm"], "red");
    expect(f.fills).toContainEqual({ row_id: "rX", col: "notes", color: "yellow" });
    expect(f.boxes).toHaveLength(1);
  });
});

describe("clearFormatting (§6.5 Clear: shading + intersecting boxes, one click)", () => {
  it("removes fills inside the selection only", () => {
    let f = applyFill(EMPTY_FORMATTING, ["r1", "r2"], ["bpm"], "red");
    f = clearFormatting(f, ["r1"], ["bpm"]);
    expect(f.fills).toEqual([{ row_id: "r2", col: "bpm", color: "red" }]);
  });

  it("removes boxes that intersect the selection, keeps the rest", () => {
    let f = applyBox(EMPTY_FORMATTING, ["r1", "r2"], ["bpm", "key"]);
    f = applyBox(f, ["r9"], ["notes"]);
    f = clearFormatting(f, ["r2"], ["key"]);
    expect(f.boxes).toEqual([{ row_ids: ["r9"], cols: ["notes"] }]);
  });
});

describe("computeBoxEdges — anchored to row ids, survives reorder (§4.3)", () => {
  const cols = ["bpm", "key", "in_name"];

  it("draws the perimeter of a contiguous 2×2 box", () => {
    const f = applyBox(EMPTY_FORMATTING, ["r1", "r2"], ["bpm", "key"]);
    const edges = computeBoxEdges(f, ["r1", "r2", "r3"], cols);
    expect(edges.get(cellKey("r1", "bpm"))).toEqual({
      top: true,
      right: false,
      bottom: false,
      left: true,
    });
    expect(edges.get(cellKey("r2", "key"))).toEqual({
      top: false,
      right: true,
      bottom: true,
      left: false,
    });
    expect(edges.has(cellKey("r3", "bpm"))).toBe(false);
  });

  it("REORDER SURVIVAL: membership follows row ids; edges re-derive from the new order", () => {
    const f = applyBox(EMPTY_FORMATTING, ["r1", "r2"], ["bpm"]);
    // r2 dragged away from r1 — a foreign row now sits between them.
    const edges = computeBoxEdges(f, ["r1", "rX", "r2"], cols);
    // r1 is now a closed box on its own edge-wise…
    expect(edges.get(cellKey("r1", "bpm"))).toEqual({
      top: true,
      right: true,
      bottom: true,
      left: true,
    });
    // …and so is r2; the interloper rX gets nothing.
    expect(edges.get(cellKey("r2", "bpm"))).toEqual({
      top: true,
      right: true,
      bottom: true,
      left: true,
    });
    expect(edges.has(cellKey("rX", "bpm"))).toBe(false);
  });

  it("rows moved back together merge again", () => {
    const f = applyBox(EMPTY_FORMATTING, ["r1", "r2"], ["bpm"]);
    const edges = computeBoxEdges(f, ["rX", "r2", "r1"], cols);
    // Adjacent again (in swapped order) — shared edge disappears.
    expect(edges.get(cellKey("r2", "bpm"))!.bottom).toBe(false);
    expect(edges.get(cellKey("r1", "bpm"))!.top).toBe(false);
  });

  it("overlapping boxes union their edges per cell", () => {
    let f = applyBox(EMPTY_FORMATTING, ["r1"], ["bpm"]);
    f = applyBox(f, ["r1", "r2"], ["bpm"]);
    const edges = computeBoxEdges(f, ["r1", "r2"], cols);
    // Box 1 gives r1 a bottom edge even though box 2 continues into r2.
    expect(edges.get(cellKey("r1", "bpm"))!.bottom).toBe(true);
  });
});

describe("buildFillMap", () => {
  it("fill map keys by row id + col", () => {
    const f = applyFill(EMPTY_FORMATTING, ["r1"], ["bpm"], "yellow");
    expect(buildFillMap(f).get(cellKey("r1", "bpm"))).toBe("yellow");
  });

  // The `pruneFormatting` case that stood here went with the function in #162:
  // with no row-delete path, a formatting entry can no longer reference a row id
  // that has left the set, so there is nothing to prune.
});
