/**
 * Issue #24 — structured keyword query parser (ruling R7, self-contained).
 *
 * Two layers of coverage:
 *   1. parseSearch() grammar unit tests — every clause form in the issue body,
 *      operator variants, key normalization across notations, date windows
 *      (year-equality + past-N-units), last-wins, graceful mid-typing/unknown.
 *   2. EQUIVALENCE tests through the real engine — a parsed clause filters a
 *      fixture IDENTICALLY to the same constraint expressed as a manual drawer
 *      line or column filter (applyFilterSort / filterIndices).
 */

import { describe, expect, it } from "vitest";
import type { MatrixData } from "../../lib/api";
import { filterIndices, prepareMatrix } from "./filtering";
import { emptyFilterState, type MatrixFilterState } from "./filterState";
import {
  normalizeKey,
  parseSearch,
  type DateClause,
  type KeysClause,
  type NumClause,
} from "./searchQuery";

// ---------------------------------------------------------------------------
// Parser-only helpers
// ---------------------------------------------------------------------------

const clausesOf = (raw: string, now?: Date) => parseSearch(raw, now).clauses;
const containsOf = (raw: string) => parseSearch(raw).contains;
const one = (raw: string, now?: Date) => {
  const c = clausesOf(raw, now);
  expect(c).toHaveLength(1);
  return c[0];
};

describe("parseSearch — numeric operator forms (BPM / Play Count / Super / Nonsuper)", () => {
  it("`=value` is exact (min = max = value)", () => {
    expect(one("BPM=125")).toEqual<NumClause>({
      colId: "bpm", kind: "num", min: 125, max: 125, minEx: false, maxEx: false,
    });
  });
  it("`=X,Y` is an inclusive range", () => {
    expect(one("BPM=120,125")).toMatchObject({ colId: "bpm", min: 120, max: 125, minEx: false, maxEx: false });
  });
  it("`from X to Y` equals `=X,Y`", () => {
    expect(one("BPM from 120 to 125")).toMatchObject({ min: 120, max: 125, minEx: false, maxEx: false });
  });
  it("`<=` / `>=` are inclusive bounds", () => {
    expect(one("Playcount<=2")).toMatchObject({ colId: "playcount", min: null, max: 2, maxEx: false });
    expect(one("BPM>=120")).toMatchObject({ colId: "bpm", min: 120, max: null, minEx: false });
  });
  it("`<` / `>` are STRICT bounds (exclusive flags set)", () => {
    expect(one("BPM<124")).toMatchObject({ min: null, max: 124, maxEx: true });
    expect(one("BPM>120")).toMatchObject({ min: 120, max: null, minEx: true });
  });
  it("tolerates whitespace around operator and commas", () => {
    expect(one("BPM = 120 , 125")).toMatchObject({ min: 120, max: 125 });
  });
  it("`Playcount=0` keeps the explicit zero", () => {
    expect(one("Playcount=0")).toMatchObject({ colId: "playcount", min: 0, max: 0 });
  });
  it("Super / Root / Nonsuper / Nonroot map to root / nonroot ids (#11 naming)", () => {
    expect(one("Super>=1").colId).toBe("root");
    expect(one("Root>=1").colId).toBe("root");
    expect(one("Nonsuper=0")).toMatchObject({ colId: "nonroot", min: 0, max: 0 });
    expect(one("Nonroot=1,5")).toMatchObject({ colId: "nonroot", min: 1, max: 5 });
  });
  it("`Plays` is a synonym for Play Count", () => {
    expect(one("Plays=1").colId).toBe("playcount");
  });
});

