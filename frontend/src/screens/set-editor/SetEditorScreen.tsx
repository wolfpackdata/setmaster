/**
 * S2 — Set Editor (03-ui-design.md §5.2, §6.1, §6.4, §6.5; data model §4.1–4.4).
 *
 * Spreadsheet-style inline grid over transition rows: NO gridlines or cell
 * borders — striping, tabular-nums, group spacing and the magenta/cyan
 * Out/In group headers carry the structure. Stores In-side only (Out derived
 * from the previous row), full keyboard model, RED/YELLOW/Box/Clear
 * formatting, drag + Alt+↑/↓ reorder, per-set session undo, debounced
 * autosave (PUT rows / PUT formatting) with the §7.3 saving indicator.
 *
 * Logged interpretation (per CLAUDE.md "smallest faithful-to-SM2"): SM2's
 * template had ~981 pre-made rows, so Enter simply moved down. SM3 rows are
 * created on demand — committing with Enter (commit+down) on the LAST row
 * appends the next empty row when the committed row has content, so rows
 * "append naturally while editing" without growing on idle Enter presses.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getSet,
  getValidationLists,
  putSetFormatting,
  putSetRows,
  type FillColor,
  type KeyDisplayAs,
  type SetRow,
  type ValidationLists,
} from "../../lib/api";
import { useSettingsStore } from "../../store/settingsStore";
import { useSetsStore } from "../../store/setsStore";
import { useUiStore } from "../../store/uiStore";
import { Button } from "../../components/Button";
import { Toggle } from "../../components/Toggle";
import { Stepper } from "../../components/Stepper";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ContextMenu } from "../../components/ContextMenu";
import {
  COLUMN_BY_ID,
  COL_INDEX,
  NAV_COLS,
  FACTORY_LISTS,
  clearedValue,
  committedEnumValue,
  gridTemplateFor,
  groupSpan,
  isReadonlyOutSideCell,
  navColsFor,
  selectionCols,
  selectionRowSpan,
  timingCueHighlight,
  tracksFor,
  TIMING_TRACK_IDS,
  type CellPos,
  type ColId,
  type HideId,
  type ColumnDef,
  type GridTrack,
  type Selection,
} from "./columns";
import {
  MOVE_INFO_STEPS,
  MOVE_INFO_TIP,
  MOVE_INFO_TITLE,
  type MoveInfoSegment,
} from "./moveInfo";
import {
  computeStats,
  computeTiming,
  deriveOuts,
  fmtBpmStat,
  fmtHMM,
  fmtMinutes1,
  hasIncompleteTiming,
  makeEmptyRow,
  moveDropsOutSideData,
  moveRowsPreservingOutSide,
  normalizeMss,
  rowHasContent,
  timingOrderMsg,
  timingOrdered,
  type OutSide,
} from "./model";
import {
  EMPTY_FORMATTING,
  applyBox,
  applyFill,
  buildFillMap,
  cellKey,
  clearFormatting,
  computeBoxEdges,
  type BoxEdges,
} from "./formatting";
import { historyFor, type EditorSnapshot } from "./undo";
import { armArchiveUndo } from "./archiveUndo";
import { ExportDialog } from "./ExportDialog";
import {
  CellDisplay,
  EmojiEditor,
  EnumEditor,
  TextEditor,
  TypeaheadEditor,
  type CommitMove,
} from "./cells";
import type { SetFormatting } from "../../lib/api";
import "./set-editor.css";

// ---------------------------------------------------------------------------
// Column → row-field map (editable columns only; out_* are derived)
// ---------------------------------------------------------------------------

const FIELD: Partial<Record<ColId, keyof SetRow>> = {
  bpm: "bpm",
  key: "key",
  t_num: "t_num",
  a_num: "a_num",
  in_name: "in_name",
  in_delta: "in_delta",
  m_num: "m_num",
  lows: "lows",
  level: "level",
  swap_lows: "swap_lows",
  i_like: "i_like",
  notes: "notes",
  start: "start",
  transition: "transition",
};

const isEditable = (col: ColumnDef): boolean => FIELD[col.id] !== undefined;

function cellValue(row: SetRow, out: OutSide, col: ColId): string {
  if (col === "out_name") return out.name;
  if (col === "out_delta") return out.delta;
  const f = FIELD[col];
  return f ? row[f] : "";
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** §8: columns hidden behind the column-overflow menu at 1024–1439px. */
const NARROW_HIDDEN: readonly ColId[] = ["a_num", "start", "transition"];
const NARROW_QUERY = "(max-width: 1439px)";

type Doc = EditorSnapshot;

interface EditingState {
  pos: CellPos;
  /** null → edit current value (select-all); string → type-over seed. */
  seed: string | null;
}

interface RowSelInfo {
  fullRow: boolean;
  cStart: number;
  cEnd: number;
  focusCol: ColId | null;
}

interface RowEditing {
  col: ColId;
  seed: string | null;
}

// ---------------------------------------------------------------------------
// Row view (memoized — the grid is not virtualized; sets are hundreds of
// rows at most and memoized rows keep interaction O(selection), not O(set))
// ---------------------------------------------------------------------------

interface RowApi {
  onCellMouseDown: (e: ReactMouseEvent, row: number, col: ColId) => void;
  onCellDoubleClick: (row: number, col: ColId) => void;
  onHandleMouseDown: (e: ReactMouseEvent, row: number) => void;
  onRowContextMenu: (e: ReactMouseEvent, row: number) => void;
  commit: (row: number, col: ColId, value: string, move: CommitMove) => void;
  cancel: () => void;
}

interface RowProps {
  row: SetRow;
  index: number;
  out: OutSide;
  /** #138 — BPM of the row above, for the direction arrow (undefined on row 0). */
  prevBpm: string | undefined;
  mins: number | null;
  cum: number | null;
  tracks: readonly GridTrack[];
  template: string;
  lists: ValidationLists;
  keyDisplayAs: KeyDisplayAs;
  colorfulKeys: boolean;
  fillMap: Map<string, FillColor>;
  edgeMap: Map<string, BoxEdges>;
  selInfo: RowSelInfo | null;
  editing: RowEditing | null;
  /** #145 — cue columns currently rendered "loud" (their header colour). */
  loud: ReadonlySet<ColId>;
  /** #83 — the cue column in THIS row to paint orange, or null. */
  hlCol: ColId | null;
  ghost: boolean;
  dragSource: boolean;
  api: RowApi;
}

function edgeShadows(edges: BoxEdges, into: string[]): void {
  // §6.5 Box: 2px --text-primary overlay border (inset shadows, no layout).
  if (edges.top) into.push("inset 0 2px 0 0 var(--text-primary)");
  if (edges.bottom) into.push("inset 0 -2px 0 0 var(--text-primary)");
  if (edges.left) into.push("inset 2px 0 0 0 var(--text-primary)");
  if (edges.right) into.push("inset -2px 0 0 0 var(--text-primary)");
}

