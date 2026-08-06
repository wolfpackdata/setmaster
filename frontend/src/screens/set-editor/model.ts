/**
 * S2 Set Editor — pure row-model logic (planning/01-data-model.md §4.2).
 *
 * Store In-side only; derive Out-side, per-row minutes, cumulative mix
 * length, and the four SM2 stats (code reference §3.2 formulas). All pure
 * functions — unit-tested in model.test.ts.
 */

import type { SetRow } from "../../lib/api";
import { KEY_TABLE } from "../../lib/keys";
import { EMPTY_ENUM } from "./columns";

/** §4.2: I like defaults to ⚠️ on new rows. */
export const DEFAULT_I_LIKE = "⚠️";

function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Non-secure fallback (test envs without WebCrypto) — ids only need to be
  // unique within a set.
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh empty transition row with the §4.2 defaults. */
export function makeEmptyRow(): SetRow {
  return {
    id: uuid(),
    bpm: "",
    key: "",
    in_name: "",
    in_delta: EMPTY_ENUM,
    m_num: EMPTY_ENUM,
    t_num: EMPTY_ENUM,
    a_num: EMPTY_ENUM,
    lows: "",
    level: "",
    swap_lows: EMPTY_ENUM,
    i_like: DEFAULT_I_LIKE,
    notes: "",
    start: "",
    transition: "",
  };
}

/** True when the row holds anything beyond the new-row defaults. */
export function rowHasContent(row: SetRow): boolean {
  return Boolean(
    row.in_name.trim() ||
      row.bpm.trim() ||
      row.key.trim() ||
      row.notes.trim() ||
      row.start.trim() ||
      row.transition.trim() ||
      (row.in_delta && row.in_delta !== EMPTY_ENUM) ||
      (row.m_num && row.m_num !== EMPTY_ENUM) ||
      (row.t_num && row.t_num !== EMPTY_ENUM) ||
      (row.a_num && row.a_num !== EMPTY_ENUM) ||
      row.lows ||
      row.level ||
      (row.swap_lows && row.swap_lows !== EMPTY_ENUM) ||
      (row.i_like && row.i_like !== DEFAULT_I_LIKE),
  );
}

// ---------------------------------------------------------------------------
// Out-side derivation (SM2 template: D `=TRIM(I<prev>)`, E `=TRIM(J<prev>)`)
// ---------------------------------------------------------------------------

export interface OutSide {
  name: string;
  delta: string;
}

/**
 * Derived Out Track per row: mirrors the PREVIOUS row's In side; the first
 * row has no Out side (§4.2 — never stored).
 */
export function deriveOuts(rows: readonly SetRow[]): OutSide[] {
  return rows.map((_, i) => {
    if (i === 0) return { name: "", delta: "" };
    const prev = rows[i - 1];
    return { name: prev.in_name.trim(), delta: prev.in_delta.trim() };
  });
}

// ---------------------------------------------------------------------------
// Timing (§4.2 m:ss text; SM2 S/T column formulas, code reference §3.2)
// ---------------------------------------------------------------------------

/**
 * Parse `m:ss` text to total seconds; null when blank/unparseable.
 * Minutes are unbounded (3-hour sets); seconds must be two digits 00–59.
 */