describe("parseSearch — key sets across all four notations (reuse the key basis)", () => {
  it("single canonical-flats key", () => {
    expect(one("Key=Cm")).toEqual<KeysClause>({ colId: "key", kind: "keys", picked: ["Cm"] });
  });
  it("`Keys=A,B,C` is a SET, not a range", () => {
    expect(one("Keys=Cm,Gm,Dm")).toMatchObject({ picked: ["Cm", "Gm", "Dm"] });
  });
  it("accepts Camelot, Open Key, sharps, and is case-insensitive — all → canonical flats", () => {
    expect((one("Key=8A") as KeysClause).picked).toEqual(["Am"]); // Camelot 8A = Am
    expect((one("Key=5A") as KeysClause).picked).toEqual(["Cm"]); // Camelot 5A = Cm
    expect((one("Key=10m") as KeysClause).picked).toEqual(["Cm"]); // Open Key 10m = Cm
    expect((one("Key=C#m") as KeysClause).picked).toEqual(["Dbm"]); // sharps C#m = Dbm
    expect((one("key=cm") as KeysClause).picked).toEqual(["Cm"]); // lower-case
    expect((one("Keys=8A,cm") as KeysClause).picked).toEqual(["Am", "Cm"]); // mixed notations in a set
  });
  it("normalizeKey exposes the same mapping", () => {
    expect(normalizeKey("8A")).toBe("Am");
    expect(normalizeKey("F#m")).toBe("Gbm");
    expect(normalizeKey("Gbm")).toBe("Gbm");
    expect(normalizeKey("nope")).toBeNull();
  });
  it("a fully-unrecognized key value forms NO clause (falls through to literal)", () => {
    expect(clausesOf("Key=zz")).toEqual([]);
    expect(containsOf("Key=zz")).toBe("Key=zz");
  });
  it("keys ignore range/relative operators (only `=` is a set)", () => {
    expect(clausesOf("Key<Cm")).toEqual([]);
    expect(clausesOf("Key from Cm to Gm")).toEqual([]);
  });
});

describe("parseSearch — date columns: year equality + ranges", () => {
  it("`=YYYY` means the whole calendar year", () => {
    expect(one("Released=2023")).toEqual<DateClause>({
      colId: "release_date", kind: "date", min: "2023-01-01", max: "2023-12-31",
    });
  });
  it("`from YYYY to YYYY` spans whole years (order-insensitive)", () => {
    expect(one("Released from 2020 to 2023")).toMatchObject({ min: "2020-01-01", max: "2023-12-31" });
    expect(one("Released from 2023 to 2020")).toMatchObject({ min: "2020-01-01", max: "2023-12-31" });
  });
  it("Import / Last Played keywords map to their date columns", () => {
    expect(one("Imported=2020").colId).toBe("import_date");
    expect(one("Played=2024").colId).toBe("last_played");
  });
  it("a non-4-digit / non-year value forms NO clause (falls through to literal)", () => {
    expect(clausesOf("Released=21")).toEqual([]);
    expect(clausesOf("Released=abc")).toEqual([]);
    expect(clausesOf("Released>=nope")).toEqual([]);
    expect(containsOf("Released=abc")).toBe("Released=abc");
  });
});

describe("parseSearch — Release Date comparison operators (#74, YEAR-ONLY)", () => {
  it("`released>=YYYY` → release year ≥ YYYY (min Jan-1, open max)", () => {
    expect(one("Released>=2021")).toEqual<DateClause>({
      colId: "release_date", kind: "date", min: "2021-01-01", max: null,
    });
  });
  it("`released>YYYY` → release year ≥ YYYY+1", () => {
    expect(one("Released>2021")).toMatchObject({ min: "2022-01-01", max: null });
  });
  it("`released<=YYYY` → release year ≤ YYYY (max Dec-31, open min)", () => {
    expect(one("Released<=2021")).toMatchObject({ min: null, max: "2021-12-31" });
  });
  it("`released<YYYY` → release year ≤ YYYY−1", () => {
    expect(one("Released<2021")).toMatchObject({ min: null, max: "2020-12-31" });
  });
  it("operators also work on Import / Last Played (bare year → same ISO bounds)", () => {
    expect(one("Imported>=2019")).toMatchObject({ colId: "import_date", min: "2019-01-01", max: null });
    expect(one("Played<2022")).toMatchObject({ colId: "last_played", min: null, max: "2021-12-31" });
  });
  it("tolerates whitespace around the operator", () => {
    expect(one("Released >= 2021")).toMatchObject({ min: "2021-01-01", max: null });
  });
});

