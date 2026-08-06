import { describe, expect, it } from "vitest";
import {
  CANONICAL_KEYS,
  KEY_CONTRAST_BACKGROUND,
  KEY_CONTRAST_MIN,
  KEY_TABLE,
  formatKey,
  isCanonicalKey,
  keyColor,
  keyDisplayColor,
} from "./keys";
import { KEY_COLORS } from "./palette";
import { contrastRatio, hexToRgb, rgbToHsl } from "./color";

/**
 * Expected 24 × 4 table transcribed directly from planning/03-ui-design.md
 * §6.6 (independent copy — guards the module's table against edits).
 * Order: [flats, sharps, camelot, openkey].
 */
const SPEC_TABLE: Array<[string, string, string, string]> = [
  ["C", "C", "8B", "1d"],
  ["Db", "C#", "3B", "8d"],
  ["D", "D", "10B", "3d"],
  ["Eb", "D#", "5B", "10d"],
  ["E", "E", "12B", "5d"],
  ["F", "F", "7B", "12d"],
  ["Gb", "F#", "2B", "7d"],
  ["G", "G", "9B", "2d"],
  ["Ab", "G#", "4B", "9d"],
  ["A", "A", "11B", "4d"],
  ["Bb", "A#", "6B", "11d"],
  ["B", "B", "1B", "6d"],
  ["Am", "Am", "8A", "1m"],
  ["Bbm", "A#m", "3A", "8m"],
  ["Bm", "Bm", "10A", "3m"],
  ["Cm", "Cm", "5A", "10m"],
  ["Dbm", "C#m", "12A", "5m"],
  ["Dm", "Dm", "7A", "12m"],
  ["Ebm", "D#m", "2A", "7m"],
  ["Em", "Em", "9A", "2m"],
  ["Fm", "Fm", "4A", "9m"],
  ["Gbm", "F#m", "11A", "4m"],
  ["Gm", "Gm", "6A", "11m"],
  ["Abm", "G#m", "1A", "6m"],
];

describe("§6.6 conversion table — all 96 cells", () => {
  it("has exactly 24 keys", () => {
    expect(KEY_TABLE).toHaveLength(24);
    expect(CANONICAL_KEYS).toHaveLength(24);
    expect(SPEC_TABLE).toHaveLength(24);
  });

  for (const [flats, sharps, camelot, openkey] of SPEC_TABLE) {
    it(`${flats} → ${flats} / ${sharps} / ${camelot} / ${openkey}`, () => {
      expect(formatKey(flats, "flats")).toBe(flats);
      expect(formatKey(flats, "sharps")).toBe(sharps);
      expect(formatKey(flats, "camelot")).toBe(camelot);
      expect(formatKey(flats, "openkey")).toBe(openkey);
    });
  }

  it("passes unknown / free-text values through unchanged", () => {
    expect(formatKey("H#", "camelot")).toBe("H#");
    expect(formatKey("", "sharps")).toBe("");
    expect(isCanonicalKey("F#m")).toBe(false); // sharps spelling is display-only
    expect(isCanonicalKey("Gbm")).toBe(true);
  });
});

describe("§9 contrast rule — derived key colors", () => {
  for (const key of CANONICAL_KEYS) {
    it(`${key} display color reaches ${KEY_CONTRAST_MIN}:1 on --bg-row, hue preserved`, () => {
      const derived = keyDisplayColor(key);
      expect(derived).not.toBeNull();
      // 4.5:1 against --bg-row (#1A1A1A)
      expect(
        contrastRatio(derived as string, KEY_CONTRAST_BACKGROUND),
      ).toBeGreaterThanOrEqual(KEY_CONTRAST_MIN);
      // Hue preserved vs. the canonical palette entry (small rounding tolerance)
      const canonicalHue = rgbToHsl(hexToRgb(KEY_COLORS[key].hex)).h;
      const derivedHue = rgbToHsl(hexToRgb(derived as string)).h;
      const diff = Math.min(
        Math.abs(canonicalHue - derivedHue),
        360 - Math.abs(canonicalHue - derivedHue),
      );
      expect(diff).toBeLessThanOrEqual(2);
    });
  }

  it("keeps already-passing palette entries unchanged", () => {
    // Golden Yellow is far above 4.5:1 on #1A1A1A — must not be altered.
    expect(keyDisplayColor("D")?.toLowerCase()).toBe(
      KEY_COLORS.D.hex.toLowerCase(),
    );
  });

  it("adjusts the failing blue/violet entries (e.g. Eb Indigo, Cm Violet)", () => {
    for (const key of ["Eb", "Cm", "Bb"] as const) {
      expect(contrastRatio(KEY_COLORS[key].hex, KEY_CONTRAST_BACKGROUND)).toBeLessThan(
        KEY_CONTRAST_MIN,
      );
      expect(keyDisplayColor(key)?.toLowerCase()).not.toBe(
        KEY_COLORS[key].hex.toLowerCase(),
      );
    }
  });

  it("keyColor honors the Colorful Keys toggle", () => {
    expect(keyColor("Gm", false)).toBeNull();
    expect(keyColor("Gm", true)).not.toBeNull();
    expect(keyColor("not-a-key", true)).toBeNull();
  });
});
