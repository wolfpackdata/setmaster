/**
 * "My Playlists" selector pure logic (issue #13) — kept out of the .tsx so it
 * is unit-testable in vitest's node env without React. The subtle piece is the
 * ONE-SHOT auto-clear: starting from the all-shown default, the user's first
 * search keystroke means "let me narrow down", so we clear the selection to
 * none exactly once; from any hand-picked subset, search means "help me find
 * one more to add", so we preserve what they have.
 */

import type { MatrixPlaylist } from "../../lib/api";

/**
 * Should the first-search auto-clear (hide all) fire on this search-box edit?
 *
 * TRUE iff the box just went from empty to non-empty (the first keystroke of a
 * search) AND every playlist is currently shown (the default state). Because
 * firing immediately makes `allShown` false, it cannot re-fire on later
 * keystrokes, nor after the user has begun building a subset (case 3) — it only
 * re-arms once the full set is shown again, e.g. via Show all (case 5). A
 * partial selection (case 2) never triggers it. Hide-all-then-search (case 4)
 * never triggers it. This is the whole one-shot contract in one predicate.
 */
export function shouldAutoClear(
  prevQuery: string,
  nextQuery: string,
  allShown: boolean,
): boolean {
  return prevQuery === "" && nextQuery !== "" && allShown;
}

/** Case-insensitive substring filter over `playlist_name` (issue #13 search). */
export function filterPlaylistsByName(
  playlists: readonly MatrixPlaylist[],
  query: string,
): MatrixPlaylist[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...playlists];
  return playlists.filter((p) => p.name.toLowerCase().includes(q));
}

/**
 * Order the list with SHOWN (checked) playlists first (#13 followup): stable
 * partition, so within each group the incoming alphabetical order is kept.
 * The menu calls this with the hidden set SNAPSHOTTED at open — pinning is an
 * open-time ordering, not a live re-sort, so rows don't jump under the cursor
 * while the user is clicking checkboxes.
 */
export function sortShownFirst(
  playlists: readonly MatrixPlaylist[],
  hidden: ReadonlySet<string>,
): MatrixPlaylist[] {
  const shown: MatrixPlaylist[] = [];
  const hid: MatrixPlaylist[] = [];
  for (const p of playlists) (hidden.has(p.path) ? hid : shown).push(p);
  return [...shown, ...hid];
}

/** Are all of `paths` shown (none in the hidden set)? Drives the count + arm. */
export function allShownFor(
  paths: readonly string[],
  hidden: ReadonlySet<string>,
): boolean {
  return paths.every((p) => !hidden.has(p));
}

/** Count of shown playlists among `paths` (for the "N of M" count line). */
export function shownCountFor(
  paths: readonly string[],
  hidden: ReadonlySet<string>,
): number {
  let n = 0;
  for (const p of paths) if (!hidden.has(p)) n++;
  return n;
}

/** A row's playlist membership: the set of playlist indices it appears on. */
interface HasMember {
  member: ReadonlySet<number>;
}
/** A playlist reference: identity is its path. */
interface HasPath {
  path: string;
}

/**
 * "Show Playlists Containing These Tracks" (issue #79) — the set-union core.
 * Returns the set of playlist PATHS containing at least one track among the
 * VISIBLE (filtered) rows: union each visible row's membership (playlist
 * indices into `playlists`), then map those indices to paths. No name matching
 * — this is the matrix's own track↔playlist membership (the cell data).
 *
 * Zero visible rows, or visible rows that touch no playlist, yield the EMPTY
 * set; the caller then hides every playlist ("show none"). One-shot: reads the
 * `visible` snapshot passed at click time, computes nothing live. Pure (no
 * React / no store) so it is unit-testable in vitest's node env.
 */
export function playlistsContainingVisible(
  visible: readonly number[],
  rows: readonly HasMember[],
  playlists: readonly HasPath[],
): Set<string> {
  const paths = new Set<string>();
  for (const i of visible) {
    const row = rows[i];
    if (!row) continue;
    for (const idx of row.member) {
      const pl = playlists[idx];
      if (pl) paths.add(pl.path);
    }
  }
  return paths;
}
