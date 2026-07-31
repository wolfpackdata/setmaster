/**
 * S2 Set Editor — column model (03-ui-design.md §5.2).
 *
 * Column order, exact SM2 labels, widths, alignment and editor kinds for the
 * transition-row grid, plus the grid-track layout (handle gutter, spacer
 * tracks between column groups, trailing derived Play Time / Mix Timer
 * columns) and the selection model shared by the grid and the toolbar.
 *
 * Formatting fills/boxes are anchored to these column ids (api-contract:
 * PUT /api/sets/{id}/formatting `col` strings) — do not rename them.
 */

import type { ValidationLists } from "../../lib/api";

export type ColId =
  | "bpm"
  | "key"
  | "out_name"
  | "out_delta"
  | "t_num"
  | "a_num"
  | "in_name"
  | "in_delta"
  | "m_num"
  | "lows"
  | "level"
  | "swap_lows"
  | "i_like"
  | "notes"
  | "start"
  | "transition";

export type ColumnGroup = "out" | "in" | "mix" | "timing" | null;
export type CellKind = "text" | "enum" | "typeahead" | "emoji" | "derived";
export type EnumSource = "delta" | "cue" | "lows" | "level";

export interface ColumnDef {
  id: ColId;
  /** Exact SM2 header label (`T #`, `M #`, `FX & Mix Notes`, …) — verbatim. */
  label: string;
  group: ColumnGroup;
  width: string;
  align: "left" | "center" | "right";
  kind: CellKind;
  enumSource?: EnumSource;
  /** tabular-nums numeric column (§3.2). */
  numeric?: boolean;
  /** §5.2 Out-Track timing hint shown on the M #/T # header tooltip. */
  timingTip?: string;
}

/**
 * §5.2 column table, in order. Widths follow the spec; Swap Lows is widened to
 * fit its uppercase label (60→64). The two Out-Track timing columns render as
 * `M #` / `T #` (issue #72, was `Start · M#` / `Transition · T#`) — the cue
 * suffix and per-header pink wash are gone, so their D-040 widths (74/100px)
 * shrink back to fit the short labels; the Out-Track signal now rides on the
 * OUT TRACK TIMING super-header (see `tracksFor`/`groupSpan`).
 */
