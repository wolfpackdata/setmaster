import { describe, expect, it } from "vitest";
import { UndoHistory, historyFor, type EditorSnapshot } from "./undo";
import { EMPTY_FORMATTING } from "./formatting";
import { makeEmptyRow } from "./model";

function snap(label: string): EditorSnapshot {
  const row = makeEmptyRow();
  return {
    rows: [{ ...row, in_name: label }],
    formatting: EMPTY_FORMATTING,
  };
}

describe("UndoHistory", () => {
  it("undo restores the recorded before-state; the current state becomes redoable", () => {
    const h = new UndoHistory();
    const a = snap("a");
    const b = snap("b");
    h.record(a); // mutation a → b
    expect(h.canUndo).toBe(true);
    expect(h.undo(b)).toBe(a);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(h.redo(a)).toBe(b);
  });

  it("a chain of edits unwinds in reverse order", () => {
    const h = new UndoHistory();
    const a = snap("a");
    const b = snap("b");
    const c = snap("c");
    h.record(a);
    h.record(b);
    expect(h.undo(c)).toBe(b);
    expect(h.undo(b)).toBe(a);
    expect(h.undo(a)).toBeNull();
  });

  it("recording a new mutation clears the redo stack", () => {
    const h = new UndoHistory();
    const a = snap("a");
    const b = snap("b");
    const c = snap("c");
    h.record(a);
    h.undo(b);
    expect(h.canRedo).toBe(true);
    h.record(a); // new divergent edit a → c
    expect(h.canRedo).toBe(false);
    expect(h.undo(c)).toBe(a);
  });

  it("undo on an empty history is a no-op returning null", () => {
    const h = new UndoHistory();
    expect(h.undo(snap("x"))).toBeNull();
    expect(h.redo(snap("x"))).toBeNull();
  });
});

describe("historyFor (per-set, session-scoped — §5.2/§7.3)", () => {
  it("returns the same history for the same set id (survives remounts)", () => {
    const h1 = historyFor("set-α");
    h1.record(snap("a"));
    expect(historyFor("set-α")).toBe(h1);
    expect(historyFor("set-α").canUndo).toBe(true);
  });

  it("different sets have independent histories", () => {
    const hA = historyFor("set-A-independent");
    const hB = historyFor("set-B-independent");
    expect(hA).not.toBe(hB);
    hA.record(snap("a"));
    expect(hB.canUndo).toBe(false);
  });
});
