/**
 * Global settings store (zustand). Loads from GET /api/settings, persists via
 * PUT /api/settings, and applies the four §3.5 display options app-wide by
 * writing CSS custom properties on the document root:
 *
 *   --grid-font-size  = font_size × TYPE_SCALE px   (issue #2 +10% baseline,
 *                       composed here per ruling R2 so grid text scales too
 *                       while the user-facing Font Size control keeps its clean
 *                       10–20px value)
 *   --grid-row-height = fontSize + round(19px × line_spacing / 100)  (DIRECT:
 *                       more spacing → taller rows → roomier grid), floored at
 *                       fontSize + 8px (§3.5 floor), derived from the SCALED
 *                       font so the taller text never clips. Default 100 gives
 *                       the same 19px gap the pre-#78 inverse formula gave at
 *                       text_zoom 100.
 *
 * No double-scaling: the inline --grid-font-size written here REPLACES the
 * tokens.css calc() fallback on :root (inline wins, it is not a compounding
 * calc(var(--grid-font-size) × …)). CSS that reads var(--grid-font-size) or
 * var(--type-body-size) both resolve to 13 × 1.1 = 14.3px at defaults.
 */

import { create } from "zustand";
import {
  getSettings,
  putSettings,
  type DisplaySettings,
  type Settings,
  type SettingsPatch,
} from "../lib/api";

export const DISPLAY_DEFAULTS: DisplaySettings = {
  line_spacing: 100,
  font_size: 13,
  key_display_as: "flats",
  colorful_keys: true,
  // Issue #81: grid-only matrix zoom (S3), 100% = no zoom. Deliberately NOT
  // folded into applyDisplay / the row-height formula — Font and Spacing own
  // the stored dimensions; Zoom scales their rendered result on .mx-gridwrap.
  matrix_zoom: 100,
  // Issue #140: S2 column visibility, app-wide next to Spacing / Font Size.
  // Both default to visible; a settings file written before #140 simply lacks
  // them and the backend deep-fills these defaults on read.
  show_timing_columns: true,
  show_mix_timer_column: true,
  // Issue #145: loud cue columns, both OFF by default.
  loud_t_column: false,
  loud_m_column: false,
};

export const SETTINGS_DEFAULTS: Settings = {
  collection_nml_path: "",
  super_playlist_folder: "",
  exclude_prefixes: [],
  display: DISPLAY_DEFAULTS,
  last_export_format: "csv",
};

/**
 * Global +10% type-scale baseline (issue #2). Mirrors `--type-scale` in
 * tokens.css — keep the two in lockstep. Composed into the grid font size at
 * apply time (R2) so the user-facing Font Size stays a clean 10–20px value.
 */
export const TYPE_SCALE = 1.1;

/** The rendered grid font size: user Font Size composed with the +10% baseline. */
export function scaledGridFontSize(fontSize: number): number {
  return fontSize * TYPE_SCALE;
}

/** §3.5 Spacing formula — row height derives from font size and line spacing.
 * Direct: higher spacing → taller rows. Default 100 reproduces the 19px gap. */
export function computeRowHeight(fontSize: number, lineSpacing: number): number {
  const raw = fontSize + Math.round((19 * lineSpacing) / 100);
  return Math.max(raw, fontSize + 8);
}

/**
 * Row height for EITHER grid (issue #105). The single basis both S2 and S3 use.
 *
 * It has to be one function, not two matching call sites. The Set Editor passed
 * the SCALED font while the Matrix passed the raw `font_size`, so the two grids
 * differed by the type-scale factor — 33.3px vs 32px at the default. That was a
 * bug on the matrix side rather than a style choice: `matrix.css` renders its
 * cells at `var(--grid-font-size)`, which is the *scaled* value, so its rows were
 * sized for a smaller font than the text they contain — 1.3px short at the
 * default and 2px at Font Size 20, eating the §3.5 gap as the font grows.
 *
 * Scaled is therefore the correct basis on both screens; nothing composes the
 * +10% baseline twice.
 */
export function gridRowHeight(
  display: Pick<DisplaySettings, "font_size" | "line_spacing">,
): number {
  return computeRowHeight(scaledGridFontSize(display.font_size), display.line_spacing);
}

function applyDisplay(display: DisplaySettings): void {
  const root = document.documentElement;
  root.style.setProperty(
    "--grid-font-size",
    `${scaledGridFontSize(display.font_size)}px`,
  );
  root.style.setProperty("--grid-row-height", `${gridRowHeight(display)}px`);
}

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  /** Non-null when the backend is unreachable / errored at load. */
  loadError: string | null;
  load: () => Promise<void>;
  /** Optimistic partial update, persisted via PUT /api/settings. */
  update: (patch: SettingsPatch) => Promise<void>;
}

function mergePatch(current: Settings, patch: SettingsPatch): Settings {
  return {
    ...current,
    ...patch,
    display: { ...current.display, ...(patch.display ?? {}) },
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: SETTINGS_DEFAULTS,
  loaded: false,
  loadError: null,

  load: async () => {
    try {
      const settings = await getSettings();
      applyDisplay(settings.display);
      set({ settings, loaded: true, loadError: null });
    } catch (err) {
      applyDisplay(DISPLAY_DEFAULTS);
      set({
        loaded: true,
        loadError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  update: async (patch) => {
    const before = get().settings;
    const optimistic = mergePatch(before, patch);
    applyDisplay(optimistic.display);
    set({ settings: optimistic });
    try {
      const saved = await putSettings(patch);
      applyDisplay(saved.display);
      set({ settings: saved });
    } catch (err) {
      // Roll back on failure; caller surfaces the error (toast).
      applyDisplay(before.display);
      set({ settings: before });
      throw err;
    }
  },
}));