export const COLUMNS: readonly ColumnDef[] = [
  // #134: sized to its content instead of a fixed 56px, which left the
  // right-aligned value floating in dead space. Three tabular digits measure a
  // consistent 1.95em across the whole 10–20px Font Size range (verified in the
  // app), and every one of the 398 BPM cells in the real SM2 workbook is two or
  // three digits with no decimals — so this is tight at every font size and
  // never clips a real value.
  //
  // #138 adds the direction arrow to the left of the value: 0.646em at its
  // 0.75em face, so the content budget is 1.95 + 0.65 = 2.6em. The +11px covers
  // the 4px-a-side padding (see `.se-cell[data-c="bpm"]`), the 2px arrow gap
  // and a pixel of slack. Because the cell is right-aligned the arrow occupies
  // the left slack, so the digits sit in the same place whether or not a row
  // has one — no layout shift.
  { id: "bpm", label: "BPM", group: null, width: "calc(var(--grid-font-size) * 2.6 + 11px)", align: "right", kind: "text", numeric: true },
  { id: "key", label: "Key", group: null, width: "48px", align: "center", kind: "text" },
  // #140 (second pass) — the two Name columns are FIXED, not flexible. They used
  // to be `minmax(150px, 1.1fr)`, which meant grid split any free space between
  // them and FX & Mix Notes: hiding the timing columns widened all three, so the
  // space went where it was not needed. Notes is now the grid's only flexible
  // track (see below), and every pixel freed by hiding lands there.
  //
  // 150px is deliberately the OLD MINIMUM, not a new number. The grid's
  // min-content is ~1438px at the default font, so at the 1440px primary target
  // — and at every narrower layout, including Ry's everyday sidebar-expanded
  // window — these columns were already pinned at 150px and the grid scrolled.
  // Holding them there changes nothing on screen today while handing the full
  // ~208px the timing group gives back straight to notes.
  //
  // The trade this makes: on a window wide enough to leave free space (~1700px+
  // with the sidebar expanded) the Name columns no longer grow into it. Measured
  // against the 501 non-empty In Track names in the production set store — p50 =
  // 16, p75 = 21, p90 = 26 characters — 150px truncates a majority of names at
  // any width. That is the accepted cost of Ry's instruction that notes be the
  // only column that grows: notes runs p50 = 36 / p90 = 72 characters, twice as
  // long, and it is the column the #135 hover tooltip exists for.
  { id: "out_name", label: "Name", group: "out", width: "150px", align: "left", kind: "derived" },
  { id: "out_delta", label: "Δ", group: "out", width: "48px", align: "right", kind: "derived", numeric: true },
  { id: "t_num", label: "T #", group: "out", width: "44px", align: "center", kind: "enum", enumSource: "cue" },
  { id: "a_num", label: "A #", group: "out", width: "44px", align: "center", kind: "enum", enumSource: "cue" },
  { id: "in_name", label: "Name", group: "in", width: "150px", align: "left", kind: "typeahead" },
  { id: "in_delta", label: "Δ", group: "in", width: "48px", align: "right", kind: "enum", enumSource: "delta", numeric: true },
  { id: "m_num", label: "M #", group: "in", width: "44px", align: "center", kind: "enum", enumSource: "cue" },
  { id: "lows", label: "Lows", group: "mix", width: "72px", align: "center", kind: "enum", enumSource: "lows" },
  { id: "level", label: "Level", group: "mix", width: "72px", align: "center", kind: "enum", enumSource: "level" },
  { id: "swap_lows", label: "Swap Lows", group: "mix", width: "64px", align: "center", kind: "enum", enumSource: "cue" },
  { id: "i_like", label: "I like", group: null, width: "44px", align: "center", kind: "emoji" },
  // #140 (second pass) — THE ONLY FLEXIBLE TRACK IN THE GRID. Every other column
  // is a fixed width, so all free space — including everything the OUT TRACK
  // TIMING / MIX TIMER columns give back when hidden — expands FX & Mix Notes to
  // the right. That is the point of hiding them: notes is the column whose
  // content is routinely truncated (p50 = 36, p90 = 72 characters against names'
  // 16 / 26), which is why it is also the one column with a #135 hover tooltip.
  //
  // The `1fr` factor is arbitrary now that nothing competes with it; the 200px
  // floor is what keeps the column readable when the grid overflows instead.
  { id: "notes", label: "FX & Mix Notes", group: null, width: "minmax(200px, 1fr)", align: "left", kind: "text" },
  {
    id: "start", label: "M #", group: "timing", width: "60px", align: "right", kind: "text", numeric: true,
    timingTip: "M:SS — real-time location of the Out Track's M# cue (its mix-in cue, set a row above where that track was the In Track).",
  },
  {
    id: "transition", label: "T #", group: "timing", width: "60px", align: "right", kind: "text", numeric: true,
    timingTip: "M:SS — real-time location of the Out Track's T# cue (its transition-out cue, on this line).",
  },
];

/** Navigable/formattable column ids, grid order (= SM2 cols B..R). */
export const NAV_COLS: readonly ColId[] = COLUMNS.map((c) => c.id);

export const COLUMN_BY_ID: ReadonlyMap<ColId, ColumnDef> = new Map(
  COLUMNS.map((c) => [c.id, c]),
);

export const COL_INDEX: ReadonlyMap<ColId, number> = new Map(
  NAV_COLS.map((c, i) => [c, i]),
);

// ---------------------------------------------------------------------------
// Enum option lists
// ---------------------------------------------------------------------------

/** Fixed cue list (§5.2 — cue lists are NOT user-editable). */
export const CUE_OPTIONS: readonly string[] = [
  "---", "#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8",
];

export const EMPTY_ENUM = "---";

/**
 * Factory fallback lists (prototype `load` tab) — used only until
 * GET /api/validation-lists responds; the backend lists are authoritative.
 */
export const FACTORY_LISTS: ValidationLists = {
  // #163 — the narrow factory range in daily use, -1.5 … +1.5 in 0.5 steps, NOT
  // the full [-12, +12] a user may add within (that is the backend constraint,
  // `canonical_delta`, not the default). `0` is a member — the interval contains
  // it, and it was the value tripping the ◦ legacy marker that started #163.
  // `---` is the system placeholder and is never a stored list member.
  delta: ["---", "-1.5", "-1", "-0.5", "0", "+0.5", "+1", "+1.5"],
  lows: ["cut", "cut-swell", "open", "0.5"],
  level: ["silence", "open", "HOT", "HOT-LP", "LP", "HP", "LP-silence", "HP-silence"],
  i_like: ["⚠️", "✔️", "🚀", "💜", "🟥"],
};

