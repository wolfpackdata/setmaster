/**
 * S3 structured keyword query parser (issue #24, ruling R7 — SELF-CONTAINED).
 *
 * A DETERMINISTIC mini-parser (explicitly NOT the deferred NL/LLM prompt bar).
 * It reads the RAW #15 search-box string and splits it into:
 *   • `contains` — the leftover free text, fed UNCHANGED to #15's contains-OR
 *     search across Artist / Album / Track (so #15 keeps working verbatim);
 *   • `clauses`  — recognized `COLUMN<op>value` / `COLUMN from X to Y` /
 *     `COLUMN past N unit` clauses, mapped to the SAME predicates the drawer /
 *     column filters use (numeric min/max, key set, date window).
 *
 * R7 is self-contained: clauses filter INVISIBLY from the box — they are NOT
 * mirrored into `applied.columns` or the drawer. The raw box string stays the
 * single source of truth in state (so Clear/✕/#14's `Search ~` token all keep
 * working on the raw string); the structured form is DERIVED here at filter
 * time. In particular `past N unit` windows are computed from `now` on every
 * parse and never persisted, so they always mean "today".
 *
 * Graceful degradation (the grid must never blank mid-typing): a keyword whose
 * value is absent/invalid, or an unknown `word=value`, forms NO clause and its
 * text falls through as literal `contains`. So `BPM=`, `Key=`, `Foo=1` are all
 * plain text until they complete into a recognized clause.
 */

import { KEY_TABLE } from "../../lib/keys";

// ---------------------------------------------------------------------------
// Column keyword table (data — aliases → column id + kind). The three contains
// columns (Artist / Album / Track) and File Path intentionally have NO keyword.
// Super/Root name the same `root` id; Nonsuper/Nonroot the same `nonroot` id
// (user-facing "Super Playlist" per #11; internal ids stay root/nonroot).
// ---------------------------------------------------------------------------

export type ClauseKind = "num" | "keys" | "date";

interface KeywordDef {
  colId: string;
  kind: ClauseKind;
}

/** alias (lower-case) → column def. */
export const KEYWORD_MAP: ReadonlyMap<string, KeywordDef> = new Map<string, KeywordDef>([
  ["bpm", { colId: "bpm", kind: "num" }],
  ["playcount", { colId: "playcount", kind: "num" }],
  ["plays", { colId: "playcount", kind: "num" }],
  ["key", { colId: "key", kind: "keys" }],
  ["keys", { colId: "key", kind: "keys" }],
  ["released", { colId: "release_date", kind: "date" }],
  ["release", { colId: "release_date", kind: "date" }],
  ["imported", { colId: "import_date", kind: "date" }],
  ["import", { colId: "import_date", kind: "date" }],
  ["played", { colId: "last_played", kind: "date" }],
  ["super", { colId: "root", kind: "num" }],
  ["root", { colId: "root", kind: "num" }],
  ["nonsuper", { colId: "nonroot", kind: "num" }],
  ["nonroot", { colId: "nonroot", kind: "num" }],
]);

// Alternation ordered longest-first within shared prefixes so e.g. "released"
// wins over "release" and "nonroot" over "root". Leftmost-match + the leading
// \b also protect "root" inside "nonroot" from matching.
const KEYWORD_ALT = [
  "playcount",
  "plays",
  "played",
  "nonsuper",
  "nonroot",
  "released",
  "release",
  "imported",
  "import",
  "super",
  "root",
  "keys",
  "key",
  "bpm",
].join("|");

// ---------------------------------------------------------------------------
// Key notation normalization — REUSE the existing 24-key basis (KEY_TABLE).
// Every notation spelling (flats / sharps / camelot / open-key), case-
// insensitive, maps back to the canonical flats key. Never a new mapping.
// ---------------------------------------------------------------------------

const KEY_LOOKUP: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const r of KEY_TABLE) {
    for (const spelling of [r.flats, r.sharps, r.camelot, r.openkey]) {
      m.set(spelling.toLowerCase(), r.flats);
    }
  }
  return m;
})();

