import { describe, expect, it } from "vitest";
import {
  MOVE_INFO_STEPS,
  MOVE_INFO_TIP,
  MOVE_INFO_TITLE,
  moveInfoText,
} from "./moveInfo";

describe("Move info tooltip copy (#26)", () => {
  it("has the exact title", () => {
    expect(MOVE_INFO_TITLE).toBe("Move rows");
  });

  it("has the five linear steps verbatim", () => {
    expect(MOVE_INFO_STEPS).toHaveLength(5);
    expect(MOVE_INFO_STEPS.map(moveInfoText)).toEqual([
      "Click a cell in the row you want to move.",
      "Select more rows with Shift + Arrow keys or Shift + click.",
      "Turn Move on.",
      "Press ↑ / ↓ to move the selection.",
      "Turn Move off or Press Esc",
    ]);
  });

  it("has the Alt+↑/↓ tip verbatim", () => {
    expect(moveInfoText(MOVE_INFO_TIP)).toBe(
      "Tip: Alt + ↑/↓ moves rows anytime, without Move mode.",
    );
  });

  it("emphasises both multi-select methods as key combos", () => {
    const strongText = MOVE_INFO_STEPS.flat()
      .filter((s) => s.strong)
      .map((s) => s.text);
    expect(strongText).toContain("Shift + Arrow keys");
    expect(strongText).toContain("Shift + click");
  });
});