export interface EnumOptions {
  /** Dropdown options in list order, `---` placeholder first. */
  options: string[];
  /** Value stored when the user picks `---` (clears the cell). */
  clearsTo: string;
}

const NATURAL_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "variant",
});

const SIGNED_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;

/** The value as a signed number, or null when it is not purely numeric. */
function signedNumber(value: string): number | null {
  const t = value.trim();
  return SIGNED_NUMBER.test(t) ? Number(t) : null;
}

/**
 * Natural / numeric-aware ordering for validation-list values (#141).
 *
 * - Purely numeric values sort by SIGNED VALUE, so pitch shifts read
 *   `-2 < -1 < +1 < +2` rather than lexically (where `-` is just punctuation
 *   and `+1` would sort beside `+0.5`).
 * - Everything else goes through a numeric-aware collator, so embedded numbers
 *   sort `#1, #2 … #10` instead of `#1, #10, #2`, and pure text is
 *   alphabetical.
 * - In a mixed list, numbers come before text.
 */
export function naturalCompare(a: string, b: string): number {
  const na = signedNumber(a);
  const nb = signedNumber(b);
  if (na !== null && nb !== null) {
    return na === nb ? NATURAL_COLLATOR.compare(a, b) : na - nb;
  }
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return NATURAL_COLLATOR.compare(a, b);
}

/**
 * Dropdown options for an enum column, with the `---` placeholder pinned first
 * and the values in NATURAL order (#141).
 *
 * Sorting happens here, at render time, and never touches the stored config:
 * user-data-never-lost applies to settings too, and a display-only sort is
 * trivially reversible. Settings → Advanced still shows and manages the list in
 * its stored order.
 *
 * This intentionally diverges from `advanced-settings-validation-lists.md`
 * ("list order = dropdown order") for the set-page dropdowns — see #141.
 *
 * Δ and cue columns store `"---"` (their data-model default); Lows/Level store
 * `""` when cleared (SM2 cells were blank).
 */
export function enumOptions(
  source: EnumSource,
  lists: ValidationLists,
): EnumOptions {
  const sorted = (values: readonly string[]): string[] => [
    EMPTY_ENUM,
    ...values.filter((v) => v !== EMPTY_ENUM).sort(naturalCompare),
  ];
  switch (source) {
    case "cue":
      return { options: sorted(CUE_OPTIONS), clearsTo: EMPTY_ENUM };
    case "delta":
      return { options: sorted(lists.delta), clearsTo: EMPTY_ENUM };
    case "lows":
      return { options: sorted(lists.lows), clearsTo: "" };
    case "level":
      return { options: sorted(lists.level), clearsTo: "" };
  }
}

/** Raw value stored when `option` is picked from `source`'s dropdown. */
export function committedEnumValue(source: EnumSource, option: string): string {
  if (option === EMPTY_ENUM) return enumOptions(source, FACTORY_LISTS).clearsTo;
  return option;
}

/** Value a cell takes when cleared via Delete/Backspace. */
export function clearedValue(col: ColId): string {
  switch (col) {
    case "in_delta":
    case "m_num":
    case "t_num":
    case "a_num":
    case "swap_lows":
      return EMPTY_ENUM;
    default:
      return "";
  }
}

/**
 * True when a LEVEL value should render in the brand magenta (#136).
 *
 * SM2 highlighted the exact value `HOT`; SM3 matches any value CONTAINING it,
 * case-insensitively, so `HOT-LP` and `hot-lp` colour too. Deliberately a
 * substring test rather than a list membership test: a legacy value dropped
 * from the validation list still reads as hot to the user, so it still colours.
 */
export function isHotLevel(value: string): boolean {
  return value.toLowerCase().includes("hot");
}

/**
 * True when a non-empty enum cell value is a legacy value — present in the
 * cell but no longer offered by its list (§4.4 Remove semantics). Renders
 * as-is with a subtle tooltip marker.
 */
