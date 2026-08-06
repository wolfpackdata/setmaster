/**
 * Metadata column definitions — header-driven default widths (issue #6) and the
 * two-line wrapped-header refinement (issue #80). These are pure derivations, so
 * we assert the exact width math rather than eyeballed pixels.
 */

import { describe, expect, it } from "vitest";
import {
  defaultColWidth,
  headerWrapLines,
  META_COLUMN_BY_ID,
  META_COLUMNS,
} from "./columns";

// Mirror of the private constants in columns.ts so the expectations below are
// self-checking against the same math the module uses.
const HEADER_CHAR_W = 7.4;
const HEADER_CHROME = 52;
const widthFor = (longestChars: number) =>
  Math.ceil(longestChars * HEADER_CHAR_W) + HEADER_CHROME;

const WRAPPED = ["playcount", "root", "nonroot"] as const;

describe("defaultColWidth", () => {
  it("single-line width is driven by the full label", () => {
    expect(defaultColWidth("Play Count")).toBe(widthFor("Play Count".length));
    expect(defaultColWidth("On Super Playlist")).toBe(
      widthFor("On Super Playlist".length),
    );
  });

  it("wrapped width is driven by the longest wrapped LINE, not the full label", () => {
    // Play Count -> "Play" / "Count"; longest line is "Count" (5).
    expect(defaultColWidth("Play Count", true)).toBe(widthFor(5));
    // On Super Playlist -> "On Super" / "Playlist"; both lines are 8.
    expect(defaultColWidth("On Super Playlist", true)).toBe(widthFor(8));
    // On Non-Super Playlist -> "On Non-Super" / "Playlist"; longest is 12.
    expect(defaultColWidth("On Non-Super Playlist", true)).toBe(widthFor(12));
  });

  it("wrapped default is strictly narrower than the single-line default", () => {
    for (const label of [
      "Play Count",
      "On Super Playlist",
      "On Non-Super Playlist",
    ]) {
      expect(defaultColWidth(label, true)).toBeLessThan(defaultColWidth(label));
    }
  });

  it("wrap=true on a non-wrapping label falls back to the full-label width", () => {
    // No HEADER_WRAP entry -> headerWrapLines is null -> full-label driver.
    expect(defaultColWidth("Import Date", true)).toBe(defaultColWidth("Import Date"));
  });
});

describe("headerWrapLines", () => {
  it("returns the two verbatim lines for wrapped labels", () => {
    expect(headerWrapLines("Play Count")).toEqual(["Play", "Count"]);
    expect(headerWrapLines("On Super Playlist")).toEqual(["On Super", "Playlist"]);
    expect(headerWrapLines("On Non-Super Playlist")).toEqual([
      "On Non-Super",
      "Playlist",
    ]);
  });

  it("preserves the exact label when the lines are joined", () => {
    for (const label of [
      "Play Count",
      "On Super Playlist",
      "On Non-Super Playlist",
    ]) {
      expect(headerWrapLines(label)!.join(" ")).toBe(label);
    }
  });

  it("returns null for single-line labels", () => {
    expect(headerWrapLines("Import Date")).toBeNull();
    expect(headerWrapLines("BPM")).toBeNull();
  });
});

describe("META_COLUMNS wrapHeader flags", () => {
  it("only Play Count / On Super Playlist / On Non-Super Playlist wrap", () => {
    const wrapped = META_COLUMNS.filter((c) => c.wrapHeader).map((c) => c.id);
    expect(wrapped.sort()).toEqual([...WRAPPED].sort());
  });

  it("every wrapped column has a matching HEADER_WRAP split", () => {
    for (const id of WRAPPED) {
      const col = META_COLUMN_BY_ID.get(id)!;
      expect(col.wrapHeader).toBe(true);
      expect(headerWrapLines(col.label)).not.toBeNull();
    }
  });

  it("wrapped columns store the two-line-derived width", () => {
    for (const id of WRAPPED) {
      const col = META_COLUMN_BY_ID.get(id)!;
      expect(col.width).toBe(defaultColWidth(col.label, true));
    }
  });

  it("non-wrapping label-driven columns keep their full-label width", () => {
    for (const id of ["import_date", "release_date", "bpm", "key"]) {
      const col = META_COLUMN_BY_ID.get(id)!;
      expect(col.wrapHeader).toBeUndefined();
      expect(col.width).toBe(defaultColWidth(col.label));
    }
  });
});
