import { describe, expect, it } from "vitest";
import {
  TYPE_SCALE,
  computeRowHeight,
  gridRowHeight,
  scaledGridFontSize,
} from "./settingsStore";

describe("§3.5 Spacing formula (DIRECT density)", () => {
  it("matches the spec's calibration points at default font size", () => {
    expect(computeRowHeight(13, 100)).toBe(32); // default → Traktor density (unchanged)
    expect(computeRowHeight(13, 70)).toBe(26); // min spacing → densest grid
    expect(computeRowHeight(13, 150)).toBe(42); // max spacing → max breathing room
  });

  it("more spacing gives taller rows (+ increases the gap)", () => {
    expect(computeRowHeight(13, 90)).toBeLessThan(computeRowHeight(13, 110));
  });

  it("composes with Font Size", () => {
    expect(computeRowHeight(20, 100)).toBe(39);
    expect(computeRowHeight(10, 70)).toBe(23);
  });

  it("never falls below font-size + 8px", () => {
    expect(computeRowHeight(13, 1)).toBe(21);
  });
});

describe("issue #2 — global +10% type scale (R2 composition)", () => {
  it("keeps the CSS/JS scale factors in lockstep at 1.10", () => {
    // Guards against drift with `--type-scale` in tokens.css.
    expect(TYPE_SCALE).toBe(1.1);
  });

  it("composes the +10% baseline with the user Font Size (no double-scaling)", () => {
    // Default Font Size 13 → rendered grid text 13 × 1.10 = 14.3px.
    expect(scaledGridFontSize(13)).toBeCloseTo(14.3, 5);
    // User-adjustable bounds still compose cleanly.
    expect(scaledGridFontSize(10)).toBeCloseTo(11, 5);
    expect(scaledGridFontSize(20)).toBeCloseTo(22, 5);
  });

  it("derives row height from the scaled font so text never clips", () => {
    // Default: taller than the pre-scale 32px, still comfortably clears text.
    expect(computeRowHeight(scaledGridFontSize(13), 100)).toBeCloseTo(33.3, 5);
    // Floor still honored relative to the scaled font.
    expect(computeRowHeight(scaledGridFontSize(13), 1)).toBeCloseTo(22.3, 5);
  });
});

describe("gridRowHeight — one basis for both grids (#105)", () => {
  it("is the scaled font, never the raw Font Size", () => {
    // The matrix used to pass the raw value, which is the whole bug: its cells
    // render at `var(--grid-font-size)` (scaled), so rows sized from the raw
    // font were shorter than their own text.
    expect(gridRowHeight({ font_size: 13, line_spacing: 100 })).toBeCloseTo(33.3, 5);
    expect(gridRowHeight({ font_size: 13, line_spacing: 100 })).not.toBe(
      computeRowHeight(13, 100),
    );
  });

  it("the shortfall it fixes grows with Font Size", () => {
    // 1.3px at the default, 2px at the top of the range — the §3.5 gap was
    // being eaten as the font grew, which is why this is a bug not a nitpick.
    for (const [font, shortfall] of [
      [10, 1],
      [13, 1.3],
      [20, 2],
    ] as const) {
      const scaled = gridRowHeight({ font_size: font, line_spacing: 100 });
      const raw = computeRowHeight(font, 100);
      expect(scaled - raw).toBeCloseTo(shortfall, 5);
    }
  });

  it("still composes with Spacing and honours the floor", () => {
    expect(gridRowHeight({ font_size: 13, line_spacing: 70 })).toBeCloseTo(27.3, 5);
    expect(gridRowHeight({ font_size: 13, line_spacing: 150 })).toBeCloseTo(43.3, 5);
    expect(gridRowHeight({ font_size: 13, line_spacing: 1 })).toBeCloseTo(22.3, 5);
  });
});
