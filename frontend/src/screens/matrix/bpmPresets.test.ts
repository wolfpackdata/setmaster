/**
 * BPM preset prefs (issue #75, ruling R6): defaults, validation, active-preset
 * detection, immutable update, and localStorage persistence round-trip. Pure
 * logic — no DOM — matching the parseLayout test style in matrixStore.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activePresetIndex,
  BPM_PRESETS_KEY,
  DEFAULT_BPM_PRESETS,
  loadBpmPresets,
  parseBpmPresets,
  saveBpmPresets,
  serializeBpmPresets,
  updatePresetAt,
  validateBpmPreset,
  type BpmPreset,
} from "./bpmPresets";

describe("defaults", () => {
  it("ships the four issue #75 presets in button order", () => {
    expect(DEFAULT_BPM_PRESETS).toEqual([
      { name: "HOUSE", min: 120, max: 128 },
      { name: "DISCO", min: 115, max: 126 },
      { name: "TECHNO", min: 124, max: 132 },
      { name: "BASS", min: 64, max: 100 },
    ]);
  });
});

describe("parseBpmPresets", () => {
  it("returns defaults for null / empty / non-array", () => {
    expect(parseBpmPresets(null)).toEqual([...DEFAULT_BPM_PRESETS]);
    expect(parseBpmPresets("[]")).toEqual([...DEFAULT_BPM_PRESETS]);
    expect(parseBpmPresets('{"nope":1}')).toEqual([...DEFAULT_BPM_PRESETS]);
  });

  it("round-trips a fully custom set", () => {
    const custom: BpmPreset[] = [
      { name: "A", min: 1, max: 2 },
      { name: "B", min: 3, max: 4 },
      { name: "C", min: 5, max: 6 },
      { name: "D", min: 7, max: 8 },
    ];
    expect(parseBpmPresets(serializeBpmPresets(custom))).toEqual(custom);
  });

  it("fills malformed / missing slots with their default (fail safe, never fewer than 4)", () => {
    // slot 0 valid, slot 1 invalid (min>max), slot 2 missing, slot 3 wrong type
    const raw = JSON.stringify([
      { name: "MINE", min: 90, max: 95 },
      { name: "BAD", min: 130, max: 120 },
    ]);
    const out = parseBpmPresets(raw);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ name: "MINE", min: 90, max: 95 });
    expect(out[1]).toEqual({ ...DEFAULT_BPM_PRESETS[1] });
    expect(out[2]).toEqual({ ...DEFAULT_BPM_PRESETS[2] });
    expect(out[3]).toEqual({ ...DEFAULT_BPM_PRESETS[3] });
  });

  it("trims stored names", () => {
    const raw = JSON.stringify([{ name: "  PAD  ", min: 100, max: 110 }]);
    expect(parseBpmPresets(raw)[0].name).toBe("PAD");
  });
});

describe("activePresetIndex", () => {
  const presets = [...DEFAULT_BPM_PRESETS];

  it("matches an exact range to its button index", () => {
    expect(activePresetIndex(presets, 120, 128)).toBe(0);
    expect(activePresetIndex(presets, 124, 132)).toBe(2);
  });

  it("returns -1 when the range differs (deselect on manual edit)", () => {
    expect(activePresetIndex(presets, 121, 128)).toBe(-1); // min nudged
    expect(activePresetIndex(presets, 120, 127)).toBe(-1); // max nudged
  });

  it("returns -1 when either bound is null", () => {
    expect(activePresetIndex(presets, null, 128)).toBe(-1);
    expect(activePresetIndex(presets, 120, null)).toBe(-1);
    expect(activePresetIndex(presets, null, null)).toBe(-1);
  });
});

describe("validateBpmPreset", () => {
  it("accepts valid input and normalizes the name", () => {
    const res = validateBpmPreset("  Deep  ", "118", "124");
    expect(res).toEqual({ ok: true, preset: { name: "Deep", min: 118, max: 124 } });
  });

  it("allows min === max (single-point window)", () => {
    expect(validateBpmPreset("X", "128", "128").ok).toBe(true);
  });

  it("rejects min > max", () => {
    const res = validateBpmPreset("X", "130", "120");
    expect(res.ok).toBe(false);
  });

  it("rejects non-numeric bounds", () => {
    expect(validateBpmPreset("X", "abc", "120").ok).toBe(false);
    expect(validateBpmPreset("X", "120", "").ok).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(validateBpmPreset("   ", "120", "128").ok).toBe(false);
  });
});

describe("updatePresetAt", () => {
  it("replaces one slot immutably, leaving the rest intact", () => {
    const presets = [...DEFAULT_BPM_PRESETS];
    const next = updatePresetAt(presets, 1, { name: "NEW", min: 100, max: 110 });
    expect(next[1]).toEqual({ name: "NEW", min: 100, max: 110 });
    expect(next[0]).toEqual(presets[0]);
    expect(next).not.toBe(presets);
    // original untouched
    expect(presets[1]).toEqual(DEFAULT_BPM_PRESETS[1]);
  });
});

describe("localStorage persistence (survives restart)", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("load returns defaults when nothing is stored", () => {
    expect(loadBpmPresets()).toEqual([...DEFAULT_BPM_PRESETS]);
  });

  it("a saved edit is read back on the next load (persists across restarts)", () => {
    const edited = updatePresetAt([...DEFAULT_BPM_PRESETS], 0, {
      name: "MYHOUSE",
      min: 122,
      max: 126,
    });
    saveBpmPresets(edited);
    expect(localStorage.getItem(BPM_PRESETS_KEY)).not.toBeNull();
    // simulate a fresh app boot: a brand-new load off the same storage
    expect(loadBpmPresets()).toEqual(edited);
  });
});
