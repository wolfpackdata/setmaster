/**
 * "My Playlists" selector logic (issue #13). Proves the ONE-SHOT auto-clear
 * contract from the issue's numbered cases (esp. 3 and 5) via a tiny session
 * simulator that mirrors exactly what MyPlaylistsMenu does on each event, plus
 * direct unit tests of the pure helpers.
 */

import { describe, expect, it } from "vitest";
import type { MatrixPlaylist } from "../../lib/api";
import {
  allShownFor,
  filterPlaylistsByName,
  playlistsContainingVisible,
  shouldAutoClear,
  shownCountFor,
  sortShownFirst,
} from "./myPlaylistsLogic";

const PL = (path: string, name: string): MatrixPlaylist => ({
  path,
  name,
  is_root: false,
});

const CATALOG: MatrixPlaylist[] = [
  PL("$/disco", "Disco Cosmic"),
  PL("$/house", "House Deep"),
  PL("$/techno", "Techno Drive"),
  PL("$/ambient", "Ambient Wash"),
];
const PATHS = CATALOG.map((p) => p.path);

/**
 * Session simulator — the exact model the component runs. `type` applies the
 * one-shot rule (hide-all on the qualifying first keystroke) then records the
 * new query; check/uncheck/showAll/hideAll mutate the hidden set as the store
 * actions would.
 */
function session() {
  let hidden = new Set<string>();
  let query = "";
  return {
    type(next: string) {
      if (shouldAutoClear(query, next, allShownFor(PATHS, hidden))) {
        hidden = new Set(PATHS);
      }
      query = next;
    },
    check(path: string) {
      hidden.delete(path);
    },
    uncheck(path: string) {
      hidden.add(path);
    },
    showAll() {
      hidden = new Set();
    },
    hideAll() {
      hidden = new Set(PATHS);
    },
    shown(): string[] {
      return PATHS.filter((p) => !hidden.has(p));
    },
    get query() {
      return query;
    },
  };
}

describe("shouldAutoClear — the one-shot predicate", () => {
  it("fires only on empty→non-empty while all shown", () => {
    expect(shouldAutoClear("", "d", true)).toBe(true);
    expect(shouldAutoClear("", "d", false)).toBe(false); // not all shown
    expect(shouldAutoClear("d", "di", true)).toBe(false); // not the first key
    expect(shouldAutoClear("d", "", true)).toBe(false); // clearing, not typing
    expect(shouldAutoClear("", "", true)).toBe(false); // no change
  });
});

describe("issue #13 numbered cases", () => {
  it("case 1 — narrow from default: first keystroke clears, then one checked", () => {
    const m = session();
    expect(m.shown().length).toBe(4); // all shown
    m.type("disco"); // first keystroke → auto-clear
    expect(m.shown().length).toBe(0);
    m.check("$/disco"); // check the found result
    m.type(""); // clear the search box
    expect(m.shown()).toEqual(["$/disco"]); // exactly that one shown
  });

  it("case 2 — accumulate from a partial selection (no auto-clear)", () => {
    const m = session();
    m.hideAll();
    m.check("$/disco"); // start with 1 shown
    m.type("house"); // partial selection → NO clear
    expect(m.shown()).toEqual(["$/disco"]); // first stays
    m.check("$/house");
    m.type("techno");
    m.check("$/techno");
    expect(m.shown().sort()).toEqual(["$/disco", "$/house", "$/techno"].sort());
  });

  it("case 3 — no re-clear mid-build: retype/backspace never wipes again", () => {
    const m = session();
    m.type("disco"); // auto-clear (was all shown)
    m.check("$/disco"); // build a selection
    m.type("dis"); // edit query — must NOT re-clear
    m.type(""); // backspace to empty
    m.type("house"); // type again — still must NOT re-clear (not all shown)
    expect(m.shown()).toEqual(["$/disco"]); // selection preserved throughout
  });

  it("case 4 — Hide all then search: accumulation, no auto-clear", () => {
    const m = session();
    m.hideAll();
    m.type("disco"); // not starting from all-shown → no clear
    m.check("$/disco");
    expect(m.shown()).toEqual(["$/disco"]);
  });

  it("case 5 — Show all re-arms the shortcut; next search auto-clears again", () => {
    const m = session();
    m.type("disco"); // first auto-clear
    m.check("$/disco");
    m.type(""); // clear search → 1 shown
    m.showAll(); // back to all-shown (re-arm)
    expect(m.shown().length).toBe(4);
    m.type("techno"); // fires again
    expect(m.shown().length).toBe(0);
    m.check("$/techno");
    m.type("");
    expect(m.shown()).toEqual(["$/techno"]);
  });

  it("case 6 — no-match search preserves selection and yields an empty list", () => {
    const m = session();
    m.hideAll();
    m.check("$/disco");
    m.type("zzz-nothing");
    expect(filterPlaylistsByName(CATALOG, "zzz-nothing")).toEqual([]);
    m.type(""); // clearing restores selection intact
    expect(m.shown()).toEqual(["$/disco"]);
  });
});