function CellEditor({
  col,
  value,
  editing,
  lists,
  index,
  row,
  api,
}: {
  col: ColumnDef;
  value: string;
  editing: RowEditing;
  lists: ValidationLists;
  index: number;
  /** The row being edited — Start/Transition cross-validate against it (#70). */
  row: SetRow;
  api: RowApi;
}) {
  const onCommit = (v: string, move: CommitMove) =>
    api.commit(index, col.id, v, move);
  switch (col.kind) {
    case "typeahead":
      return (
        <TypeaheadEditor
          initial={editing.seed ?? value}
          selectAll={editing.seed === null}
          onCommit={onCommit}
          onCancel={api.cancel}
        />
      );
    case "enum":
      return (
        <EnumEditor
          source={col.enumSource!}
          lists={lists}
          current={value}
          initialFilter={editing.seed ?? ""}
          onSelect={onCommit}
          onCancel={api.cancel}
        />
      );
    case "emoji":
      return (
        <EmojiEditor
          initial={editing.seed ?? value}
          quickPick={lists.i_like}
          onCommit={onCommit}
          onCancel={api.cancel}
        />
      );
    default: {
      // Start/Transition validate + auto-format to canonical M:SS (§25) and,
      // when both cells are set, must keep Start earlier than Transition (#70).
      const timingId =
        col.id === "start" || col.id === "transition" ? col.id : null;
      const normalize = timingId
        ? (raw: string) => {
            const norm = normalizeMss(raw);
            if (norm === null) return null;
            const start = timingId === "start" ? norm : row.start;
            const transition = timingId === "transition" ? norm : row.transition;
            if (!timingOrdered(start, transition)) {
              return {
                error: timingOrderMsg(
                  timingId,
                  timingId === "start" ? transition : start,
                ),
              };
            }
            return norm;
          }
        : undefined;
      return (
        <TextEditor
          initial={editing.seed ?? value}
          selectAll={editing.seed === null}
          align={col.align}
          multiline={col.id === "notes"}
          normalize={normalize}
          onCommit={onCommit}
          onCancel={api.cancel}
        />
      );
    }
  }
}