export function isLegacyEnumValue(
  source: EnumSource,
  value: string,
  lists: ValidationLists,
): boolean {
  if (!value || value === EMPTY_ENUM) return false;
  return !enumOptions(source, lists).options.includes(value);
}

// ---------------------------------------------------------------------------
// Grid track layout (handle gutter + group spacers + derived calc columns)
// ---------------------------------------------------------------------------

export type CalcId = "mins" | "mixlen";

export interface GridTrack {
  kind: "handle" | "spacer" | "col" | "calc";
  width: string;
  col?: ColumnDef;
  calc?: CalcId;
}

/**
 * Anything the grid can hide. The two derived columns (PLAY TIME, MIX TIMER)
 * are `calc` tracks rather than real `ColId`s, but #140 lets the user hide them
 * too — so one hidden set covers both kinds and there is exactly ONE hiding
 * mechanism to reason about.
 */
export type HideId = ColId | CalcId;

const SPACER_WIDTH = "12px";

const NO_HIDDEN: ReadonlySet<HideId> = new Set();

/**
 * The three columns under the OUT TRACK TIMING super-header (#140): the two
 * stored cue-time columns plus the derived PLAY TIME calc track.
 */
export const TIMING_TRACK_IDS: readonly HideId[] = ["start", "transition", "mins"];

/**
 * Grid tracks for the current column visibility. §8: at 1024–1439px the
 * M # / T # (ex Start/Transition) / A # columns hide behind a column-overflow
 * menu; #140 additionally lets the user hide the OUT TRACK TIMING group and the
 * MIX TIMER column outright. Either way the screen passes one hidden set and
 * the layout is rebuilt from it.
 */
export function tracksFor(hidden: ReadonlySet<HideId> = NO_HIDDEN): GridTrack[] {
  const tracks: GridTrack[] = [{ kind: "handle", width: "26px" }];
  let prevGroup: ColumnGroup = null;
  let first = true;
  for (const col of COLUMNS) {
    if (hidden.has(col.id)) continue;
    if (!first && col.group !== prevGroup) {
      tracks.push({ kind: "spacer", width: SPACER_WIDTH });
    }
    tracks.push({ kind: "col", width: col.width, col });
    prevGroup = col.group;
    first = false;
  }
  // Derived SM2 column S — PLAY TIME (ex Mins Calc), the third OUT TRACK TIMING
  // member (issue #72): contiguous with the `timing`-group M #/T # columns, so
  // no spacer precedes it unless those columns are hidden (narrow), where it
  // stands alone after the notes column behind its own spacer.
  if (!hidden.has("mins")) {
    if (prevGroup !== "timing") {
      tracks.push({ kind: "spacer", width: SPACER_WIDTH });
    }
    tracks.push({ kind: "calc", width: "76px", calc: "mins" });
    prevGroup = "timing";
  }
  // Derived SM2 column T — MIX TIMER (ex Mix Length), the running total; stays
  // OUTSIDE the OUT TRACK TIMING group, so a spacer separates it.
  if (!hidden.has("mixlen")) {
    tracks.push({ kind: "spacer", width: SPACER_WIDTH });
    tracks.push({ kind: "calc", width: "80px", calc: "mixlen" });
  }
  return tracks;
}

export const TRACKS: readonly GridTrack[] = tracksFor();

export const gridTemplateFor = (tracks: readonly GridTrack[]): string =>
  tracks.map((t) => t.width).join(" ");

export const GRID_TEMPLATE = gridTemplateFor(TRACKS);

/**
 * 1-based CSS grid line span for a tinted column-group header. The `timing`
 * group (OUT TRACK TIMING, issue #72) additionally covers the derived PLAY TIME
 * (mins) calc track, so its super-header spans M # / T # / PLAY TIME; when the
 * M #/T # columns are hidden (narrow) it spans whichever remain — down to PLAY
 * TIME alone, which is never hidden.
 */
export function groupSpan(
  group: "out" | "in" | "timing",
  tracks: readonly GridTrack[] = TRACKS,
): { start: number; end: number } {
  let start = -1;
  let end = -1;
  tracks.forEach((t, i) => {
    const inGroup =
      (t.kind === "col" && t.col?.group === group) ||
      (group === "timing" && t.kind === "calc" && t.calc === "mins");
    if (inGroup) {
      if (start === -1) start = i + 1;
      end = i + 2;
    }
  });
  return { start, end };
}