describe("parseSearch — Release Date DJ-style relative windows (#74, year-floored)", () => {
  const now = new Date(2026, 6, 8); // 2026-07-08 (month is 0-based)
  it("`released past N years` = current year + (N−1) prior years — YEAR-floored, not 365×N days", () => {
    expect(one("Released past 2 years", now)).toEqual<DateClause>({
      colId: "release_date", kind: "date", min: "2025-01-01", max: null,
    });
    expect(one("Released past 3 years", now)).toMatchObject({ min: "2024-01-01", max: null });
    expect(one("Released past 5 years", now)).toMatchObject({ min: "2022-01-01", max: null });
  });
  it("`released past year` = `released past 1 year` = current AND prior year (== past 2, intentionally non-algebraic)", () => {
    expect(one("Released past year", now)).toMatchObject({ min: "2025-01-01", max: null });
    expect(one("Released past 1 year", now)).toMatchObject({ min: "2025-01-01", max: null });
    // Same lower bound as `past 2 years`.
    expect((one("Released past 1 year", now) as DateClause).min).toBe(
      (one("Released past 2 years", now) as DateClause).min,
    );
  });
  it("`released this year` = the current year only", () => {
    expect(one("Released this year", now)).toEqual<DateClause>({
      colId: "release_date", kind: "date", min: "2026-01-01", max: null,
    });
  });
  it("the trailing `year`/`years` word is OPTIONAL on `released`", () => {
    expect(one("Released past 2", now)).toMatchObject({ min: "2025-01-01", max: null });
    expect(one("Released past 1", now)).toMatchObject({ min: "2025-01-01", max: null });
    expect(one("Released past 3", now)).toMatchObject({ min: "2024-01-01", max: null });
  });
  it("singular/plural `year`/`years` are equivalent", () => {
    expect(one("Released past 2 year", now)).toMatchObject({ min: "2025-01-01" });
    expect(one("Released past 2 years", now)).toMatchObject({ min: "2025-01-01" });
  });
  it("day/week/month units are nonsensical on year-only Release Date → literal fall-through", () => {
    expect(clausesOf("Released past 3 months", now)).toEqual([]);
    expect(clausesOf("Released past 30 days", now)).toEqual([]);
    expect(clausesOf("Released past 2 weeks", now)).toEqual([]);
    expect(containsOf("Released past 3 months")).toBe("Released past 3 months");
  });
});

describe("parseSearch — Import / Last Played keep DAY-precision windows (unchanged)", () => {
  const now = new Date(2026, 6, 8);
  it("`imported past N days/weeks/months/years` subtract calendar units from today", () => {
    expect(one("Imported past 30 days", now)).toMatchObject({ colId: "import_date", min: "2026-06-08", max: null });
    expect(one("Imported past 3 months", now)).toMatchObject({ min: "2026-04-08", max: null });
    expect(one("Imported past 3 years", now)).toMatchObject({ min: "2023-07-08", max: null });
  });
  it("`played past unit` with no N defaults to 1 (day precision)", () => {
    expect(one("Played past week", now)).toMatchObject({ colId: "last_played", min: "2026-07-01", max: null });
    expect(one("Played past month", now)).toMatchObject({ min: "2026-06-08", max: null });
    expect(one("Played past year", now)).toMatchObject({ min: "2025-07-08", max: null });
  });
  it("a bare `imported past N` (no unit) stays UNRECOGNIZED → literal", () => {
    expect(clausesOf("Imported past 2", now)).toEqual([]);
    expect(clausesOf("Played past 5", now)).toEqual([]);
    expect(containsOf("Imported past 2")).toBe("Imported past 2");
  });
  it("`imported this year` = current year onward (min Jan-1)", () => {
    expect(one("Imported this year", now)).toMatchObject({ colId: "import_date", min: "2026-01-01", max: null });
  });
});

describe("parseSearch — date grammar guards", () => {
  it("numeric keywords ignore `past` and `this year` (fall through)", () => {
    expect(clausesOf("BPM past 2 years")).toEqual([]);
    expect(clausesOf("BPM past 2")).toEqual([]);
    expect(clausesOf("BPM this year")).toEqual([]);
  });
  it("bare `past` (no N, no unit) never forms a clause", () => {
    expect(clausesOf("Released past")).toEqual([]);
    expect(clausesOf("Imported past")).toEqual([]);
  });
  it("`this` alone (without `year`) is not a phrase", () => {
    expect(clausesOf("Released this")).toEqual([]);
  });
});

describe("parseSearch — last-clause-wins for a repeated column", () => {
  it("same keyword twice → last wins, single clause", () => {
    const c = clausesOf("BPM=120 BPM=130");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ colId: "bpm", min: 130, max: 130 });
  });
  it("two ALIASES of the same column collapse (last wins)", () => {
    const c = clausesOf("Plays=1 Playcount=5");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ colId: "playcount", min: 5, max: 5 });
  });
  it("both matched spans are still removed from the contains text", () => {
    expect(containsOf("BPM=120 BPM=130")).toBe("");
  });
});