export function parseMss(text: string): number | null {
  const m = /^\s*(\d{1,3}):([0-5]\d)\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Normalize a user-typed timing string to canonical `M:SS`, or null when it
 * cannot be sensibly interpreted (issue #25 conversion table). Opt-in commit
 * validation for the Start / Transition cells — everywhere else timing text is
 * still read leniently by `parseMss`.
 *
 * Rules:
 * - A single `:` `;` `.` or `,` separates minutes and seconds (`;` `.` `,`
 *   are typo-friendly stand-ins for `:`); seconds are two digits 00–59,
 *   minutes are unbounded (3-hour sets). `1;30` / `1.30` / `1,30` → `1:30`.
 * - Pure digits: the rightmost two are the seconds (00–59), the rest minutes.
 *   `5` → `0:05`, `30` → `0:30`, `101` → `1:01`, `1234` → `12:34`.
 * - Anything else (letters, seconds > 59, one-digit seconds, multiple
 *   separators, empty) → null.
 */
export function normalizeMss(text: string): string | null {
  const t = text.trim();
  if (!t) return null;

  const seps = t.match(/[:;.,]/g);
  if (seps) {
    // Exactly one separator; both sides are digits (2-digit seconds 00–59).
    if (seps.length > 1) return null;
    const [mm, ss] = t.split(/[:;.,]/);
    if (!/^\d+$/.test(mm) || !/^\d{2}$/.test(ss)) return null;
    if (Number(ss) > 59) return null;
    return `${Number(mm)}:${ss}`;
  }

  if (!/^\d+$/.test(t)) return null;
  const ss = t.length <= 2 ? t.padStart(2, "0") : t.slice(-2);
  const mm = t.length <= 2 ? "0" : t.slice(0, -2);
  if (Number(ss) > 59) return null;
  return `${Number(mm)}:${ss}`;
}

/**
 * Cross-field commit validation (issue #70): when BOTH cells parse as M:SS,
 * Start must be strictly earlier than Transition. A blank or unparseable
 * side never blocks — either cell is allowed to be blank.
 */
export function timingOrdered(start: string, transition: string): boolean {
  const s = parseMss(start);
  const t = parseMss(transition);
  if (s === null || t === null) return true;
  return s < t;
}

/** Rejection message for `timingOrdered`, naming the other cell's value. */
export function timingOrderMsg(
  col: "start" | "transition",
  other: string,
): string {
  return col === "start"
    ? `Start must be before Transition (${other}).`
    : `Transition must be after Start (${other}).`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Per-row minutes: `transition − start` in minutes, rounded to 2 — mirrors
 * SM2's `=ROUND(HOUR(R-Q) + MINUTE(R-Q)/60, 2)` (the user types m:ss into
 * Excel's h:mm slots, so HOUR = whole minutes and MINUTE/60 = seconds part).
 * Blank/unparseable/negative → null (SM2 shows an error/blank there).
 */
export function rowMinutes(start: string, transition: string): number | null {
  const s = parseMss(start);
  const t = parseMss(transition);
  if (s === null || t === null) return null;
  const diff = t - s;
  if (diff < 0) return null;
  return round2(diff / 60);
}

export interface SetTiming {
  /** Per-row minutes (SM2 col S "Mins Calc", grid "Play Time" #72); null = blank. */
  mins: (number | null)[];
  /** Running total (SM2 col T "Mix Length", grid "Mix Timer" #72); rows with minutes. */
  cumulative: (number | null)[];
  /** Stat: Mix Length = MAX of the running total; null when no timing. */
  mixLength: number | null;
}

export function computeTiming(rows: readonly SetRow[]): SetTiming {
  const mins: (number | null)[] = [];
  const cumulative: (number | null)[] = [];
  let running = 0;
  let any = false;
  for (const row of rows) {
    const m = rowMinutes(row.start, row.transition);
    mins.push(m);
    if (m === null) {
      cumulative.push(null);
    } else {
      running = round2(running + m);
      cumulative.push(running);
      any = true;
    }
  }
  return { mins, cumulative, mixLength: any ? running : null };
}

/**
 * Warning predicate (issue #82): true when at least one row that HAS an Out
 * Track (derived non-empty Out Track Name) has no computable OUT TRACK TIMING
 * — its Start or Transition is blank, unparseable, or invalid, so
 * `rowMinutes` returns null. Rows with timing but no Out Track name do NOT
 * count; the Mix Length total is a partial sum in that case, and the caller
 * flags it as incomplete.
 */
export function hasIncompleteTiming(rows: readonly SetRow[]): boolean {
  const outs = deriveOuts(rows);
  return rows.some(
    (row, i) =>
      outs[i].name !== "" && rowMinutes(row.start, row.transition) === null,
  );
}

// ---------------------------------------------------------------------------
// The four SM2 stats (workbook Mix Stats block, code reference §3.2)
// ---------------------------------------------------------------------------

export interface SetStats {
  /** `# Tracks` — COUNTA of In Track Name (rows with a non-empty name). */
  trackCount: number;
  /** `Mix Length` — max cumulative minutes; null → "---". */
  mixLength: number | null;
  /** `BPM Avg.` — average of numeric BPM cells; null → "-----". */
  bpmAvg: number | null;
  /** `BPM Crest` — max − min of numeric BPM cells; null → "---". */
  bpmCrest: number | null;
}

/**
 * A BPM cell as a number, or null when it is blank or not numeric. BPM is
 * typed by hand (§4.2), so free text is expected and must not be coerced —
 * `Number("")` is 0, which is why the blank check comes first.
 */
export function parseBpm(text: string | undefined): number | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Direction of a row's BPM relative to the row ABOVE it (#138): `"up"` when
 * faster, `"down"` when slower, null when there is nothing meaningful to
 * compare — the first row, either side blank or non-numeric, or equal values.
 *
 * The comparison is always against the immediately preceding row, blank
 * included: a blank row between two filled ones breaks the chain rather than
 * reaching further up for a value to compare against.
 */
export function bpmDirection(
  prev: string | undefined,
  current: string,
): "up" | "down" | null {
  const a = parseBpm(prev);
  const b = parseBpm(current);
  if (a === null || b === null) return null;
  if (b > a) return "up";
  if (b < a) return "down";
  return null;
}

function numericBpms(rows: readonly SetRow[]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const t = row.bpm.trim();
    if (!t) continue;
    const n = Number(t);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function computeStats(rows: readonly SetRow[]): SetStats {
  const trackCount = rows.filter((r) => r.in_name.trim() !== "").length;
  const bpms = numericBpms(rows);
  const bpmAvg = bpms.length
    ? bpms.reduce((a, b) => a + b, 0) / bpms.length
    : null;
  const bpmCrest = bpms.length ? Math.max(...bpms) - Math.min(...bpms) : null;
  return {
    trackCount,
    mixLength: computeTiming(rows).mixLength,
    bpmAvg,
    bpmCrest,
  };
}

/** 2-dp minutes display, no trailing-zero padding (SM2 shows `84.53`, `3.5`). */
export function fmtMinutes(n: number): string {
  return String(round2(n));
}

/**
 * 1-dp minutes display for the grid's Play Time / Mix Timer cells (issue
 * #70) — rounded, never truncated, no trailing-zero padding. Rounds in
 * integer hundredths first so 2-dp halves round up (3.45 → 3.5) instead of
 * falling to float artifacts (3.45 * 10 === 34.499…).
 */
export function fmtMinutes1(n: number): string {
  return String(Math.round(Math.round(n * 100) / 10) / 10);
}

/** 1-dp BPM stat display. */
export function fmtBpmStat(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * Display-only H:MM for the Mix Length STAT (issue #82) — decimal minutes
 * rounded to the nearest whole minute, then split into hours and two-digit
 * minutes. Hours have no leading zero beyond a single `0:` for sub-hour sets;
 * minutes always render two digits. 84.53 → `1:25`, 84.4 → `1:24`,
 * 47 → `0:47`, 65 → `1:05`, 119.6 → `2:00`. The stat's internal value stays
 * decimal minutes (`computeTiming().mixLength`); this only formats it.
 */
export function fmtHMM(n: number): string {
  const totalMinutes = Math.round(n);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// [TAG] name-prefix chips (§5.2 / walkthrough §5.4 — e.g. [UNSYNC])
// ---------------------------------------------------------------------------

export interface ParsedName {
  tags: string[];
  text: string;
}

/**
 * Parse leading bracketed prefixes out of a track name: `[UNSYNC] Foo` →
 * tags ["UNSYNC"], text "Foo". Only LEADING `[...]` groups become chips;
 * brackets mid-name are left alone.
 */
export function parseNameTags(name: string): ParsedName {
  const tags: string[] = [];
  let rest = name;
  const re = /^\s*\[([^\][]+)\]/;
  for (;;) {
    const m = re.exec(rest);
    if (!m) break;
    tags.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  return { tags, text: tags.length ? rest.replace(/^\s+/, "") : name };
}

// ---------------------------------------------------------------------------
// Key-cell parsing (§4.2: manually typed; "rendered per Key Display As WHEN
// PARSEABLE as a key" — anything else passes through untouched)
// ---------------------------------------------------------------------------

const KEY_LOOKUP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const row of KEY_TABLE) {
    // Any of the 4 notations, case-insensitive, resolves to canonical flats.
    for (const text of [row.flats, row.sharps, row.camelot, row.openkey]) {
      map.set(text.toLowerCase(), row.flats);
    }
  }
  return map;
})();

/**
 * Canonical flats key for a manually-typed Key cell, or null when the text
 * is not parseable as a key (free text stays as typed — never rewritten;
 * this affects DISPLAY only).
 */
export function canonicalizeKey(text: string): string | null {
  return KEY_LOOKUP.get(text.trim().toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Row reordering
// ---------------------------------------------------------------------------

/**
 * Move the contiguous block `[start, start+len)` so it sits at gap position
 * `gap` (a position BETWEEN rows of the original array, 0..length). Gaps
 * inside the block are no-ops. Pure — returns a new array.
 */
export function moveBlock<T>(arr: readonly T[], start: number, len: number, gap: number): T[] {
  if (start < 0 || len <= 0 || start + len > arr.length) return [...arr];
  if (gap >= start && gap <= start + len) return [...arr];
  const block = arr.slice(start, start + len);
  const rest = [...arr.slice(0, start), ...arr.slice(start + len)];
  const insertAt = gap > start ? gap - len : gap;
  rest.splice(insertAt, 0, ...block);
  return rest;
}

// ---------------------------------------------------------------------------
// Out-side / In-side field split on reorder (issue #133)
// ---------------------------------------------------------------------------

/**
 * Stored fields that describe the row's OUT TRACK — everything under the OUT
 * TRACK and OUT TRACK TIMING super-headers. Row `i`'s Out Track is the track
 * stored as row `i−1`'s In side, so these describe a *different* track than
 * the row they sit on, and a reorder has to carry them to wherever that track
 * ended up (#133).
 */
export const OUT_SIDE_FIELDS = [
  "bpm",
  "key",
  "t_num",
  "a_num",
  "start",
  "transition",
] as const;

/**
 * Stored fields that describe the row's own IN TRACK. These are the row's
 * identity — they travel with it, exactly as `moveBlock` always moved them.
 * (`out_name` / `out_delta` / Play Time / Mix Timer are never stored: they are
 * re-derived by `deriveOuts` / `computeTiming` on every render.)
 */
export const IN_SIDE_FIELDS = [
  "in_name",
  "in_delta",
  "m_num",
  "lows",
  "level",
  "swap_lows",
  "i_like",
  "notes",
] as const;

type OutSideFields = Pick<SetRow, (typeof OUT_SIDE_FIELDS)[number]>;

/** The six Out-side values a row currently holds. */
function outSideOf(row: SetRow): OutSideFields {
  return {
    bpm: row.bpm,
    key: row.key,
    t_num: row.t_num,
    a_num: row.a_num,
    start: row.start,
    transition: row.transition,
  };
}

/** Out-side values for a row whose Out Track never had any recorded. */
function emptyOutSide(): OutSideFields {
  return {
    bpm: "",
    key: "",
    t_num: EMPTY_ENUM,
    a_num: EMPTY_ENUM,
    start: "",
    transition: "",
  };
}

/**
 * Reorder rows, keeping every stored value attached to the track it describes
 * (issue #133).
 *
 * `moveBlock` permutes whole rows, which is right for the In side and wrong for
 * the Out side: row `i`'s `bpm` / `key` / `t_num` / `a_num` / `start` /
 * `transition` describe the track stored one row EARLIER, so a straight row
 * move leaves them beside the wrong track — the mangling in #133.
 *
 * The fix applies the row permutation to the In side and an offset-by-one
 * permutation to the Out side. Writing `π(k)` for the old index of the row that
 * lands at new index `k`:
 *
 * - In side of new row `k` (and its `id`) comes from old row `π(k)`.
 * - Out side of new row `k` describes the track now sitting at `k−1`, i.e. old
 *   track `π(k−1)`, whose Out side was stored at old row `π(k−1) + 1`.
 *
 * Two boundaries fall out of that:
 *
 * - **Row 0 is a phantom slot.** It has no Out Track (#83 already makes its
 *   timing cells read-only), so its Out-side cells describe nothing and never
 *   participate in a move — they stay exactly as they were. This also keeps a
 *   move that does not involve row 0 from perturbing row 0 at all, which the
 *   straight-permutation reading would not: it would blank row 1's cells every
 *   time rows were shuffled anywhere below.
 * - **A track that becomes last loses its Out side**, because there is no row
 *   after it to store one. That is inherent to storing the Out side on the
 *   following row; the move is a single `mutate()`, so Ctrl+Z restores it.
 *
 * Pure — returns a new array. Same no-op guards as `moveBlock`.
 */
export function moveRowsPreservingOutSide(
  rows: readonly SetRow[],
  start: number,
  len: number,
  gap: number,
): SetRow[] {
  const order = moveBlock(
    rows.map((_, i) => i),
    start,
    len,
    gap,
  );
  return order.map((src, k) => {
    const base = rows[src];
    if (k === 0) return { ...base, ...outSideOf(rows[0]) };
    const outSrc = order[k - 1] + 1;
    return {
      ...base,
      ...(outSrc < rows.length ? outSideOf(rows[outSrc]) : emptyOutSide()),
    };
  });
}

/** True when a row holds at least one non-default Out-side value. */
function hasOutSideData(row: SetRow): boolean {
  return (
    row.bpm.trim() !== "" ||
    row.key.trim() !== "" ||
    row.start.trim() !== "" ||
    row.transition.trim() !== "" ||
    (row.t_num !== "" && row.t_num !== EMPTY_ENUM) ||
    (row.a_num !== "" && row.a_num !== EMPTY_ENUM)
  );
}

/**
 * True when a move would push Out-side data off the bottom of the set (#166).
 *
 * A track's Out-side values live on the row AFTER the one naming it, so the
 * track sitting last has nowhere to store its own — that is the D-16 boundary
 * recorded during #133. Moving a track into the last position therefore DROPS
 * the six values it had, silently and with nothing on screen to notice.
 *
 * Exactly one Out side can be lost per move. Writing `π(k)` for the old index of
 * the row landing at new index `k`, the Out sides read back are those stored at
 * `π(k) + 1` for `k = 0 … n−2`; the one source index never read is
 * `π(n−1) + 1` — the Out side of whichever track ends up last.
 *
 * So this returns true only when BOTH hold:
 *
 * - the track at the bottom actually changes (`π(n−1) ≠ n−1`) — a move that
 *   leaves the last row alone can lose nothing, since that track never had an
 *   Out side stored anyway; and
 * - the row that held that track's Out side carries at least one real value —
 *   moving an untouched row to the bottom loses nothing and must not nag.
 *
 * The caller's remedy is to append rows first: with a row below it, the moved
 * track keeps somewhere to store its Out side and nothing is dropped.
 */
export function moveDropsOutSideData(
  rows: readonly SetRow[],
  start: number,
  len: number,
  gap: number,
): boolean {
  const n = rows.length;
  const order = moveBlock(
    rows.map((_, i) => i),
    start,
    len,
    gap,
  );
  if (n === 0) return false;
  const lastSrc = order[n - 1];
  // The bottom track is unchanged → its (never-stored) Out side is unaffected.
  if (lastSrc === n - 1) return false;
  const outSrc = lastSrc + 1;
  return outSrc < n && hasOutSideData(rows[outSrc]);
}
