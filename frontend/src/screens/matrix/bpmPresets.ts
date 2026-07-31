/**
 * BPM range preset hot buttons (issue #75, ruling R6).
 *
 * Four user-editable presets shown above the BPM drawer slider. Clicking one
 * writes its min/max into the existing BPM drawer line — it is NOT part of the
 * serializable filter-state object (a preset click just sets two numbers, so
 * #8 mirroring, the breadcrumb, and the export filename all keep working). The
 * preset names/ranges themselves are USER PREFS persisted to localStorage,
 * alongside sm3.matrix.skipApply / sm3.matrix.columns — never in filter state.
 *
 * Pure parse/serialize/validate helpers (the localStorage wrappers are thin and
 * guarded) so the logic is unit-testable in vitest's node env, matching the
 * parseLayout / loadSkipApply pattern in matrixStore.ts.
 */

export interface BpmPreset {
  name: string;
  min: number;
  max: number;
}

/** localStorage key — sits beside the other matrix prefs (layout, skipApply). */
export const BPM_PRESETS_KEY = "sm3.matrix.bpmPresets";

/** Exactly four presets, in button order (issue #75 defaults). */
export const DEFAULT_BPM_PRESETS: readonly BpmPreset[] = [
  { name: "HOUSE", min: 120, max: 128 },
  { name: "DISCO", min: 115, max: 126 },
  { name: "TECHNO", min: 124, max: 132 },
  { name: "BASS", min: 64, max: 100 },
] as const;

export const BPM_PRESET_COUNT = DEFAULT_BPM_PRESETS.length;

/** True when `p` is a well-formed preset (finite numbers, min ≤ max, non-empty name). */
function isValidPreset(p: unknown): p is BpmPreset {
  if (!p || typeof p !== "object") return false;
  const { name, min, max } = p as Record<string, unknown>;
  return (
    typeof name === "string" &&
    name.trim() !== "" &&
    typeof min === "number" &&
    Number.isFinite(min) &&
    typeof max === "number" &&
    Number.isFinite(max) &&
    min <= max
  );
}

/**
 * Parse a persisted presets string. Always returns exactly BPM_PRESET_COUNT
 * presets: any slot that is missing or malformed falls back to its default, so
 * a partial/corrupt payload can never lose the button grid (fail safe). May
 * throw only on non-JSON — loadBpmPresets' try/catch handles that.
 */
export function parseBpmPresets(raw: string | null): BpmPreset[] {
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  const arr = Array.isArray(parsed) ? parsed : [];
  return DEFAULT_BPM_PRESETS.map((def, i) => {
    const cand = arr[i];
    return isValidPreset(cand)
      ? { name: cand.name.trim(), min: cand.min, max: cand.max }
      : { ...def };
  });
}

export function serializeBpmPresets(presets: readonly BpmPreset[]): string {
  return JSON.stringify(presets);
}

/** Guarded load (vitest's node env has no localStorage → defaults). */
export function loadBpmPresets(): BpmPreset[] {
  try {
    return parseBpmPresets(localStorage.getItem(BPM_PRESETS_KEY));
  } catch {
    return DEFAULT_BPM_PRESETS.map((p) => ({ ...p }));
  }
}

/** Guarded save. */
export function saveBpmPresets(presets: readonly BpmPreset[]): void {
  try {
    localStorage.setItem(BPM_PRESETS_KEY, serializeBpmPresets(presets));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Which preset (index) the current BPM line values exactly match, or -1. Used to
 * light the active button orange; any manual edit away from a preset's exact
 * range deselects it (both bounds must match). Null bounds never match — a
 * preset always carries both numbers.
 */
export function activePresetIndex(
  presets: readonly BpmPreset[],
  min: number | null,
  max: number | null,
): number {
  if (min == null || max == null) return -1;
  return presets.findIndex((p) => p.min === min && p.max === max);
}

export type PresetValidation =
  | { ok: true; preset: BpmPreset }
  | { ok: false; error: string };

/**
 * Validate raw editor input (name + min/max as typed strings). Rejects
 * non-numeric bounds and min > max (issue #75 QA), and an empty name (a blank
 * button is unusable). On success returns the normalized preset.
 */
export function validateBpmPreset(
  name: string,
  minRaw: string,
  maxRaw: string,
): PresetValidation {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, error: "Name required" };
  const min = Number(minRaw);
  const max = Number(maxRaw);
  if (minRaw.trim() === "" || !Number.isFinite(min))
    return { ok: false, error: "Min must be a number" };
  if (maxRaw.trim() === "" || !Number.isFinite(max))
    return { ok: false, error: "Max must be a number" };
  if (min > max) return { ok: false, error: "Min must be ≤ Max" };
  return { ok: true, preset: { name: trimmed, min, max } };
}

/** Immutable single-slot update, returning a new presets array. */
export function updatePresetAt(
  presets: readonly BpmPreset[],
  index: number,
  preset: BpmPreset,
): BpmPreset[] {
  return presets.map((p, i) => (i === index ? { ...preset } : { ...p }));
}
