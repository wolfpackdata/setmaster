/**
 * Canonical 24-key color palette — extracted from the SM2 prototype workbook's
 * `load` tab (03-ui-design.md §3.1). Camelot-wheel order, hue rotating around
 * the color wheel so harmonically adjacent keys have adjacent hues.
 *
 * Keys are flats-canonical (the app's single internal representation).
 * This table is the canonical identity; contrast-adjusted display variants are
 * DERIVED (lib/keys.ts / lib/color.ts §9 rule), never edited here.
 */

import type { CanonicalKey } from "./keys";

export interface KeyColorEntry {
  hex: string;
  name: string;
}

export const KEY_COLORS: Record<CanonicalKey, KeyColorEntry> = {
  C: { hex: "#F20D0D", name: "Crimson Red" },
  Am: { hex: "#F23F0D", name: "Vermilion" },
  G: { hex: "#F2710D", name: "Tangerine" },
  Em: { hex: "#F2A20D", name: "Amber" },
  D: { hex: "#F2D40D", name: "Golden Yellow" },
  Bm: { hex: "#DEF20D", name: "Lime Yellow" },
  A: { hex: "#ACF20D", name: "Chartreuse" },
  Gbm: { hex: "#7BF20D", name: "Spring Green" },
  E: { hex: "#49F20D", name: "Emerald" },
  Dbm: { hex: "#17F20D", name: "Fresh Green" },
  B: { hex: "#0DF235", name: "Mint" },
  Abm: { hex: "#0DF267", name: "Aquamarine" },
  Gb: { hex: "#0DF298", name: "Teal" },
  Ebm: { hex: "#0DF2CA", name: "Turquoise" },
  Db: { hex: "#0DE8F2", name: "Sky Blue" },
  Bbm: { hex: "#0DB6F2", name: "Azure" },
  Ab: { hex: "#0D84F2", name: "Cobalt" },
  Fm: { hex: "#0D53F2", name: "Royal Blue" },
  Eb: { hex: "#0D21F2", name: "Indigo" },
  Cm: { hex: "#2B0DF2", name: "Violet" },
  Bb: { hex: "#5D0DF2", name: "Deep Violet" },
  Gm: { hex: "#8E0DF2", name: "Purple" },
  F: { hex: "#C00DF2", name: "Orchid" },
  Dm: { hex: "#F20DF2", name: "Magenta" },
};
