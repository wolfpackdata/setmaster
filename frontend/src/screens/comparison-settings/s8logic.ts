/**
 * S8 Comparison Settings + Import Spotify® Data flow — pure logic
 * (exportify-import.md §3-§6, 03-ui-design.md §5.8). No React/DOM so vitest
 * (node env) covers it: panel ordering, coverage tone, day-age text,
 * trademark decoration of backend copy, name normalization.
 */

import type { ComparisonTraktorRow, CoverageState } from "../../lib/api";

// ---------------------------------------------------------------------------
// Name normalization (exportify-import.md §4 — client mirror of the backend)
// ---------------------------------------------------------------------------

/** underscores → spaces, remove ALL spaces, compare case-insensitively. */
export function normalizePlaylistName(s: string): string {
  return s.replace(/_/g, " ").replace(/ /g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Traktor panel ordering (§5.8: checked-first, each group A–Z) + search
// ---------------------------------------------------------------------------

export function orderTraktorRows(
  rows: ComparisonTraktorRow[],
  search: string,
): ComparisonTraktorRow[] {
  const q = search.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q))
    : [...rows];
  return visible.sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/**
 * Coverage-slot tone (§5.8): checked+fresh → quiet muted text; checked with
 * stale/no data → amber warning text; unchecked → slot stays empty.
 */
export type CoverageTone = "muted" | "warn" | null;

export function coverageTone(
  checked: boolean,
  state: CoverageState,
): CoverageTone {
  if (!checked) return null;
  return state === "fresh" ? "muted" : "warn";
}

// ---------------------------------------------------------------------------
// Trademark decoration (03-ui-design.md §1.3.2)
// ---------------------------------------------------------------------------

/**
 * Backend-composed copy (batch summaries, coverage text) arrives without ®;
 * every RENDERED occurrence of the protected names must carry it. Idempotent —
 * already-marked names are left alone. "Exportify" stays plain (decided).
 *
 * Also repairs a UTF-8 double-encoding seen in the backend's batch-summary
 * string, where the "·" separator (U+00B7) is emitted as "Â·"
 * (U+00C2 U+00B7). This is display-copy only (never data); the underlying
 * backend emission should be fixed separately.
 */
export function brandText(s: string): string {
  return s
    .replace(/Â·/g, "·")
    .replace(/\b(Traktor|Spotify|Native Instruments)\b(?!®)/g, "$1®");
}

// ---------------------------------------------------------------------------
// Download age (§3.1: candidate list shows filename + download age)
// ---------------------------------------------------------------------------

export function ageDays(iso: string, now: Date = new Date()): number | null {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.max(Math.floor((now.getTime() - t) / 86_400_000), 0);
}

export function ageText(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  return `${days} day${days === 1 ? "" : "s"} old`;
}

export function candidateAge(mtimeIso: string, now: Date = new Date()): string {
  return ageText(ageDays(mtimeIso, now));
}