describe("parseSearch — graceful degradation (mid-typing / unknown → literal)", () => {
  it("unknown `word=value` stays literal contains text", () => {
    expect(clausesOf("Foo=1")).toEqual([]);
    expect(containsOf("Foo=1")).toBe("Foo=1");
  });
  it("progressive typing of a clause never throws and never yields a partial clause", () => {
    const steps = ["R", "Re", "Rel", "Released", "Released ", "Released p", "Released past", "Released past ", "Released past 2", "Released past 2 ", "Released past 2 year"];
    for (const s of steps) {
      expect(() => parseSearch(s)).not.toThrow();
    }
    // No clause until the phrase completes. For `released` the unit is optional
    // (#74 rule 5), so `Released past 2` already forms a year-floored clause;
    // bare `Released past` (no N, no unit) still does not.
    expect(clausesOf("Released past")).toEqual([]);
    expect(clausesOf("Released past 2")).toHaveLength(1);
    expect(clausesOf("Released past 2 year")).toHaveLength(1);
  });
  it("incomplete operator clauses (`BPM`, `BPM=`, `Key=`) are literal, not clauses", () => {
    expect(clausesOf("BPM")).toEqual([]);
    expect(clausesOf("BPM=")).toEqual([]);
    expect(clausesOf("Key=")).toEqual([]);
    expect(containsOf("BPM=")).toBe("BPM="); // raw unchanged → the grid never blanks
  });
  it("a keyword with a non-numeric value is literal (not a broken clause)", () => {
    expect(clausesOf("BPM=abc")).toEqual([]);
    expect(containsOf("BPM=abc")).toBe("BPM=abc");
  });
  it("keyword substrings inside words do not trigger (word boundary)", () => {
    expect(clausesOf("superstar")).toEqual([]);
    expect(clausesOf("keyed=1")).toEqual([]);
  });
});