/** Any-notation key token → canonical flats key, or null when unrecognized. */
export function normalizeKey(token: string): string | null {
  return KEY_LOOKUP.get(token.trim().toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Parsed clause shapes. Numeric carries exclusive flags so strict `<` / `>`
// are faithful; dates carry ISO "YYYY-MM-DD" bounds (same basis the column /
// drawer date filters use); keys carry a canonical-flats picklist.
// ---------------------------------------------------------------------------

export interface NumClause {
  colId: string;
  kind: "num";
  min: number | null;
  max: number | null;
  minEx: boolean;
  maxEx: boolean;
}
export interface KeysClause {
  colId: string;
  kind: "keys";
  picked: string[];
}
export interface DateClause {
  colId: string;
  kind: "date";
  min: string | null; // ISO "YYYY-MM-DD"
  max: string | null;
}
export type ParsedClause = NumClause | KeysClause | DateClause;

export interface ParsedSearch {
  /** Leftover free text for #15's contains-OR search (raw when no clause consumed). */
  contains: string;
  /** Structured clauses (deduped so the LAST clause for a column wins). */
  clauses: ParsedClause[];
}

// ---------------------------------------------------------------------------
// Relative-date window: trailing N units from `now` (local calendar date),
// returned as an ISO lower bound. Never persisted — computed each parse. This
// DAY-precision form serves the Import / Last Played columns; Release Date uses
// a YEAR-floored lower bound instead (see buildClause's `past` branch).
// ---------------------------------------------------------------------------

type Unit = "day" | "week" | "month" | "year";

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pastMinIso(n: number, unit: Unit, now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (unit) {
    case "day":
      d.setDate(d.getDate() - n);
      break;
    case "week":
      d.setDate(d.getDate() - 7 * n);
      break;
    case "month":
      d.setMonth(d.getMonth() - n);
      break;
    case "year":
      d.setFullYear(d.getFullYear() - n);
      break;
  }
  return toIso(d);
}

// ---------------------------------------------------------------------------
// The clause scanner. One global regex finds each anchored clause; everything
// it does not consume is `contains`.
//
// Groups: 1 keyword · 2 operator · 3 operator value-list · 4 from-X · 5 to-Y ·
//         6 past-N · 7 past-unit (when N present) · 8 past-unit (unit alone) ·
//         9 "this" (of "this year").
//
// The `past` tail matches either "<N> [unit]" (unit optional — Release-Date
// year-only form `released past 2`) or "<unit>" alone (N defaults to 1). Bare
// `past` never matches. `this year` is its own phrase (Release-Date "this
// year" = the current calendar year).
// ---------------------------------------------------------------------------

const VALUE_LIST = "[^\\s,]+(?:\\s*,\\s*[^\\s,]+)*";

function buildRegex(): RegExp {
  return new RegExp(
    "\\b(" +
      KEYWORD_ALT +
      ")" +
      "(?:" +
      "\\s*(<=|>=|<|>|=)\\s*(" +
      VALUE_LIST +
      ")" +
      "|\\s+from\\s+(\\S+)\\s+to\\s+(\\S+)" +
      "|\\s+past\\s+(?:(\\d+)(?:\\s+(day|week|month|year)s?)?|(day|week|month|year)s?)\\b" +
      "|\\s+(this)\\s+year\\b" +
      ")",
    "gi",
  );
}

const YEAR_RE = /^\d{4}$/;

function num(token: string): number | null {
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

function splitValues(list: string): string[] {
  return list.split(/\s*,\s*/).filter((v) => v !== "");
}

// Release Date comparisons are YEAR-ONLY (a great many release dates default to
// 1/1, so month/day is noise). Year bounds are expressed as the existing ISO
// DateClause min/max at Jan-1 / Dec-31, so the filter engine is untouched.
const RELEASE_COL = "release_date";

/** Build one clause from a regex match; null when the match is not a valid clause. */
function buildClause(m: RegExpExecArray, now: Date): ParsedClause | null {
  const def = KEYWORD_MAP.get(m[1].toLowerCase());
  if (!def) return null;
  const { colId, kind } = def;
  const op = m[2];
  const list = m[3];
  const fromX = m[4];
  const toY = m[5];
  const pastN = m[6]; // digits (only the "<N> [unit]" branch carries a number)
  const unit = (m[7] ?? m[8]) as Unit | undefined; // unit from either past branch
  const thisYear = m[9];
  const hasPast = pastN !== undefined || unit !== undefined;
  const isRelease = colId === RELEASE_COL;

  if (op !== undefined) {
    const values = splitValues(list);
    if (values.length === 0) return null;
    if (kind === "num") {
      const nums = values.map(num);
      if (nums.some((v) => v === null)) return null;
      const ns = nums as number[];
      switch (op) {
        case "=":
          return { colId, kind, min: Math.min(...ns), max: Math.max(...ns), minEx: false, maxEx: false };
        case "<":
          return { colId, kind, min: null, max: ns[0], minEx: false, maxEx: true };
        case "<=":
          return { colId, kind, min: null, max: ns[0], minEx: false, maxEx: false };
        case ">":
          return { colId, kind, min: ns[0], max: null, minEx: true, maxEx: false };
        case ">=":
          return { colId, kind, min: ns[0], max: null, minEx: false, maxEx: false };
      }
      return null;
    }
    if (kind === "keys") {
      if (op !== "=") return null; // keys are a set — only "=" is meaningful
      const picked: string[] = [];
      for (const v of values) {
        const k = normalizeKey(v);
        if (k && !picked.includes(k)) picked.push(k);
      }
      return picked.length > 0 ? { colId, kind, picked } : null;
    }
    // date: YEAR-ONLY comparisons. `=YYYY` is a whole calendar year; the four
    // inequalities bound the release/import/play YEAR (a year value carries no
    // month/day to lose, so the same ISO Jan-1/Dec-31 bounds are exact for both
    // year-only Release Date and day-precision Import/Last-Played columns).
    if (!values.every((v) => YEAR_RE.test(v))) return null;
    const years = values.map((v) => Number(v));
    const y0 = years[0];
    switch (op) {
      case "=":
        return {
          colId,
          kind: "date",
          min: `${Math.min(...years)}-01-01`,
          max: `${Math.max(...years)}-12-31`,
        };
      case ">": // year > Y  →  year ≥ Y+1
        return { colId, kind: "date", min: `${y0 + 1}-01-01`, max: null };
      case ">=":
        return { colId, kind: "date", min: `${y0}-01-01`, max: null };
      case "<": // year < Y  →  year ≤ Y−1
        return { colId, kind: "date", min: null, max: `${y0 - 1}-12-31` };
      case "<=":
        return { colId, kind: "date", min: null, max: `${y0}-12-31` };
    }
    return null;
  }

  if (fromX !== undefined && toY !== undefined) {
    if (kind === "num") {
      const a = num(fromX);
      const b = num(toY);
      if (a === null || b === null) return null;
      return { colId, kind, min: Math.min(a, b), max: Math.max(a, b), minEx: false, maxEx: false };
    }
    if (kind === "date") {
      if (!YEAR_RE.test(fromX) || !YEAR_RE.test(toY)) return null;
      const a = Number(fromX);
      const b = Number(toY);
      return { colId, kind, min: `${Math.min(a, b)}-01-01`, max: `${Math.max(a, b)}-12-31` };
    }
    return null; // keys have no range form
  }

  // "this year" — the current calendar year onward (date columns only).
  if (thisYear !== undefined) {
    if (kind !== "date") return null;
    return { colId, kind: "date", min: `${now.getFullYear()}-01-01`, max: null };
  }

  if (hasPast) {
    if (kind !== "date") return null; // "past" applies to date columns only
    if (isRelease) {
      // Release Date is YEAR-ONLY with DJ-world semantics:
      //   • the unit word is optional (`released past 2` ≡ `released past 2 years`)
      //     and, when present, must be `year` — day/week/month is nonsensical on a
      //     year-only column and falls through to literal text;
      //   • `past N years` = the current year plus the N−1 prior years
      //     (in 2026, `past 2` → 2025 & 2026 → min 1/1/2025);
      //   • `past year` / `past 1 year` = current AND prior year (min 1/1/2025 in
      //     2026) — INTENTIONALLY the same as `past 2`, not algebraic with `past N`.
      // Both collapse to: min year = currentYear − max(1, N−1).
      if (unit !== undefined && unit !== "year") return null;
      const n = pastN !== undefined ? parseInt(pastN, 10) : 1;
      const minYear = now.getFullYear() - Math.max(1, n - 1);
      return { colId, kind: "date", min: `${minYear}-01-01`, max: null };
    }
    // Import / Last Played keep DAY-precision windows and REQUIRE the unit word
    // (a bare `imported past 2` stays unrecognized → literal).
    if (unit === undefined) return null;
    const n = pastN !== undefined ? parseInt(pastN, 10) : 1;
    return { colId, kind: "date", min: pastMinIso(n, unit, now), max: null };
  }

  return null;
}

/**
 * Parse the raw search box into `{ contains, clauses }`. Deterministic; `now`
 * is injectable for tests (defaults to the current date so relative windows
 * always mean "today"). No clause is ever written back to state.
 */
export function parseSearch(raw: string, now: Date = new Date()): ParsedSearch {
  if (!raw || raw.trim() === "") return { contains: raw, clauses: [] };

  const re = buildRegex();
  const consumed: Array<[number, number]> = [];
  const ordered: ParsedClause[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[0] === "") {
      re.lastIndex++; // guard against a zero-length match stalling the loop
      continue;
    }
    const clause = buildClause(m, now);
    if (clause) {
      ordered.push(clause);
      consumed.push([m.index, re.lastIndex]);
    }
  }

  // Leftover free text. When nothing was consumed, return the raw string
  // UNCHANGED so #15's plain search is byte-for-byte unaffected.
  let contains: string;
  if (consumed.length === 0) {
    contains = raw;
  } else {
    let out = "";
    let last = 0;
    for (const [s, e] of consumed) {
      out += raw.slice(last, s);
      last = e;
    }
    out += raw.slice(last);
    contains = out.replace(/\s+/g, " ").trim();
  }

  // Same column twice → LAST clause wins (iterate left→right into a map).
  const byCol = new Map<string, ParsedClause>();
  for (const c of ordered) byCol.set(c.colId, c);

  return { contains, clauses: [...byCol.values()] };
}
