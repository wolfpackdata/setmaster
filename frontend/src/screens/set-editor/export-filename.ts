/**
 * Set-export filename helpers (planning/02-features/set-export.md §5).
 *
 * Pure logic shared by the Export dialog: slugify a set name, compute the
 * default `<slug>_<YYYY-MM-DD>.<ext>` filename, and swap the extension when the
 * user switches format. Mirrors the backend `slugify` / `export_filename_for`
 * so the field preview matches the file the server actually streams.
 */

import type { ExportFormat } from "../../lib/api";

export const EXPORT_EXT: Record<ExportFormat, string> = {
  csv: "csv",
  xlsx: "xlsx",
  markdown: "md",
};

/** Extensions recognised on a remembered name so we can swap in the format's. */
const KNOWN_EXT = new Set(["csv", "xlsx", "md", "markdown", "txt"]);

/**
 * Filesystem-illegal characters on Windows/macOS. Not '-' or space: spaces are
 * turned into '-' first, and set names come from a trimmed text field so they
 * never carry control characters.
 */
const ILLEGAL = /[<>:"/\\|?*]/g;

/** §5 slugify: lowercase, spaces→`-`, strip filesystem-illegal characters. */
export function slugify(name: string): string {
  const stripped = name
    .trim()
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(ILLEGAL, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return stripped || "set";
}

/** Today's date as YYYY-MM-DD in UTC (matches the backend default). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Split a filename into base + lowercase extension (without the dot). */
function splitExt(filename: string): { base: string; ext: string | null } {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return { base: filename, ext: null };
  return { base: filename.slice(0, dot), ext: filename.slice(dot + 1).toLowerCase() };
}

/** The §5 default filename for a set and format. */
export function defaultFilename(setName: string, format: ExportFormat): string {
  return `${slugify(setName)}_${todayIso()}.${EXPORT_EXT[format]}`;
}

/**
 * Re-point a filename's extension at `format`'s extension. A recognised export
 * extension is replaced; anything else is preserved and the new extension is
 * appended (so `my.set` → `my.set.csv`, `mix.xlsx` → `mix.csv`).
 */
export function withFormatExt(filename: string, format: ExportFormat): string {
  const ext = EXPORT_EXT[format];
  const trimmed = filename.trim();
  if (!trimmed) return trimmed;
  const { base, ext: cur } = splitExt(trimmed);
  if (cur !== null && KNOWN_EXT.has(cur)) return `${base}.${ext}`;
  return `${trimmed}.${ext}`;
}

/**
 * Initial filename shown when the dialog opens: the set's remembered
 * export_filename (extension aligned to the current format) or the default.
 */
export function initialFilename(
  remembered: string | null | undefined,
  setName: string,
  format: ExportFormat,
): string {
  if (remembered && remembered.trim()) return withFormatExt(remembered, format);
  return defaultFilename(setName, format);
}
