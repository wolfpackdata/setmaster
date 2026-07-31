import { describe, expect, it } from "vitest";
import {
  MATRIX_ZOOM_DEFAULT,
  MATRIX_ZOOM_MAX,
  MATRIX_ZOOM_MIN,
  MATRIX_ZOOM_STEP,
  clampMatrixZoom,
  resizedColumnWidth,
  zoomFactor,
} from "./zoom";

describe("issue #81 — matrix zoom bounds", () => {
  it("is 50–150, step 10, default 100", () => {
    expect(MATRIX_ZOOM_MIN).toBe(50);
    expect(MATRIX_ZOOM_MAX).toBe(150);
    expect(MATRIX_ZOOM_STEP).toBe(10);
    expect(MATRIX_ZOOM_DEFAULT).toBe(100);
  });

  it("clamps into range", () => {
    expect(clampMatrixZoom(40)).toBe(50);
    expect(clampMatrixZoom(200)).toBe(150);
    expect(clampMatrixZoom(100)).toBe(100);
    expect(clampMatrixZoom(50)).toBe(50);
    expect(clampMatrixZoom(150)).toBe(150);
  });

  it("converts percent to a CSS zoom factor", () => {
    expect(zoomFactor(100)).toBe(1);
    expect(zoomFactor(80)).toBeCloseTo(0.8, 10);
    expect(zoomFactor(50)).toBe(0.5);
    expect(zoomFactor(150)).toBe(1.5);
  });
});

describe("issue #81 — column resize math under zoom", () => {
  it("at 100% the on-screen delta is applied 1:1", () => {
    expect(resizedColumnWidth(200, 40, 100)).toBe(240);
    expect(resizedColumnWidth(200, -40, 100)).toBe(160);
  });

  it("at 80% a 100px on-screen drag adds 125px of stored width", () => {
    expect(resizedColumnWidth(100, 100, 80)).toBeCloseTo(225, 10);
  });

  it("at 150% a 150px on-screen drag adds only 100px of stored width", () => {
    expect(resizedColumnWidth(100, 150, 150)).toBeCloseTo(200, 10);
  });

  it("at 50% the edge still tracks the cursor 1:1 (delta doubles in stored px)", () => {
    // Dragging the physical edge 60px right at 50% zoom = 120 logical px.
    expect(resizedColumnWidth(300, 60, 50)).toBeCloseTo(420, 10);
  });
});
