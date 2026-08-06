/**
 * Fill-drag window math (issue #75, Enhancement 2): sliding the highlighted band
 * moves the whole [min,max] window, preserving its width and clamping at the
 * domain edges WITHOUT shrinking. Pure function — testable without the DOM.
 */

import { describe, expect, it } from "vitest";
import { slideWindow } from "./RangeSlider";

const DOMAIN_MIN = 85;
const DOMAIN_MAX = 195;

describe("slideWindow", () => {
  it("slides the window by delta, preserving width", () => {
    // 122–128 (width 6) dragged +10 → 132–138
    expect(slideWindow(122, 128, 10, DOMAIN_MIN, DOMAIN_MAX)).toEqual({
      lo: 132,
      hi: 138,
    });
  });

  it("slides downward by a negative delta", () => {
    expect(slideWindow(122, 128, -20, DOMAIN_MIN, DOMAIN_MAX)).toEqual({
      lo: 102,
      hi: 108,
    });
  });

  it("clamps at the low edge without shrinking the window", () => {
    // width 6, pushed well past the low edge → pinned to [85, 91]
    const r = slideWindow(90, 96, -50, DOMAIN_MIN, DOMAIN_MAX);
    expect(r).toEqual({ lo: 85, hi: 91 });
    expect(r.hi - r.lo).toBe(6);
  });

  it("clamps at the high edge without shrinking the window", () => {
    const r = slideWindow(180, 190, 50, DOMAIN_MIN, DOMAIN_MAX);
    expect(r).toEqual({ lo: 185, hi: 195 });
    expect(r.hi - r.lo).toBe(10);
  });

  it("zero delta is a no-op", () => {
    expect(slideWindow(120, 130, 0, DOMAIN_MIN, DOMAIN_MAX)).toEqual({
      lo: 120,
      hi: 130,
    });
  });

  it("a full-domain window pins to the low edge (cannot move)", () => {
    expect(slideWindow(85, 195, 10, DOMAIN_MIN, DOMAIN_MAX)).toEqual({
      lo: 85,
      hi: 195,
    });
  });
});