/** Keyboard-navigable column ids in grid order, hidden columns skipped. */
export function navColsFor(hidden: ReadonlySet<HideId>): ColId[] {
  return NAV_COLS.filter((c) => !hidden.has(c));
}

// ---------------------------------------------------------------------------
// Selection model (single cell, rectangular range, full rows — §5.2)
// ---------------------------------------------------------------------------

export interface CellPos {
  row: number;
  col: ColId;
}

export interface Selection {
  anchor: CellPos;
  focus: CellPos;
  /** Full-row selection (handle click / row context) — spans all 16 cols. */
  fullRow: boolean;
}

export function selectionRowSpan(sel: Selection): { start: number; end: number } {
  return {
    start: Math.min(sel.anchor.row, sel.focus.row),
    end: Math.max(sel.anchor.row, sel.focus.row),
  };
}

export function selectionColSpan(sel: Selection): { start: number; end: number } {
  if (sel.fullRow) return { start: 0, end: NAV_COLS.length - 1 };
  const a = COL_INDEX.get(sel.anchor.col) ?? 0;
  const f = COL_INDEX.get(sel.focus.col) ?? 0;
  return { start: Math.min(a, f), end: Math.max(a, f) };
}

/** Selected column ids in grid order. */
export function selectionCols(sel: Selection): ColId[] {
  const { start, end } = selectionColSpan(sel);
  return NAV_COLS.slice(start, end + 1) as ColId[];
}

// ---------------------------------------------------------------------------
// OUT TRACK TIMING behavior (issue #83)
// ---------------------------------------------------------------------------

/**
 * Row 1's Out-side cells that are read-only. Row 1 has no Out Track — nothing
 * mixes out into it — so these describe a track that does not exist.
 *
 * `start` / `transition` (OUT TRACK TIMING) came first, in #83. `bpm` / `key`
 * joined them in #165: they belong to the same side, stored ON the row while
 * describing the track one row EARLIER (the offset-by-one #133 untangled), so on
 * row 1 they were freely typable cells whose value could never mean anything.
 *
 * `t_num` / `a_num` are also Out-side and also meaningless on row 1, but stay
 * editable — #165 asked for BPM and Key specifically. Flagged there rather than
 * widened unasked.
 */
const ROW1_READONLY_COLS: readonly ColId[] = ["bpm", "key", "start", "transition"];

/**
 * True for a read-only row-1 Out-side cell (#83, widened by #165). Editability
 * follows row POSITION, not identity — reordering a row into/out of position 0
 * changes this. Read-only cells stay selectable (keyboard-nav continuity) and
 * any legacy value stays clearable (Delete/Backspace), just not typable.
 */
export function isReadonlyOutSideCell(rowIndex: number, col: ColId): boolean {
  return rowIndex === 0 && ROW1_READONLY_COLS.includes(col);
}

/**
 * Render-time cue-cell highlight target for the OUT TRACK TIMING pointer (#83)
 * — a pure function of the current selection. Active ONLY when a timing cell is
 * the SINGLE selected cell (anchor === focus, not a full-row selection), which
 * also covers the editing case since opening an editor single-selects its cell.
 * Range / full-row selections return null (they never trigger the highlight).
 *
 * - Timing `start` (M #) on row N → IN TRACK `m_num` on row N−1: the Out
 *   Track's mix-in cue, set a row above where that track was the In Track.
 * - Timing `transition` (T #) on row N → OUT TRACK `t_num` on the same row N.
 * - Row 0 → null: its timing cells are read-only (above) and point nowhere
 *   (`start` has no row above; `transition` must not highlight either).
 *
 * The target may hold `---` (that's exactly when the pointer helps) and needs
 * no hidden-column guard here: the grid only renders visible columns, so a
 * hidden target simply never receives the class.
 */
export function timingCueHighlight(sel: Selection | null): CellPos | null {
  if (!sel || sel.fullRow) return null;
  if (sel.anchor.row !== sel.focus.row || sel.anchor.col !== sel.focus.col) {
    return null;
  }
  const { row, col } = sel.focus;
  if (row === 0) return null;
  if (col === "start") return { row: row - 1, col: "m_num" };
  if (col === "transition") return { row, col: "t_num" };
  return null;
}