describe("parseSearch — mixed clauses + plain text (all AND-ed)", () => {
  it("extracts clauses and leaves the free text as contains", () => {
    const r = parseSearch("deadmau5 BPM=128 Key=Am");
    expect(r.contains).toBe("deadmau5");
    expect(r.clauses).toHaveLength(2);
    expect(r.clauses.map((c) => c.colId).sort()).toEqual(["bpm", "key"]);
  });
  it("clauses may appear before/around the free text", () => {
    expect(parseSearch("Key=Am,Em BPM=120,128 deadmau5").contains).toBe("deadmau5");
  });
  it("plain text with no keyword passes through unchanged (#15 parity)", () => {
    expect(parseSearch("the beatles").contains).toBe("the beatles");
    expect(parseSearch("the beatles").clauses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EQUIVALENCE — a parsed clause filters identically to the manual filter.
// Fixture shaped like GET /api/matrix (dates "YYYY/M/D", keys canonical flats).
// ---------------------------------------------------------------------------

function row(over: Partial<MatrixData["rows"][number]>): MatrixData["rows"][number] {
  return {
    tk: over.tk ?? `tk-${Math.random()}`,
    name: "Track", artist: "Artist", album: "Album",
    bpm: 120, key: "Am",
    import_date: "2020/1/15", release_date: "2019/1/1", last_played: "",
    playcount: 3, root: 0, nonroot: 0,
    file_path: "C:\\music\\t.mp3", m: [],
    ...over,
  };
}

const DATA: MatrixData = {
  generated_at: "2026-07-06T12:00:00",
  playlists: [],
  rows: [
    row({ tk: "a", name: "Alpha", artist: "Kaskade", bpm: 120, key: "Gm", import_date: "2013/9/8", release_date: "2013/1/1", playcount: 0, root: 1 }),
    row({ tk: "b", name: "Bravo", artist: "Kaskade", bpm: 121.5, key: "Gm", import_date: "2017/7/25", release_date: "2017/6/1", playcount: 1, root: 1, nonroot: 1 }),
    row({ tk: "c", name: "Charlie", artist: "Metodi", bpm: 130, key: "Cm", import_date: "2011/11/5", release_date: "", playcount: 7, root: 1 }),
    row({ tk: "d", name: "Delta", artist: "Fabich", bpm: 119, key: "Gm", import_date: "2025/12/30", release_date: "2025/1/1", playcount: 2, root: 1 }),
    row({ tk: "e", name: "Echo", artist: "Roth", bpm: 120, key: "Ebm", import_date: "2020/11/22", release_date: "2020/6/15", playcount: 0, nonroot: 1 }),
    row({ tk: "f", name: "Foxtrot", artist: "", album: "", bpm: null, key: null, import_date: "", release_date: "", playcount: 0 }),
    row({ tk: "g", name: "Golf", artist: "Someone", bpm: 118, key: "Gmin", import_date: "2026/1/6", release_date: "1958/1/1", playcount: 4, root: 2 }),
  ],
};

const prep = prepareMatrix(DATA);
const NOTATION = "flats" as const;
const st = (over: Partial<MatrixFilterState>): MatrixFilterState => ({ ...emptyFilterState(), ...over });
const rows = (s: MatrixFilterState) => filterIndices(prep, s, NOTATION).map((i) => DATA.rows[i].tk);

// Mirror of searchQuery.pastMinIso for relative-date equivalence at "today".
function pastMinIso(n: number, unit: "day" | "week" | "month" | "year", now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (unit === "day") d.setDate(d.getDate() - n);
  else if (unit === "week") d.setDate(d.getDate() - 7 * n);
  else if (unit === "month") d.setMonth(d.getMonth() - n);
  else d.setFullYear(d.getFullYear() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("equivalence — clause ≡ manual column/drawer filter (same rows)", () => {
  it("BPM range: `=X,Y`, `from X to Y`, column filter, and drawer line all agree", () => {
    const expected = ["a", "b", "d", "e"]; // bpm in [119,121.5] inclusive → a(120) b(121.5) d(119) e(120)
    expect(rows(st({ search: "BPM=119,122" }))).toEqual(expected);
    expect(rows(st({ search: "BPM from 119 to 122" }))).toEqual(expected);
    expect(rows(st({ columns: { bpm: { min: 119, max: 122 } } }))).toEqual(expected);
    const d = st({});
    d.drawer.bpm = { on: true, min: 119, max: 122 };
    expect(rows(d)).toEqual(expected);
  });
  it("BPM exact `=120` ≡ column {min:120,max:120}", () => {
    expect(rows(st({ search: "BPM=120" }))).toEqual(rows(st({ columns: { bpm: { min: 120, max: 120 } } })));
    expect(rows(st({ search: "BPM=120" }))).toEqual(["a", "e"]);
  });
  it("Playcount `<=2` ≡ column {max:2}", () => {
    expect(rows(st({ search: "Playcount<=2" }))).toEqual(rows(st({ columns: { playcount: { max: 2 } } })));
  });
  it("Nonsuper `=0` ≡ column {min:0,max:0}", () => {
    expect(rows(st({ search: "Nonsuper=0" }))).toEqual(rows(st({ columns: { nonroot: { min: 0, max: 0 } } })));
  });
  it("Key set (Camelot notation) ≡ column picked (canonical flats)", () => {
    // Camelot 6A = Gm, 5A = Cm; picked matches RAW canonical keys.
    expect(rows(st({ search: "Keys=6A,5A" }))).toEqual(rows(st({ columns: { key: { picked: ["Gm", "Cm"] } } })));
    expect(rows(st({ search: "Keys=6A,5A" }))).toEqual(["a", "b", "c", "d"]);
  });
  it("Key set ≡ drawer keys line", () => {
    const d = st({});
    d.drawer.keys = { on: true, selected: ["Gm"] };
    expect(rows(st({ search: "Key=Gm" }))).toEqual(rows(d));
  });
  it("Date `=YYYY` ≡ release_date column {Jan1..Dec31} ≡ Release Year drawer line", () => {
    expect(rows(st({ search: "Released=2020" }))).toEqual(rows(st({ columns: { release_date: { min: "2020-01-01", max: "2020-12-31" } } })));
    const d = st({});
    d.drawer.releaseYear = { on: true, min: 2020, max: 2020 };
    expect(rows(st({ search: "Released=2020" }))).toEqual(rows(d));
    expect(rows(st({ search: "Released=2020" }))).toEqual(["e"]);
  });
  it("Date `from YYYY to YYYY` ≡ Release Year drawer range", () => {
    const d = st({});
    d.drawer.releaseYear = { on: true, min: 2017, max: 2025 };
    expect(rows(st({ search: "Released from 2017 to 2025" }))).toEqual(rows(d));
  });
  it("Release operator `>=YYYY` ≡ release_date column {min: Jan-1} (#74)", () => {
    // Release years: a=2013, b=2017, c=(none), d=2025, e=2020, f=(none), g=1958.
    expect(rows(st({ search: "Released>=2020" }))).toEqual(
      rows(st({ columns: { release_date: { min: "2020-01-01" } } })),
    );
    expect(rows(st({ search: "Released>=2020" }))).toEqual(["d", "e"]);
  });
  it("Release operators `>` / `<=` / `<` are year-only at the boundary (#74)", () => {
    expect(rows(st({ search: "Released>2020" }))).toEqual(["d"]); // year ≥ 2021
    expect(rows(st({ search: "Released<=2017" }))).toEqual(["a", "b", "g"]); // year ≤ 2017
    expect(rows(st({ search: "Released<2017" }))).toEqual(["a", "g"]); // year ≤ 2016
  });
  it("Release `>=YYYY` ≡ Release Year drawer {min}", () => {
    const d = st({});
    d.drawer.releaseYear = { on: true, min: 2020, max: null };
    expect(rows(st({ search: "Released>=2020" }))).toEqual(rows(d));
  });
  it("Release `this year` ≡ release_date column {min: Jan-1 of current year} (#74)", () => {
    const now = new Date();
    const jan1 = `${now.getFullYear()}-01-01`;
    expect(rows(st({ search: "Released this year" }))).toEqual(
      rows(st({ columns: { release_date: { min: jan1 } } })),
    );
  });
  it("Release `past N years` is year-floored ≡ release_date column {min: (curYear−(N−1))-01-01} (#74)", () => {
    const curYear = new Date().getFullYear();
    const min = `${curYear - 1}-01-01`; // past 2 → current + 1 prior year
    expect(rows(st({ search: "Released past 2 years" }))).toEqual(
      rows(st({ columns: { release_date: { min } } })),
    );
    // `past 2`, `past year`, and `past 1 year` all resolve to the same lower bound.
    expect(rows(st({ search: "Released past 2" }))).toEqual(rows(st({ search: "Released past 2 years" })));
    expect(rows(st({ search: "Released past year" }))).toEqual(rows(st({ search: "Released past 2 years" })));
  });
  it("Relative `Imported past N years` ≡ import_date column {min: today−N}", () => {
    // Both sides resolve against today; equivalence holds barring a midnight straddle.
    expect(rows(st({ search: "Imported past 3 years" }))).toEqual(
      rows(st({ columns: { import_date: { min: pastMinIso(3, "year") } } })),
    );
  });
  it("mixed clause+plaintext ≡ manual columns + plain #15 search", () => {
    expect(rows(st({ search: "Kaskade BPM>=120 Keys=Gm" }))).toEqual(
      rows(st({ search: "Kaskade", columns: { bpm: { min: 120 }, key: { picked: ["Gm"] } } })),
    );
    // Kaskade(a,b) ∧ bpm≥120 ∧ key=Gm → a(120,Gm) and b(121.5,Gm).
    expect(rows(st({ search: "Kaskade BPM>=120 Keys=Gm" }))).toEqual(["a", "b"]);
  });
});

describe("integration — search box behavior on the engine", () => {
  it("strict `<` excludes the boundary; `<=` includes it", () => {
    expect(rows(st({ search: "BPM<120" }))).toEqual(["d", "g"]); // 119, 118
    expect(rows(st({ search: "BPM<=120" }))).toEqual(["a", "d", "e", "g"]); // adds the 120s
  });
  it("blank-valued rows never pass a clause (matches the engine)", () => {
    // row f has null bpm; no BPM clause should ever include it.
    expect(rows(st({ search: "BPM>=0" }))).not.toContain("f");
  });
  it("removing a clause token widens the result (mixed AND)", () => {
    const narrow = rows(st({ search: "Kaskade BPM=120" }));
    const wide = rows(st({ search: "Kaskade" }));
    expect(narrow).toEqual(["a"]);
    expect(wide).toEqual(["a", "b"]);
  });
  it("unknown keyword behaves as the literal #15 search", () => {
    expect(rows(st({ search: "Foo=1" }))).toEqual(rows(st({ search: "Foo=1" })));
    expect(rows(st({ search: "Alpha" }))).toEqual(["a"]); // plain contains still works
  });
  it("last-wins holds end-to-end", () => {
    expect(rows(st({ search: "BPM=120 BPM=130" }))).toEqual(["c"]); // only 130
  });
});
