/**
 * Keys module — the 24-key × 4-notation conversion TABLE from
 * planning/03-ui-design.md §6.6 (a table, NOT a formula — per spec), plus the
 * display formatter (Key Display As, §3.5) and the color lookup
 * (Colorful Keys, §3.5 + the §9 contrast-adjustment rule).
 *
 * Internal representation is flats-canonical everywhere (`Gbm`, 24 values);
 * the other three notations are pure display renames of the same key.
 */

import { KEY_COLORS } from "./palette";
import { ensureContrast } from "./color";

export type KeyNotation = "flats" | "sharps" | "camelot" | "openkey";

export interface KeyRow {
  flats: string;
  sharps: string;
  camelot: string;
  openkey: string;
}

/** §6.6 canonical conversion table, verbatim. Do not derive at runtime. */
export const KEY_TABLE = [
  { flats: "C", sharps: "C", camelot: "8B", openkey: "1d" },
  { flats: "Db", sharps: "C#", camelot: "3B", openkey: "8d" },
  { flats: "D", sharps: "D", camelot: "10B", openkey: "3d" },
  { flats: "Eb", sharps: "D#", camelot: "5B", openkey: "10d" },
  { flats: "E", sharps: "E", camelot: "12B", openkey: "5d" },
  { flats: "F", sharps: "F", camelot: "7B", openkey: "12d" },
  { flats: "Gb", sharps: "F#", camelot: "2B", openkey: "7d" },
  { flats: "G", sharps: "G", camelot: "9B", openkey: "2d" },
  { flats: "Ab", sharps: "G#", camelot: "4B", openkey: "9d" },
  { flats: "A", sharps: "A", camelot: "11B", openkey: "4d" },
  { flats: "Bb", sharps: "A#", camelot: "6B", openkey: "11d" },
  { flats: "B", sharps: "B", camelot: "1B", openkey: "6d" },
  { flats: "Am", sharps: "Am", camelot: "8A", openkey: "1m" },
  { flats: "Bbm", sharps: "A#m", camelot: "3A", openkey: "8m" },
  { flats: "Bm", sharps: "Bm", camelot: "10A", openkey: "3m" },
  { flats: "Cm", sharps: "Cm", camelot: "5A", openkey: "10m" },
  { flats: "Dbm", sharps: "C#m", camelot: "12A", openkey: "5m" },
  { flats: "Dm", sharps: "Dm", camelot: "7A", openkey: "12m" },
  { flats: "Ebm", sharps: "D#m", camelot: "2A", openkey: "7m" },
  { flats: "Em", sharps: "Em", camelot: "9A", openkey: "2m" },
  { flats: "Fm", sharps: "Fm", camelot: "4A", openkey: "9m" },
  { flats: "Gbm", sharps: "F#m", camelot: "11A", openkey: "4m" },
  { flats: "Gm", sharps: "Gm", camelot: "6A", openkey: "11m" },
  { flats: "Abm", sharps: "G#m", camelot: "1A", openkey: "6m" },
] as const satisfies readonly KeyRow[];

/** The 24 canonical (flats-notation) key values. */
export type CanonicalKey = (typeof KEY_TABLE)[number]["flats"];

export const CANONICAL_KEYS: readonly CanonicalKey[] = KEY_TABLE.map(
  (r) => r.flats,
);

const byFlats = new Map<string, KeyRow>(KEY_TABLE.map((r) => [r.flats, r]));

export function isCanonicalKey(value: string): value is CanonicalKey {
  return byFlats.has(value);
}

/**
 * Format a canonical (flats) key for display per the global Key Display As
 * option (§3.5). Unknown/free-text values pass through unchanged — set-row
 * keys are manually typed and may hold anything.
 */
export function formatKey(canonical: string, notation: KeyNotation): string {
  const row = byFlats.get(canonical);
  if (!row) return canonical;
  return row[notation];
}

/** Background the §9 contrast rule adjusts against: --bg-row. */
export const KEY_CONTRAST_BACKGROUND = "#1A1A1A";
export const KEY_CONTRAST_MIN = 4.5;

const adjustedCache = new Map<string, string>();

/**
 * Display color for a canonical key with the §9 contrast rule applied:
 * palette entries that fall short of 4.5:1 on --bg-row are lightened
 * (hue preserved) to the minimum lightness that passes. Canonical palette
 * (lib/palette.ts) is untouched; this is the derived variant.
 *
 * Returns null when the key is unknown — callers fall back to --text-primary.
 */
export function keyDisplayColor(canonical: string): string | null {
  if (!isCanonicalKey(canonical)) return null;
  let hex = adjustedCache.get(canonical);
  if (!hex) {
    hex = ensureContrast(
      KEY_COLORS[canonical].hex,
      KEY_CONTRAST_BACKGROUND,
      KEY_CONTRAST_MIN,
    );
    adjustedCache.set(canonical, hex);
  }
  return hex;
}

/**
 * Color for key text honoring the Colorful Keys option (§3.5/§6.6):
 * on → per-key derived color; off (or unknown key) → null, meaning render in
 * --text-primary like any other cell. Color follows the key, not the notation.
 */
export function keyColor(
  canonical: string,
  colorfulKeys: boolean,
): string | null {
  if (!colorfulKeys) return null;
  return keyDisplayColor(canonical);
}