const RowView = memo(
  function RowView(props: RowProps) {
    const {
      row,
      index,
      out,
      prevBpm,
      mins,
      cum,
      tracks,
      template,
      lists,
      keyDisplayAs,
      colorfulKeys,
      fillMap,
      edgeMap,
      selInfo,
      editing,
      loud,
      hlCol,
      ghost,
      dragSource,
      api,
    } = props;

    return (
      <div
        className={`se-row${dragSource ? " se-row--dragsrc" : ""}`}
        style={{ gridTemplateColumns: template }}
        role="row"
        aria-rowindex={index + 3}
        onContextMenu={(e) => api.onRowContextMenu(e, index)}
      >
        {tracks.map((t, ti) => {
          if (t.kind === "handle") {
            return (
              <div
                key="handle"
                className="se-handle"
                title="Drag to reorder — or Alt+↑/↓"
                onMouseDown={(e) => api.onHandleMouseDown(e, index)}
              >
                ⋮⋮
              </div>
            );
          }
          if (t.kind === "spacer") return <div key={`sp${ti}`} />;
          if (t.kind === "calc") {
            const v = t.calc === "mins" ? mins : cum;
            // #70: the grid cells display 1-dp (rounded); the Mix Length STAT
            // keeps SM2's 2-dp format.
            return (
              <div key={t.calc} className="se-cell se-cell--right se-calc">
                {v !== null ? fmtMinutes1(v) : ""}
              </div>
            );
          }
          const col = t.col!;
          const value = cellValue(row, out, col.id);
          const colIdx = COL_INDEX.get(col.id) ?? 0;
          const inSel =
            selInfo !== null &&
            (selInfo.fullRow ||
              (colIdx >= selInfo.cStart && colIdx <= selInfo.cEnd));
          const isFocus = selInfo?.focusCol === col.id;
          const key = cellKey(row.id, col.id);
          const fill = fillMap.get(key);
          const edges = edgeMap.get(key);
          const isEditing = editing !== null && editing.col === col.id;
          // #83, widened by #165 — the first row's Out-side cells (OUT TRACK
          // TIMING, BPM, Key) are read-only (muted placeholder); the
          // cue-highlight paints THIS cell orange while a timing cell is the
          // single selection (render-time only — no formatting change).
          const roOutSide = isReadonlyOutSideCell(index, col.id);
          const isCueHl = hlCol === col.id;

          const classes = ["se-cell"];
          if (col.align !== "left") classes.push(`se-cell--${col.align}`);
          if (col.numeric) classes.push("num");
          if (col.group === "out") classes.push("se-cell--out");
          if (col.group === "in") classes.push("se-cell--in");
          if (fill) classes.push(`se-cell--fill-${fill}`);
          // #145 — loud cue columns take their group's header colour. Skipped
          // when the cell carries a manual RED/YELLOW fill: those fills have
          // text contrast tuned for the default cell colour, so the fill wins.
          // The #83 cue highlight overrides via CSS specificity.
          if (!fill && loud.has(col.id)) classes.push(`se-cell--loud-${col.id}`);
          if (inSel) classes.push("se-cell--sel");
          if (isCueHl) classes.push("se-cell--cue-hl");

          const shadows: string[] = [];
          // Focus ring first — it draws on top of user Box edges.
          if (isFocus) shadows.push("inset 0 0 0 2px var(--accent-blue)");
          if (edges) edgeShadows(edges, shadows);

          return (
            <div
              key={col.id}
              className={classes.join(" ")}
              style={
                shadows.length ? { boxShadow: shadows.join(", ") } : undefined
              }
              role="gridcell"
              aria-selected={inSel || undefined}
              data-r={index}
              data-c={col.id}
              onMouseDown={(e) => api.onCellMouseDown(e, index, col.id)}
              onDoubleClick={() => api.onCellDoubleClick(index, col.id)}
            >
              <CellDisplay
                col={col}
                value={value}
                lists={lists}
                keyDisplayAs={keyDisplayAs}
                colorfulKeys={colorfulKeys}
                ghost={ghost && col.id === "in_name"}
                readonlyOutSide={roOutSide}
                editing={isEditing}
                prevBpm={prevBpm}
              />
              {isEditing && (
                <CellEditor
                  col={col}
                  value={value}
                  editing={editing}
                  lists={lists}
                  index={index}
                  row={row}
                  api={api}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  },
  (a, b) =>
    a.row === b.row &&
    a.index === b.index &&
    a.out.name === b.out.name &&
    a.out.delta === b.out.delta &&
    a.mins === b.mins &&
    a.cum === b.cum &&
    a.tracks === b.tracks &&
    a.template === b.template &&
    a.prevBpm === b.prevBpm &&
    a.lists === b.lists &&
    a.keyDisplayAs === b.keyDisplayAs &&
    a.colorfulKeys === b.colorfulKeys &&
    a.fillMap === b.fillMap &&
    a.edgeMap === b.edgeMap &&
    a.loud === b.loud &&
    a.hlCol === b.hlCol &&
    a.ghost === b.ghost &&
    a.dragSource === b.dragSource &&
    a.api === b.api &&
    selInfoEq(a.selInfo, b.selInfo) &&
    editingEq(a.editing, b.editing),
);

function selInfoEq(a: RowSelInfo | null, b: RowSelInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.fullRow === b.fullRow &&
    a.cStart === b.cStart &&
    a.cEnd === b.cEnd &&
    a.focusCol === b.focusCol
  );
}

function editingEq(a: RowEditing | null, b: RowEditing | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.col === b.col && a.seed === b.seed;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type SaveState = "saved" | "saving" | "error";

/** Render Move-help copy segments, bolding the key-combo emphasis (#26). */
function renderMoveSegs(segments: readonly MoveInfoSegment[]) {
  return segments.map((seg, i) =>
    seg.strong ? <strong key={i}>{seg.text}</strong> : <span key={i}>{seg.text}</span>,
  );
}

export default function SetEditorScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useUiStore((s) => s.toast);
  const archiveViaStore = useSetsStore((s) => s.archive);
  const liveName = useSetsStore((s) => s.sets.find((x) => x.id === id)?.name);
  const display = useSettingsStore((s) => s.settings.display);
  const updateSettings = useSettingsStore((s) => s.update);
  // #140 — app-wide column visibility, alongside Spacing / Font Size.
  const showTiming = display.show_timing_columns;
  const showMixTimer = display.show_mix_timer_column;
  // #145 — cue columns rendered in their group's header colour. The T # / M #
  // here are the CUE columns (`t_num` / `m_num`), NOT the two OUT TRACK TIMING
  // columns that also render as M # / T # since #72.
  const loudCols = useMemo<ReadonlySet<ColId>>(() => {
    const s = new Set<ColId>();
    if (display.loud_t_column) s.add("t_num");
    if (display.loud_m_column) s.add("m_num");
    return s;
  }, [display.loud_t_column, display.loud_m_column]);

  // ---- document state (rows + formatting move together for undo) ----------
  const [doc, setDocState] = useState<Doc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [metaName, setMetaName] = useState("");
  const [exportFilename, setExportFilename] = useState<string | null>(null);
  const [lists, setLists] = useState<ValidationLists>(FACTORY_LISTS);

  const [sel, setSelState] = useState<Selection | null>(null);
  const [editing, setEditingState] = useState<EditingState | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [moveMode, setMoveModeState] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [dragGap, setDragGap] = useState<number | null>(null);
  const [dragBlock, setDragBlock] = useState<{ start: number; len: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; row: number } | null>(null);
  // #166 — a reorder held back because it would drop Out-side data off the
  // bottom of the set. Kept whole (indices + the selection the move would have
  // produced) so confirming replays exactly the move the user asked for.
  const [pendingMove, setPendingMove] = useState<{
    start: number;
    len: number;
    gap: number;
    sel: Selection;
  } | null>(null);

  // ---- §8 narrow-viewport column overflow ---------------------------------
  const [narrow, setNarrow] = useState(
    () => window.matchMedia(NARROW_QUERY).matches,
  );
  const [narrowShown, setNarrowShown] = useState<ReadonlySet<ColId>>(
    () => new Set<ColId>(),
  );
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  /**
   * Everything currently hidden, from BOTH sources (#140): the §8 narrow
   * viewport overflow and the user's own app-wide toggles. One set, one hiding
   * mechanism — and the user's choice WINS: hiding a column the viewport would
   * have shown is honoured, and the "Cols" popover cannot resurrect a column
   * the user has switched off (its checkbox goes disabled and unchecked, so the
   * two never silently disagree).
   */
  const hidden = useMemo<ReadonlySet<HideId>>(() => {
    const out = new Set<HideId>();
    if (narrow) {
      for (const c of NARROW_HIDDEN) if (!narrowShown.has(c)) out.add(c);
    }
    if (!showTiming) for (const t of TIMING_TRACK_IDS) out.add(t);
    if (!showMixTimer) out.add("mixlen");
    return out;
  }, [narrow, narrowShown, showTiming, showMixTimer]);
  const tracks = useMemo(() => tracksFor(hidden), [hidden]);
  const template = useMemo(() => gridTemplateFor(tracks), [tracks]);
  const navCols = useMemo(() => navColsFor(hidden), [hidden]);

  // ---- refs so stable handlers always see the latest state ----------------
  const idRef = useRef(id);
  const docRef = useRef<Doc | null>(null);
  const selRef = useRef<Selection | null>(null);
  const editingRef = useRef<EditingState | null>(null);
  const moveModeRef = useRef(false);
  const navColsRef = useRef<readonly ColId[]>(navCols);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const colMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    navColsRef.current = navCols;
    // Clamp any selection whose columns just got hidden.
    const s = selRef.current;
    if (s && (!navCols.includes(s.focus.col) || !navCols.includes(s.anchor.col))) {
      const nearest = (c: ColId): ColId => {
        const full = COL_INDEX.get(c) ?? 0;
        let best: ColId = navCols[0];
        for (const nc of navCols) {
          if ((COL_INDEX.get(nc) ?? 0) <= full) best = nc;
        }
        return best;
      };
      setSel({
        anchor: { row: s.anchor.row, col: nearest(s.anchor.col) },
        focus: { row: s.focus.row, col: nearest(s.focus.col) },
        fullRow: s.fullRow,
      });
    }
  }, [navCols]);

  const setSel = (s: Selection | null) => {
    selRef.current = s;
    setSelState(s);
  };
  const setEditing = (e: EditingState | null) => {
    editingRef.current = e;
    setEditingState(e);
  };
  const setMoveMode = (v: boolean) => {
    moveModeRef.current = v;
    setMoveModeState(v);
  };

  // ---- autosave (§7.3): debounced full-list PUTs ---------------------------
  const saveTimer = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const inflightRef = useRef(false);

  const runSave = useCallback(async () => {
    if (inflightRef.current) return;
    const d = docRef.current;
    if (!d) return;
    const setId = idRef.current;
    dirtyRef.current = false;
    inflightRef.current = true;
    try {
      await putSetRows(setId, d.rows);
      await putSetFormatting(setId, d.formatting);
      inflightRef.current = false;
      if (dirtyRef.current) void runSave();
      else setSaveState("saved");
    } catch {
      inflightRef.current = false;
      dirtyRef.current = true;
      setSaveState("error");
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void runSave(), 4000);
    }
  }, []);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("saving");
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void runSave(), 700);
  }, [runSave]);

  // ---- document mutation + per-set session undo ----------------------------
  const setDoc = useCallback((next: Doc) => {
    docRef.current = next;
    setDocState(next);
    // Clamp selection to the new row count (undo/delete can shrink it).
    const s = selRef.current;
    if (s) {
      const max = next.rows.length - 1;
      if (s.anchor.row > max || s.focus.row > max) {
        setSel({
          anchor: { row: Math.min(s.anchor.row, max), col: s.anchor.col },
          focus: { row: Math.min(s.focus.row, max), col: s.focus.col },
          fullRow: s.fullRow,
        });
      }
    }
  }, []);

  const mutate = useCallback(
    (next: Doc) => {
      const cur = docRef.current;
      if (!cur) return;
      historyFor(idRef.current).record(cur);
      setDoc(next);
      scheduleSave();
    },
    [setDoc, scheduleSave],
  );

  const undo = useCallback(() => {
    const cur = docRef.current;
    if (!cur) return;
    const prev = historyFor(idRef.current).undo(cur);
    if (prev) {
      setDoc(prev);
      scheduleSave();
    }
  }, [setDoc, scheduleSave]);

  const redo = useCallback(() => {
    const cur = docRef.current;
    if (!cur) return;
    const next = historyFor(idRef.current).redo(cur);
    if (next) {
      setDoc(next);
      scheduleSave();
    }
  }, [setDoc, scheduleSave]);

  // ---- load ----------------------------------------------------------------
  useEffect(() => {
    idRef.current = id;
    docRef.current = null;
    setDocState(null);
    setSel(null);
    setEditing(null);
    setLoadError(null);
    setSaveState("saved");
    setMoveMode(false);
    let cancelled = false;
    getSet(id)
      .then((d) => {
        if (cancelled) return;
        setMetaName(d.name);
        setExportFilename(d.export_filename ?? null);
        setDoc({
          // §7.1 empty state: a new set shows one empty row.
          rows: d.rows.length > 0 ? d.rows : [makeEmptyRow()],
          formatting: d.formatting ?? EMPTY_FORMATTING,
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      // Flush any pending edits for THIS set before switching away.
      if (dirtyRef.current && docRef.current) {
        dirtyRef.current = false;
        const d = docRef.current;
        void putSetRows(id, d.rows).catch(() => {});
        void putSetFormatting(id, d.formatting).catch(() => {});
      }
    };
  }, [id, setDoc]);

  useEffect(() => {
    let cancelled = false;
    getValidationLists()
      .then((l) => {
        if (!cancelled) setLists(l);
      })
      .catch(() => {
        /* factory fallback already in place */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- derived view data ----------------------------------------------------
  const rows = doc?.rows ?? null;
  const outs = useMemo(() => (rows ? deriveOuts(rows) : []), [rows]);
  const timing = useMemo(
    () => (rows ? computeTiming(rows) : { mins: [], cumulative: [], mixLength: null }),
    [rows],
  );
  const stats = useMemo(
    () =>
      rows
        ? computeStats(rows)
        : { trackCount: 0, mixLength: null, bpmAvg: null, bpmCrest: null },
    [rows],
  );
  // #82: advisory flag — some Out-Track row is missing computable timing, so
  // the Mix Length total is incomplete (partial sum still shown).
  const mixLengthIncomplete = useMemo(
    () => (rows ? hasIncompleteTiming(rows) : false),
    [rows],
  );
  const fillMap = useMemo(
    () => buildFillMap(doc?.formatting ?? EMPTY_FORMATTING),
    [doc?.formatting],
  );
  const rowIds = useMemo(() => (rows ? rows.map((r) => r.id) : []), [rows]);
  const edgeMap = useMemo(
    () =>
      computeBoxEdges(
        doc?.formatting ?? EMPTY_FORMATTING,
        rowIds,
        NAV_COLS as readonly string[],
      ),
    [doc?.formatting, rowIds],
  );

  // ---- selection / navigation ------------------------------------------------
  const setSelSingle = (row: number, col: ColId) =>
    setSel({ anchor: { row, col }, focus: { row, col }, fullRow: false });

  const moveFocus = (dr: number, dc: number, extend: boolean) => {
    const d = docRef.current;
    const s = selRef.current;
    if (!d || !s) return;
    const nv = navColsRef.current;
    const row = clamp(s.focus.row + dr, 0, d.rows.length - 1);
    let ci = nv.indexOf(s.focus.col);
    if (ci < 0) ci = 0;
    ci = clamp(ci + dc, 0, nv.length - 1);
    const pos: CellPos = { row, col: nv[ci] };
    if (extend) {
      setSel({
        anchor: s.anchor,
        focus: pos,
        fullRow: dc === 0 ? s.fullRow : false,
      });
    } else {
      setSelSingle(pos.row, pos.col);
    }
  };

  // Keep the focused cell in view.
  useEffect(() => {
    if (!sel) return;
    const el = wrapRef.current?.querySelector(
      `[data-r="${sel.focus.row}"][data-c="${sel.focus.col}"]`,
    );
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);

  const openEditor = (pos: CellPos, seed: string | null) => {
    const col = COLUMN_BY_ID.get(pos.col);
    if (!col || !isEditable(col)) return;
    setSelSingle(pos.row, pos.col);
    // #83, widened by #165 — the first row's Out-side cells (OUT TRACK TIMING,
    // BPM, Key) stay selectable but cannot be edited (click/Enter/type-over do
    // not open the editor). Delete/Backspace still clears a legacy value via
    // clearSelectedCells (position-based, not here).
    if (isReadonlyOutSideCell(pos.row, pos.col)) return;
    setEditing({ pos, seed });
  };

  const clearSelectedCells = () => {
    const d = docRef.current;
    const s = selRef.current;
    if (!d || !s) return;
    const span = selectionRowSpan(s);
    const cols = selectionCols(s);
    let changed = false;
    const nextRows = d.rows.map((row, i) => {
      if (i < span.start || i > span.end) return row;
      let copy: SetRow | null = null;
      for (const c of cols) {
        const f = FIELD[c];
        if (!f) continue;
        const cv = clearedValue(c);
        if (row[f] !== cv) {
          if (!copy) copy = { ...row };
          copy[f] = cv;
        }
      }
      if (copy) {
        changed = true;
        return copy;
      }
      return row;
    });
    if (changed) mutate({ rows: nextRows, formatting: d.formatting });
  };

  /**
   * Perform a reorder, optionally appending `addRows` empty rows first (#166).
   *
   * The append and the move are ONE `mutate()`, so Ctrl+Z takes the set back to
   * where it started rather than leaving ten orphan rows behind. Appending at
   * the end never shifts `start` / `len` / `gap`, so the same indices apply to
   * the longer array.
   */
  const applyMove = (
    start: number,
    len: number,
    gap: number,
    nextSel: Selection,
    addRows: number,
  ) => {
    const d = docRef.current;
    if (!d) return;
    const rows =
      addRows > 0
        ? [...d.rows, ...Array.from({ length: addRows }, () => makeEmptyRow())]
        : d.rows;
    mutate({
      rows: moveRowsPreservingOutSide(rows, start, len, gap),
      formatting: d.formatting,
    });
    setSel(nextSel);
  };

  /**
   * Run a reorder, or ask first when it would drop Out-side data off the bottom
   * of the set (#166). Every move path goes through here — Alt+arrows, Move-mode
   * arrows and the drag handle — so the guard cannot be bypassed by one of them.
   */
  const requestMove = (
    start: number,
    len: number,
    gap: number,
    nextSel: Selection,
  ) => {
    const d = docRef.current;
    if (!d) return;
    if (moveDropsOutSideData(d.rows, start, len, gap)) {
      setPendingMove({ start, len, gap, sel: nextSel });
      return;
    }
    applyMove(start, len, gap, nextSel, 0);
  };

  const moveSelBlock = (dir: -1 | 1) => {
    const d = docRef.current;
    const s = selRef.current;
    if (!d || !s) return;
    const span = selectionRowSpan(s);
    const start = span.start;
    const len = span.end - span.start + 1;
    if (dir === -1 && start === 0) return;
    if (dir === 1 && start + len >= d.rows.length) return;
    const gap = dir === -1 ? start - 1 : start + len + 1;
    requestMove(start, len, gap, {
      anchor: { row: s.anchor.row + dir, col: s.anchor.col },
      focus: { row: s.focus.row + dir, col: s.focus.col },
      fullRow: s.fullRow,
    });
  };

  // ---- editing commits ---------------------------------------------------------
  const commitCell = (
    rowIdx: number,
    col: ColId,
    raw: string,
    move: CommitMove,
  ) => {
    setEditing(null);
    wrapRef.current?.focus();
    const d = docRef.current;
    if (!d || rowIdx >= d.rows.length) return;
    const colDef = COLUMN_BY_ID.get(col);
    if (!colDef) return;
    let value = raw;
    if (colDef.kind === "enum") {
      value = committedEnumValue(colDef.enumSource!, raw);
    }
    const f = FIELD[col];
    if (!f) return;

    let nextRows = d.rows;
    if (d.rows[rowIdx][f] !== value) {
      nextRows = d.rows.map((r, i) => (i === rowIdx ? { ...r, [f]: value } : r));
    }
    // New-row behavior (see file header): Enter on the last row appends the
    // next row when the committed row has content.
    if (
      move === "down" &&
      rowIdx === nextRows.length - 1 &&
      rowHasContent(nextRows[rowIdx])
    ) {
      nextRows = [...nextRows, makeEmptyRow()];
    }
    if (nextRows !== d.rows) {
      mutate({ rows: nextRows, formatting: d.formatting });
    }

    const nv = navColsRef.current;
    if (move === "down") {
      setSelSingle(Math.min(rowIdx + 1, nextRows.length - 1), col);
    } else if (move === "up") {
      // #137 — Shift+Enter is Enter's mirror image: commit, then move up. On
      // row 1 it commits and stays put (clamped), the same way Enter clamps on
      // the last row when no new row is appended.
      setSelSingle(Math.max(rowIdx - 1, 0), col);
    } else if (move === "right" || move === "left") {
      let ci = nv.indexOf(col);
      if (ci < 0) ci = 0;
      ci = clamp(ci + (move === "right" ? 1 : -1), 0, nv.length - 1);
      setSelSingle(rowIdx, nv[ci]);
    }
    // move === "none" (blur / mouse pick): leave the selection where the
    // user put it — a click elsewhere already selected the new cell.
  };

  const cancelEdit = () => {
    setEditing(null);
    wrapRef.current?.focus();
  };

  // ---- row insert / delete -------------------------------------------------------
  const insertRowAt = (at: number) => {
    const d = docRef.current;
    if (!d) return;
    const nextRows = [...d.rows];
    nextRows.splice(at, 0, makeEmptyRow());
    mutate({ rows: nextRows, formatting: d.formatting });
    setSelSingle(at, "in_name");
  };

  /**
   * #144 — append a fixed batch of empty rows to the very bottom, wherever the
   * selection happens to be. Goes through `mutate()`, so it lands on the undo
   * stack as ONE step and schedules the save for free; it deliberately does not
   * go through the commit path, so the grid's auto-append-on-content never
   * fires alongside it and the count is exactly +10.
   */
  const appendRows = (count: number) => {
    const d = docRef.current;
    if (!d) return;
    const added = Array.from({ length: count }, () => makeEmptyRow());
    mutate({ rows: [...d.rows, ...added], formatting: d.formatting });
    wrapRef.current?.focus();
  };

  // #162 — there is deliberately NO row-delete path. Deleting a row left the
  // following row's Out-side columns (BPM / Key / T # / A # / timing) describing
  // a track that was no longer in the set: those fields are stored ON a row while
  // describing the track one row EARLIER, the same offset-by-one #133 untangled
  // for MOVE. Rather than pick a semantics for "which track does this Out side
  // now describe" when the answer is genuinely none, the gesture is gone.
  //
  // Rows are EMPTIED, not removed — Delete/Backspace over a selection still
  // clears cell contents. This matches the SM2 model (the template shipped ~981
  // pre-made rows) and the existing archive rule that no UI path permanently
  // destroys set data outside the archive view (set-archive.md §2).

  // ---- formatting toolbar (§6.5) ---------------------------------------------------
  const formatAction = (kind: "red" | "yellow" | "box" | "clear") => {
    const d = docRef.current;
    const s = selRef.current;
    if (!d || !s) return;
    const span = selectionRowSpan(s);
    const ids = d.rows.slice(span.start, span.end + 1).map((r) => r.id);
    const cols = selectionCols(s);
    let fm: SetFormatting;
    if (kind === "box") fm = applyBox(d.formatting, ids, cols);
    else if (kind === "clear") fm = clearFormatting(d.formatting, ids, cols);
    else fm = applyFill(d.formatting, ids, cols, kind);
    mutate({ rows: d.rows, formatting: fm });
    wrapRef.current?.focus();
  };

  // ---- drag reorder ------------------------------------------------------------------
  const dragRef = useRef<{
    start: number;
    len: number;
    rowH: number;
    moved: boolean;
  } | null>(null);
  const dragGapRef = useRef<number | null>(null);

  const onHandleMouseDown = (e: ReactMouseEvent, rowIdx: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    wrapRef.current?.focus();
    const d = docRef.current;
    if (!d) return;
    let start = rowIdx;
    let len = 1;
    const s = selRef.current;
    if (s && s.fullRow) {
      const span = selectionRowSpan(s);
      if (rowIdx >= span.start && rowIdx <= span.end) {
        start = span.start;
        len = span.end - span.start + 1;
      }
    }
    setSel({
      anchor: { row: start, col: navColsRef.current[0] },
      focus: { row: start + len - 1, col: navColsRef.current[navColsRef.current.length - 1] },
      fullRow: true,
    });
    const rowH =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--grid-row-height",
        ),
      ) || 32;
    dragRef.current = { start, len, rowH, moved: false };
    setDragBlock({ start, len });

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      const body = bodyRef.current;
      const wrap = wrapRef.current;
      const dd = docRef.current;
      if (!drag || !body || !wrap || !dd) return;
      drag.moved = true;
      const rect = body.getBoundingClientRect();
      const gap = clamp(
        Math.round((ev.clientY - rect.top) / drag.rowH),
        0,
        dd.rows.length,
      );
      dragGapRef.current = gap;
      setDragGap(gap);
      // Edge auto-scroll.
      const wrect = wrap.getBoundingClientRect();
      if (ev.clientY < wrect.top + 60) wrap.scrollTop -= 12;
      else if (ev.clientY > wrect.bottom - 40) wrap.scrollTop += 12;
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const drag = dragRef.current;
      const gap = dragGapRef.current;
      const dd = docRef.current;
      dragRef.current = null;
      dragGapRef.current = null;
      setDragGap(null);
      setDragBlock(null);
      if (!drag || !dd || !drag.moved || gap === null) return;
      if (gap >= drag.start && gap <= drag.start + drag.len) return; // no-op
      const newStart = gap > drag.start ? gap - drag.len : gap;
      requestMove(drag.start, drag.len, gap, {
        anchor: { row: newStart, col: navColsRef.current[0] },
        focus: {
          row: newStart + drag.len - 1,
          col: navColsRef.current[navColsRef.current.length - 1],
        },
        fullRow: true,
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ---- cell mouse interaction -----------------------------------------------------------
  const onCellMouseDown = (e: ReactMouseEvent, rowIdx: number, col: ColId) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".se-pop, .se-editor, .se-enumwrap")) return;
    if (!editingRef.current) e.preventDefault(); // keep grid focus (editors need real focus)
    wrapRef.current?.focus();
    const s = selRef.current;
    if (e.shiftKey && s) {
      setSel({ anchor: s.anchor, focus: { row: rowIdx, col }, fullRow: false });
    } else {
      setSelSingle(rowIdx, col);
    }
  };

  const onCellDoubleClick = (rowIdx: number, col: ColId) => {
    openEditor({ row: rowIdx, col }, null);
  };

  const onRowContextMenu = (e: ReactMouseEvent, rowIdx: number) => {
    e.preventDefault();
    const s = selRef.current;
    const span = s ? selectionRowSpan(s) : null;
    if (!s || !span || rowIdx < span.start || rowIdx > span.end) {
      setSelSingle(rowIdx, selRef.current?.focus.col ?? "in_name");
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, row: rowIdx });
  };

  // Stable per-render API object for memoized rows (all callbacks read refs).
  const rowApi = useMemo<RowApi>(
    () => ({
      onCellMouseDown,
      onCellDoubleClick,
      onHandleMouseDown,
      onRowContextMenu,
      commit: commitCell,
      cancel: cancelEdit,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---- grid keyboard model (§5.2) ---------------------------------------------------------
  const onGridKeyDown = (e: ReactKeyboardEvent) => {
    if (editingRef.current) return; // editors stop propagation; belt & braces
    const d = docRef.current;
    if (!d) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (mod && k.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }

    const s = selRef.current;
    if (!s) {
      if (
        ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Tab"].includes(k)
      ) {
        e.preventDefault();
        setSelSingle(0, navColsRef.current[0]);
      }
      return;
    }

    switch (k) {
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault();
        const dir = k === "ArrowUp" ? -1 : 1;
        if (e.altKey || moveModeRef.current) moveSelBlock(dir as -1 | 1);
        else moveFocus(dir, 0, e.shiftKey);
        return;
      }
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        moveFocus(0, k === "ArrowLeft" ? -1 : 1, e.shiftKey);
        return;
      }
      case "Tab": {
        e.preventDefault();
        moveFocus(0, e.shiftKey ? -1 : 1, false);
        return;
      }
      case "Enter":
      case "F2": {
        e.preventDefault();
        const col = COLUMN_BY_ID.get(s.focus.col);
        if (col && isEditable(col)) openEditor(s.focus, null);
        else moveFocus(1, 0, false);
        return;
      }
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        clearSelectedCells();
        return;
      }
      case "Escape": {
        if (moveModeRef.current) setMoveMode(false);
        else setSelSingle(s.focus.row, s.focus.col);
        return;
      }
      default: {
        // Type-over: printable key starts editing (enum cells open their
        // dropdown filtered to the keystroke — §5.2).
        if (k.length === 1 && !mod && !e.altKey) {
          const col = COLUMN_BY_ID.get(s.focus.col);
          if (col && isEditable(col)) {
            e.preventDefault();
            openEditor(s.focus, k);
          }
        }
      }
    }
  };

  // Screen-level undo/redo: works even when focus is on the toolbar (the grid
  // handler runs first and preventDefaults, so this never double-fires).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Ctrl/Cmd+E opens the Export dialog (§5.2) — from anywhere except while
  // typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "e") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setMenuOpen(false);
      setExportOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // #140 — Alt+T / Alt+M toggle the OUT TRACK TIMING group and the Mix Timer
  // column. Same shape as the Ctrl+E handler above, including skipping while a
  // text field has focus. Alt (not Ctrl/Cmd) keeps them clear of Ctrl+E,
  // Ctrl+Z/Y and the sidebar's Ctrl+B.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== "t" && k !== "m") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setMenuOpen(false);
      setDisplayOption(
        k === "t"
          ? { show_timing_columns: !showTiming }
          : { show_mix_timer_column: !showMixTimer },
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTiming, showMixTimer]);

  // ---- overflow / column menus close on outside click --------------------------------------
  useEffect(() => {
    if (!menuOpen && !colMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || colMenuRef.current?.contains(t)) return;
      setMenuOpen(false);
      setColMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen, colMenuOpen]);

  // ---- archive (set-archive.md §2) -----------------------------------------------------------
  const name = liveName ?? metaName;
  const doArchive = async () => {
    setConfirmArchive(false);
    try {
      await archiveViaStore(id);
      toast(`Archived "${name}". Ctrl+Z restores it.`, "success");
      armArchiveUndo(id, name);
      navigate("/");
    } catch (err) {
      toast(
        `Could not archive "${name}": ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  };

  const setDisplayOption = (patch: {
    line_spacing?: number;
    font_size?: number;
    show_timing_columns?: boolean;
    show_mix_timer_column?: boolean;
  }) => {
    void updateSettings({ display: patch }).catch((err) => {
      toast(err instanceof Error ? err.message : String(err), "error");
    });
  };

  // ---- render ---------------------------------------------------------------------------------
  if (loadError) {
    return (
      <div className="se">
        <div className="se-center">
          <div>Could not load this set: {loadError}</div>
          <Button onClick={() => navigate(0)}>Retry</Button>
        </div>
      </div>
    );
  }
  if (!doc || !rows) {
    return (
      <div className="se">
        <div className="se-center">Loading…</div>
      </div>
    );
  }

  const selSpan = sel ? selectionRowSpan(sel) : null;
  const selCS = sel ? COL_INDEX.get(sel.anchor.col) ?? 0 : 0;
  const selCF = sel ? COL_INDEX.get(sel.focus.col) ?? 0 : 0;
  const selColStart = Math.min(selCS, selCF);
  const selColEnd = Math.max(selCS, selCF);
  const ghostRow = rows.length === 1 && !rowHasContent(rows[0]);
  // #83 — cue cell to paint orange while a timing cell is the single selection.
  const hlTarget = timingCueHighlight(sel);
  const outSpan = groupSpan("out", tracks);
  const inSpan = groupSpan("in", tracks);
  const timingSpan = groupSpan("timing", tracks);
  const rowH =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--grid-row-height",
      ),
    ) || 32;

  const saveText =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Save failed — retrying"
        : "All changes saved";

  return (
    <div className="se">
      <div className="se-toolbar">
        <h1 className="se-title" title={name}>
          {name || "…"}
        </h1>
        <span className={`se-save se-save--${saveState}`}>{saveText}</span>
        <div className="se-tb-spring" />

        <Toggle label="Stats" checked={statsOpen} onChange={setStatsOpen} />
        <div className="se-tb-sep" />

        <div className="se-tb-group" role="group" aria-label="Cell formatting">
          <Button
            size="sm"
            className="se-fbtn se-fbtn--red"
            disabled={!sel}
            title="Shade the selected cells red"
            onClick={() => formatAction("red")}
          >
            RED
          </Button>
          <Button
            size="sm"
            className="se-fbtn se-fbtn--yellow"
            disabled={!sel}
            title="Shade the selected cells yellow"
            onClick={() => formatAction("yellow")}
          >
            YELLOW
          </Button>
          <Button
            size="sm"
            className="se-fbtn se-fbtn--box"
            disabled={!sel}
            title="Draw a box around the selection"
            onClick={() => formatAction("box")}
          >
            Box
          </Button>
          <Button
            size="sm"
            className="se-fbtn se-fbtn--clear"
            disabled={!sel}
            title="Remove shading and boxes from the selection"
            onClick={() => formatAction("clear")}
          >
            Clear
          </Button>
        </div>
        <div className="se-tb-sep" />

        <Button
          size="sm"
          onClick={() => appendRows(10)}
          title="Add ten empty rows to the end of the set"
        >
          Add 10
        </Button>

        <Toggle
          label="Move"
          checked={moveMode}
          onChange={(v) => {
            setMoveMode(v);
            wrapRef.current?.focus();
          }}
        />
        <span className="se-info">
          <button
            type="button"
            className="se-info__btn"
            aria-label="How to use Move"
            aria-describedby="se-move-help"
          >
            ⓘ
          </button>
          <div className="se-info__pop" id="se-move-help" role="tooltip">
            <span className="se-info__title">{MOVE_INFO_TITLE}</span>
            <ol className="se-info__steps">
              {MOVE_INFO_STEPS.map((step, i) => (
                <li key={i}>{renderMoveSegs(step)}</li>
              ))}
            </ol>
            <div className="se-info__tip">{renderMoveSegs(MOVE_INFO_TIP)}</div>
          </div>
        </span>
        <div className="se-tb-sep" />

        <div className="se-tb-group">
          <span className="se-tb-label">Spacing</span>
          <Stepper
            value={display.line_spacing}
            min={70}
            max={150}
            step={10}
            format={(v) => `${v}%`}
            ariaLabel="Spacing"
            onChange={(v) => setDisplayOption({ line_spacing: v })}
          />
        </div>
        <div className="se-tb-group">
          <span className="se-tb-label">Font Size</span>
          <Stepper
            value={display.font_size}
            min={10}
            max={20}
            step={1}
            format={(v) => `${v}px`}
            ariaLabel="Font Size"
            onChange={(v) => setDisplayOption({ font_size: v })}
          />
        </div>

        {narrow && (
          <>
            <Button
              size="sm"
              title="Show or hide overflow columns"
              onClick={() => {
                setColMenuOpen((o) => !o);
                setMenuOpen(false);
              }}
            >
              Cols
            </Button>
            {colMenuOpen && (
              <div className="se-colmenu" ref={colMenuRef}>
                {NARROW_HIDDEN.map((c) => {
                  // #140 — the user's own toggle wins over the viewport
                  // overflow: a column they switched off cannot be resurrected
                  // here, so the two controls can never disagree silently.
                  const offByUser = !showTiming && TIMING_TRACK_IDS.includes(c);
                  return (
                    <label key={c}>
                      <input
                        type="checkbox"
                        checked={!offByUser && narrowShown.has(c)}
                        disabled={offByUser}
                        title={
                          offByUser
                            ? "Hidden by “Show timing columns” (Alt+T)"
                            : undefined
                        }
                        onChange={(e) => {
                          const next = new Set(narrowShown);
                          if (e.target.checked) next.add(c);
                          else next.delete(c);
                          setNarrowShown(next);
                        }}
                      />
                      {COLUMN_BY_ID.get(c)?.label}
                    </label>
                  );
                })}
              </div>
            )}
          </>
        )}

        <Button
          size="sm"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((o) => !o);
            setColMenuOpen(false);
          }}
        >
          ⋯
        </Button>
        {menuOpen && (
          <div className="se-menu" ref={menuRef} role="menu">
            <button
              type="button"
              role="menuitem"
              className="se-menu__item"
              onClick={() => {
                setMenuOpen(false);
                setExportOpen(true);
              }}
            >
              Export…<span className="se-menu__hint">Ctrl+E</span>
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={showTiming}
              className="se-menu__item"
              onClick={() => {
                setMenuOpen(false);
                setDisplayOption({ show_timing_columns: !showTiming });
              }}
            >
              {showTiming ? "Hide" : "Show"} timing columns
              <span className="se-menu__hint">Alt+T</span>
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={showMixTimer}
              className="se-menu__item"
              onClick={() => {
                setMenuOpen(false);
                setDisplayOption({ show_mix_timer_column: !showMixTimer });
              }}
            >
              {showMixTimer ? "Hide" : "Show"} mix timer column
              <span className="se-menu__hint">Alt+M</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="se-menu__item"
              onClick={() => {
                setMenuOpen(false);
                setConfirmArchive(true);
              }}
            >
              Archive Set
            </button>
          </div>
        )}
      </div>

      {statsOpen && (
        <div className="se-stats">
          <div className="se-stat">
            <span className="ni-label"># Tracks</span>
            <span className="se-stat__value">{stats.trackCount}</span>
          </div>
          <div className="se-stat">
            <span className="ni-label">Mix Length</span>
            <span
              className={`se-stat__value${stats.mixLength === null ? " se-stat__value--empty" : " se-stat__value--minlen"}`}
            >
              {stats.mixLength !== null ? fmtHMM(stats.mixLength) : "---"}
            </span>
            {mixLengthIncomplete && (
              <span
                className="se-stat__warn"
                role="img"
                aria-label="Some rows with an Out Track are missing Start/Transition times — Mix Length is incomplete. Fill in the OUT TRACK TIMING columns (M # / T #)."
                title="Some rows with an Out Track are missing Start/Transition times — Mix Length is incomplete. Fill in the OUT TRACK TIMING columns (M # / T #)."
              >
                ⚠
              </span>
            )}
          </div>
          <div className="se-stat">
            <span className="ni-label">BPM Avg.</span>
            <span
              className={`se-stat__value${stats.bpmAvg === null ? " se-stat__value--empty" : ""}`}
            >
              {stats.bpmAvg !== null ? fmtBpmStat(stats.bpmAvg) : "-----"}
            </span>
          </div>
          <div className="se-stat">
            <span className="ni-label">BPM Crest</span>
            <span
              className={`se-stat__value${stats.bpmCrest === null ? " se-stat__value--empty" : ""}`}
            >
              {stats.bpmCrest !== null ? fmtBpmStat(stats.bpmCrest) : "---"}
            </span>
          </div>
        </div>
      )}

      <div
        className="se-gridwrap"
        ref={wrapRef}
        tabIndex={0}
        role="grid"
        aria-label={`Set ${name}`}
        aria-rowcount={rows.length + 2}
        onKeyDown={onGridKeyDown}
      >
        <div className="se-grid">
          <div
            className="se-ghead"
            style={{ gridTemplateColumns: template }}
            role="row"
          >
            {outSpan.start > 0 && (
              <div
                className="se-ghead__group se-ghead__group--out"
                style={{ gridColumn: `${outSpan.start} / ${outSpan.end}` }}
              >
                Out Track
              </div>
            )}
            {inSpan.start > 0 && (
              <div
                className="se-ghead__group se-ghead__group--in"
                style={{ gridColumn: `${inSpan.start} / ${inSpan.end}` }}
              >
                In Track
              </div>
            )}
            {timingSpan.start > 0 && (
              <div
                className="se-ghead__group se-ghead__group--timing"
                style={{ gridColumn: `${timingSpan.start} / ${timingSpan.end}` }}
              >
                Out Track Timing
              </div>
            )}
          </div>

          <div
            className="se-head"
            style={{ gridTemplateColumns: template }}
            role="row"
          >
            {tracks.map((t, ti) => {
              if (t.kind === "handle" || t.kind === "spacer") {
                return <div key={`h${ti}`} />;
              }
              if (t.kind === "calc") {
                return (
                  <div
                    key={t.calc}
                    className="se-head__cell se-head__cell--right"
                  >
                    {t.calc === "mins" ? "Play Time" : "Mix Timer"}
                  </div>
                );
              }
              const col = t.col!;
              const classes = ["se-head__cell"];
              if (col.align !== "left")
                classes.push(`se-head__cell--${col.align}`);
              if (col.group === "out") classes.push("se-head__cell--out");
              if (col.group === "in") classes.push("se-head__cell--in");
              // M #/T # timing headers stay unshaded (#72): the Out-Track cue is
              // carried by the OUT TRACK TIMING super-header, not per-header pink.
              return (
                <div
                  key={col.id}
                  className={classes.join(" ")}
                  role="columnheader"
                  data-c={col.id}
                >
                  <span>{col.label}</span>
                  {col.timingTip && (
                    <div className="se-htip">
                      <span className="se-htip__badge se-htip__badge--out">
                        Out Track
                      </span>
                      <div>{col.timingTip}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="se-body" ref={bodyRef} style={{ position: "relative" }}>
            {rows.map((row, i) => {
              const inSelRow =
                sel !== null &&
                selSpan !== null &&
                i >= selSpan.start &&
                i <= selSpan.end;
              const selInfo: RowSelInfo | null = inSelRow
                ? {
                    fullRow: sel!.fullRow,
                    cStart: selColStart,
                    cEnd: selColEnd,
                    focusCol: sel!.focus.row === i ? sel!.focus.col : null,
                  }
                : null;
              const rowEditing: RowEditing | null =
                editing && editing.pos.row === i
                  ? { col: editing.pos.col, seed: editing.seed }
                  : null;
              const hlCol: ColId | null =
                hlTarget && hlTarget.row === i ? hlTarget.col : null;
              return (
                <RowView
                  key={row.id}
                  row={row}
                  index={i}
                  out={outs[i]}
                  prevBpm={i > 0 ? rows[i - 1].bpm : undefined}
                  mins={timing.mins[i]}
                  cum={timing.cumulative[i]}
                  tracks={tracks}
                  template={template}
                  lists={lists}
                  keyDisplayAs={display.key_display_as}
                  colorfulKeys={display.colorful_keys}
                  fillMap={fillMap}
                  edgeMap={edgeMap}
                  selInfo={selInfo}
                  editing={rowEditing}
                  loud={loudCols}
                  hlCol={hlCol}
                  ghost={ghostRow && i === 0}
                  dragSource={
                    dragBlock !== null &&
                    i >= dragBlock.start &&
                    i < dragBlock.start + dragBlock.len
                  }
                  api={rowApi}
                />
              );
            })}
            {dragGap !== null && (
              <div
                className="se-insertline"
                style={{ top: dragGap * rowH }}
              />
            )}
          </div>
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={(() => {
            const span = selRef.current
              ? selectionRowSpan(selRef.current)
              : { start: ctxMenu.row, end: ctxMenu.row };
            // #162 — insert only. The Delete row / Delete N rows item is gone;
            // see the note beside `insertRowAt` for why.
            return [
              {
                label: "Insert row above",
                onSelect: () => insertRowAt(span.start),
              },
              {
                label: "Insert row below",
                onSelect: () => insertRowAt(span.end + 1),
              },
            ];
          })()}
        />
      )}

      {pendingMove && (
        <ConfirmDialog
          title="Move rows"
          message={
            <>
              This move puts a track at the very bottom of the set, and a track's{" "}
              <strong>BPM, Key, T #, A #</strong> and <strong>OUT TRACK TIMING</strong>{" "}
              are stored on the row below it — so there is nowhere left to keep
              them and they would be lost.
              <br />
              <br />
              Adding ten rows to the end gives that track a row below it, and
              nothing is dropped.
            </>
          }
          confirmLabel="Add 10 rows"
          cancelLabel="Cancel"
          onConfirm={() => {
            const p = pendingMove;
            setPendingMove(null);
            applyMove(p.start, p.len, p.gap, p.sel, 10);
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}

      {confirmArchive && (
        <ConfirmDialog
          title="Archive Set"
          message={`Archive "${name}"? It moves to Archived and can be restored anytime.`}
          confirmLabel="Archive"
          onConfirm={() => void doArchive()}
          onCancel={() => setConfirmArchive(false)}
        />
      )}

      {exportOpen && (
        <ExportDialog
          setId={id}
          setName={name}
          exportFilename={exportFilename}
          keyDisplayAs={display.key_display_as}
          onClose={() => setExportOpen(false)}
          onExported={(fn) => {
            // An edited name is remembered per set; reflect it locally so a
            // re-open pre-fills the same name.
            setExportFilename(fn);
            toast(`Exported ${fn}`, "success");
          }}
        />
      )}
    </div>
  );
}