describe("filterPlaylistsByName — case-insensitive substring on name", () => {
  it("matches by name, not path; empty query returns the full set", () => {
    expect(filterPlaylistsByName(CATALOG, "deep").map((p) => p.name)).toEqual([
      "House Deep",
    ]);
    expect(filterPlaylistsByName(CATALOG, "DISCO").map((p) => p.name)).toEqual([
      "Disco Cosmic",
    ]);
    expect(filterPlaylistsByName(CATALOG, "  ").length).toBe(CATALOG.length);
    // Path fragments must not match (identity is path, display/search is name).
    expect(filterPlaylistsByName(CATALOG, "$/").length).toBe(0);
  });
});

describe("sortShownFirst — shown pinned on top (#13 followup)", () => {
  it("stable partition: shown first, hidden after, alphabetical kept within each group", () => {
    const hidden = new Set(["$/disco", "$/techno"]);
    expect(sortShownFirst(CATALOG, hidden).map((p) => p.path)).toEqual([
      "$/house",
      "$/ambient", // shown, incoming order preserved
      "$/disco",
      "$/techno", // hidden, incoming order preserved
    ]);
  });

  it("all shown or all hidden leaves the incoming order untouched", () => {
    expect(sortShownFirst(CATALOG, new Set())).toEqual(CATALOG);
    expect(sortShownFirst(CATALOG, new Set(PATHS))).toEqual(CATALOG);
  });

  it("search filtering after the sort keeps shown-first order among matches", () => {
    const hidden = new Set(["$/disco"]);
    // "o" matches Disco Cosmic (hidden), House Deep and Techno Drive (shown).
    const ordered = sortShownFirst(CATALOG, hidden);
    expect(filterPlaylistsByName(ordered, "o").map((p) => p.name)).toEqual([
      "House Deep",
      "Techno Drive",
      "Disco Cosmic",
    ]);
  });
});

describe("allShownFor / shownCountFor", () => {
  it("track the shown subset for the N of M count line", () => {
    expect(allShownFor(PATHS, new Set())).toBe(true);
    expect(shownCountFor(PATHS, new Set())).toBe(4);
    const hidden = new Set(["$/house", "$/techno"]);
    expect(allShownFor(PATHS, hidden)).toBe(false);
    expect(shownCountFor(PATHS, hidden)).toBe(2);
  });
});

describe("playlistsContainingVisible — #79 set-union over visible rows", () => {
  // Rows carry membership as playlist indices into CATALOG:
  //   row 0 → disco(0), house(1); row 1 → techno(2); row 2 → (none);
  //   row 3 → house(1), ambient(3).
  const ROWS = [
    { member: new Set([0, 1]) },
    { member: new Set([2]) },
    { member: new Set<number>() },
    { member: new Set([1, 3]) },
  ];

  it("unions memberships of the visible rows into playlist PATHS", () => {
    // Visible = rows 0 and 1 → disco, house (from 0) + techno (from 1).
    expect([...playlistsContainingVisible([0, 1], ROWS, CATALOG)].sort()).toEqual(
      ["$/disco", "$/house", "$/techno"].sort(),
    );
  });

  it("dedupes a playlist shared by multiple visible rows", () => {
    // Rows 0 and 3 both include house(1) — it appears once.
    expect([...playlistsContainingVisible([0, 3], ROWS, CATALOG)].sort()).toEqual(
      ["$/ambient", "$/disco", "$/house"].sort(),
    );
  });

  it("zero visible rows → empty set (caller hides everything, 'show none')", () => {
    expect(playlistsContainingVisible([], ROWS, CATALOG).size).toBe(0);
  });

  it("visible rows that touch no playlist → empty set", () => {
    expect(playlistsContainingVisible([2], ROWS, CATALOG).size).toBe(0);
  });

  it("ignores out-of-range indices defensively (no throw)", () => {
    expect(playlistsContainingVisible([99], ROWS, CATALOG).size).toBe(0);
  });
});
