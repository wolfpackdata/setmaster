/**
 * S3 filter drawer — the "FX channel" (track-playlist-matrix.md §5).
 * Right-side drawer, table stays visible beside it. Nine filter lines in spec
 * order, each with an ON toggle at the far left (off by default; toggling off
 * retains values). Live preview match count; the TABLE updates only on Apply.
 * Quick-sort segmented control at the bottom (BPM default).
 *
 * Keyboard (explicit Ry requirement): Tab moves through the text-editable
 * fields in line order — toggles, the Camelot wheel, slider handles and
 * segmented buttons are pointer targets with tabIndex={-1}.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import type { KeyNotation } from "../../lib/keys";
import { CANONICAL_KEYS, type CanonicalKey } from "../../lib/keys";
import { CamelotWheel } from "./CamelotWheel";
import { RangeSlider } from "./RangeSlider";
import { PlaylistCombo } from "./PlaylistCombo";
import { MatrixIcon } from "./MatrixIcons";
import { composeBreadcrumb, type BreadcrumbCtx } from "./breadcrumb";
import { countMatches, type PreparedMatrix } from "./filtering";
import {
  columnsWithoutMirroredLines,
  QUICK_SORTS,
  type DrawerLines,
  type MatrixFilterState,
} from "./filterState";
import { useMatrixStore, type DrawerDraft } from "./matrixStore";
import {
  activePresetIndex,
  loadBpmPresets,
  saveBpmPresets,
  updatePresetAt,
  validateBpmPreset,
  type BpmPreset,
} from "./bpmPresets";

/**
 * Live-apply (Skip Apply, issue #9) commit design:
 *   • Value edits (number/text/date inputs, slider drag) DEBOUNCE by this many
 *     ms so keystroke/drag churn doesn't thrash #8's drawer→column mirroring on
 *     every character.
 *   • Discrete gestures (ON toggles, Camelot keys, Show-all/Clear, playlist
 *     pick, quick-sort) commit IMMEDIATELY — one deliberate action, no churn.
 * Every path commits through the store's single `applyDraft`, so the #8 mirror
 * stays the sole source of truth.
 */
const LIVE_APPLY_DEBOUNCE_MS = 300;

/** Tooltip shown on the disabled Apply button while Auto-Apply is on (issue #9). */
const SKIP_APPLY_TOOLTIP = "Auto-Apply enabled";

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const numVal = (v: number | null): string => (v == null ? "" : String(v));

interface LineProps {
  label: string;
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/** One FX-slot line: ON toggle far left (like FX-slot enable), label, controls. */
function Line({ label, on, onToggle, children }: LineProps) {
  return (
    <div className={`mx-line${on ? "" : " mx-line--off"}`}>
      <button
        type="button"
        className={`mx-line__on${on ? " mx-line__on--on" : ""}`}
        tabIndex={-1}
        role="switch"
        aria-checked={on}
        aria-label={`${label} filter ${on ? "on" : "off"}`}
        onClick={onToggle}
      >
        ON
      </button>
      <div className="mx-line__body">
        <div className="mx-line__label">{label}</div>
        <div className="mx-line__controls">{children}</div>
      </div>
    </div>
  );
}

export function FilterDrawer({
  prep,
  notation,
  ctx,
}: {
  prep: PreparedMatrix;
  notation: KeyNotation;
  ctx: BreadcrumbCtx;
}) {
  const draft = useMatrixStore((s) => s.draft);
  const setDraft = useMatrixStore((s) => s.setDraft);
  const applyDraft = useMatrixStore((s) => s.applyDraft);
  const resetDrawerLines = useMatrixStore((s) => s.resetDrawerLines);
  const closeDrawer = useMatrixStore((s) => s.closeDrawer);
  const appliedColumns = useMatrixStore((s) => s.applied.columns);
  const skipApply = useMatrixStore((s) => s.skipApply);
  const setSkipApply = useMatrixStore((s) => s.setSkipApply);

  // openDrawer() always seeds the draft before the drawer renders.
  if (!draft) return null;
  return (
    <FilterDrawerBody
      prep={prep}
      notation={notation}
      ctx={ctx}
      draft={draft}
      setDraft={setDraft}
      applyDraft={applyDraft}
      resetDrawerLines={resetDrawerLines}
      closeDrawer={closeDrawer}
      appliedColumns={appliedColumns}
      skipApply={skipApply}
      setSkipApply={setSkipApply}
    />
  );
}

function FilterDrawerBody({
  prep,
  notation,
  ctx,
  draft,
  setDraft,
  applyDraft,
  resetDrawerLines,
  closeDrawer,
  appliedColumns,
  skipApply,
  setSkipApply,
}: {
  prep: PreparedMatrix;
  notation: KeyNotation;
  ctx: BreadcrumbCtx;
  draft: DrawerDraft;
  setDraft: (d: DrawerDraft) => void;
  applyDraft: () => void;
  resetDrawerLines: () => void;
  closeDrawer: () => void;
  appliedColumns: MatrixFilterState["columns"];
  skipApply: boolean;
  setSkipApply: (v: boolean) => void;
}) {
  const d = draft.drawer;

  // Live-apply (Skip Apply, issue #9). `applyDraft` reads the store's current
  // draft, which `setDraft` has already committed synchronously by the time we
  // schedule — so an immediate commit sees the just-typed value, and a debounced
  // one sees whatever the latest draft is when the timer fires.
  const debounceRef = useRef<number | null>(null);
  const clearPending = useCallback(() => {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);
  const liveApply = useCallback(
    (immediate: boolean) => {
      if (!skipApply) return;
      clearPending();
      if (immediate) {
        applyDraft();
      } else {
        debounceRef.current = window.setTimeout(() => {
          debounceRef.current = null;
          applyDraft();
        }, LIVE_APPLY_DEBOUNCE_MS);
      }
    },
    [skipApply, applyDraft, clearPending],
  );
  // Drop any pending debounce if live-apply turns off or the drawer unmounts.
  useEffect(() => {
    if (!skipApply) clearPending();
    return clearPending;
  }, [skipApply, clearPending]);

  /**
   * Patch one line; editing a value auto-arms the line (`on` explicit wins).
   * `immediate` chooses the live-apply commit style (debounced value edit vs.
   * immediate discrete gesture) when Skip Apply is on; a no-op otherwise.
   */
  function patchLine<K extends keyof DrawerLines>(
    line: K,
    patch: Partial<DrawerLines[K]>,
    arm = true,
    immediate = false,
  ) {
    setDraft({
      ...draft,
      drawer: {
        ...d,
        [line]: { ...d[line], ...(arm ? { on: true } : {}), ...patch },
      } as DrawerLines,
    });
    liveApply(immediate);
  }

  const toggle = (line: keyof DrawerLines) => {
    // Arming the key wheel with nothing selected would match zero rows —
    // start from "all keys" (the §6 example sentence) and let the user prune.
    if (line === "keys" && !d.keys.on && d.keys.selected.length === 0) {
      patchLine("keys", { on: true, selected: [...CANONICAL_KEYS] }, false, true);
      return;
    }
    patchLine(line, { on: !d[line].on } as Partial<DrawerLines[typeof line]>, false, true);
  };

  /** Quick-sort pick: commits instantly under Skip Apply (issue #9). */
  const pickQuickSort = (id: string) => {
    setDraft({ ...draft, quickSort: id });
    liveApply(true);
  };

  // What the table WOULD show on Apply: draft lines + the already-applied
  // column filters (one unified state — §4). The mappable columns' OWNED fields
  // are stripped here because the draft drawer lines re-supply them — the draft
  // is the live editing surface for those dimensions, so counting both would
  // double-AND a mirrored filter (issue #8 single-source-of-truth invariant).
  // Sort is irrelevant to the count.
  const previewColumns = useMemo(
    () => columnsWithoutMirroredLines(appliedColumns),
    [appliedColumns],
  );
  const previewState = useMemo<MatrixFilterState>(
    // The drawer preview counts ONLY the draft drawer/column filters; the
    // free-text search box (issue #15) is a separate top-of-screen concern, so
    // it is deliberately excluded here (search "") — editing BPM should not make
    // the drawer's own "N tracks" preview jump because of what is typed above.
    () => ({ drawer: d, columns: previewColumns, sort: [], search: "" }),
    [d, previewColumns],
  );
  const previewCount = useMemo(
    () => countMatches(prep, previewState, notation),
    [prep, previewState, notation],
  );

  // Live sentence preview (§6: composed as lines are toggled/edited).
  const sentence = useMemo(
    () => composeBreadcrumb(previewState, ctx),
    [previewState, ctx],
  );

  const toggleKey = (key: CanonicalKey) => {
    const has = d.keys.selected.includes(key);
    patchLine(
      "keys",
      {
        selected: has
          ? d.keys.selected.filter((k) => k !== key)
          : [...d.keys.selected, key],
      },
      true,
      true,
    );
  };

  // BPM preset hot buttons (issue #75, ruling R6). Names/ranges are USER PREFS
  // in localStorage — deliberately OUTSIDE the serializable filter state. A
  // preset click just writes two numbers into the existing BPM line, so #8
  // mirroring / breadcrumb / export filename are unaffected. Local component
  // state seeded from localStorage; edits persist immediately (survive restart).
  const [bpmPresets, setBpmPresets] = useState<BpmPreset[]>(loadBpmPresets);
  const activePreset = activePresetIndex(bpmPresets, d.bpm.min, d.bpm.max);
  // The preset currently open in the pencil editor (null = none). editForm holds
  // the raw string fields so invalid intermediate input is allowed while typing.
  const [editingPreset, setEditingPreset] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", min: "", max: "" });
  const [editError, setEditError] = useState<string | null>(null);
  // The editor is an anchored popover; a click anywhere outside it cancels (as
  // does Esc). Capture-phase so it beats the drawer's own pointer handlers, and
  // it only runs while an editor is open.
  const editPopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editingPreset == null) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (editPopRef.current && !editPopRef.current.contains(e.target as Node)) {
        setEditingPreset(null);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true);
  }, [editingPreset]);

  /** Apply a preset: write its range into the BPM line + arm it (discrete
   * gesture → commits immediately under Auto-Apply, like a toggle, not debounced). */
  const applyPreset = (p: BpmPreset) => {
    patchLine("bpm", { on: true, min: p.min, max: p.max }, false, true);
  };

  const openPresetEditor = (i: number) => {
    const p = bpmPresets[i];
    setEditForm({ name: p.name, min: String(p.min), max: String(p.max) });
    setEditError(null);
    setEditingPreset(i);
  };

  const savePresetEditor = () => {
    if (editingPreset == null) return;
    const res = validateBpmPreset(editForm.name, editForm.min, editForm.max);
    if (!res.ok) {
      setEditError(res.error);
      return;
    }
    const next = updatePresetAt(bpmPresets, editingPreset, res.preset);
    setBpmPresets(next);
    saveBpmPresets(next); // persist to localStorage → survives app restart
    setEditingPreset(null);
  };

  /** Enter (from any field) saves; Esc cancels — as does the Cancel button or a
   * click outside the popover (issue #75 follow-up). */
  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      savePresetEditor();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditingPreset(null);
    }
  };

  return (
    <aside className="mx-drawer" aria-label="Filters">
      <div className="mx-drawer__header">
        <span className="mx-line__label">Filters</span>
        <button
          type="button"
          className="mx-crumb__clear"
          aria-label="Close filters"
          onClick={closeDrawer}
        >
          <MatrixIcon name="close" size={14} />
        </button>
      </div>

      <div className="mx-drawer__body">
        {/* 1 — One Playlist */}
        <Line label="One Playlist" on={d.playlist.on} onToggle={() => toggle("playlist")}>
          <PlaylistCombo
            prep={prep}
            path={d.playlist.path}
            onPick={(path) => patchLine("playlist", { path }, true, true)}
          />
        </Line>

        {/* 2 — BPM range: preset hot buttons (§75), then min + max fields + slider */}
        <Line label="BPM Range" on={d.bpm.on} onToggle={() => toggle("bpm")}>
          <div className="mx-bpm-presets" role="group" aria-label="BPM range presets">
            {bpmPresets.map((p, i) => (
              <div className="mx-bpm-preset" key={i}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={`mx-bpm-preset__btn${
                    activePreset === i ? " mx-bpm-preset__btn--on" : ""
                  }`}
                  aria-pressed={activePreset === i}
                  onClick={() => applyPreset(p)}
                >
                  <span className="mx-bpm-preset__name">{p.name}</span>
                  <span className="mx-bpm-preset__range">
                    {p.min}–{p.max}
                  </span>
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  className="mx-bpm-preset__edit"
                  aria-label={`Edit ${p.name} preset`}
                  onClick={() => openPresetEditor(i)}
                >
                  <MatrixIcon name="pencil" size={12} />
                </button>
                {editingPreset === i && (
                  <div
                    className={`mx-bpm-edit-pop${
                      i >= Math.ceil(bpmPresets.length / 2)
                        ? " mx-bpm-edit-pop--right"
                        : ""
                    }`}
                    ref={editPopRef}
                    role="dialog"
                    aria-label={`Edit ${p.name} preset`}
                    onKeyDown={onEditorKeyDown}
                  >
                    <input
                      className="input mx-bpm-edit__name"
                      type="text"
                      autoFocus
                      aria-label={`Preset ${i + 1} name`}
                      placeholder="name"
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    />
                    <div className="mx-bpm-edit__row">
                      <input
                        className="input mx-bpm-edit__num"
                        type="text"
                        inputMode="decimal"
                        aria-label={`Preset ${i + 1} min`}
                        placeholder="min"
                        value={editForm.min}
                        onChange={(e) => setEditForm((f) => ({ ...f, min: e.target.value }))}
                      />
                      <span className="mx-line__dash">–</span>
                      <input
                        className="input mx-bpm-edit__num"
                        type="text"
                        inputMode="decimal"
                        aria-label={`Preset ${i + 1} max`}
                        placeholder="max"
                        value={editForm.max}
                        onChange={(e) => setEditForm((f) => ({ ...f, max: e.target.value }))}
                      />
                    </div>
                    {editError && <div className="mx-bpm-edit__error">{editError}</div>}
                    <div className="mx-bpm-edit__btns">
                      <Button size="sm" variant="primary" onClick={savePresetEditor}>
                        Save
                      </Button>
                      <Button size="sm" onClick={() => setEditingPreset(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <input
            className="input mx-line__num"
            type="number"
            inputMode="decimal"
            aria-label="BPM min"
            placeholder="min"
            value={numVal(d.bpm.min)}
            onChange={(e) => patchLine("bpm", { min: numOrNull(e.target.value) })}
          />
          <RangeSlider
            domainMin={prep.bpmMin}
            domainMax={prep.bpmMax}
            min={d.bpm.min}
            max={d.bpm.max}
            onChange={(min, max) => patchLine("bpm", { min, max })}
          />
          <input
            className="input mx-line__num"
            type="number"
            inputMode="decimal"
            aria-label="BPM max"
            placeholder="max"
            value={numVal(d.bpm.max)}
            onChange={(e) => patchLine("bpm", { max: numOrNull(e.target.value) })}
          />
        </Line>

        {/* 3 — Keys to show: Camelot wheel graphic (§11.6) */}
        <Line label="Keys To Show" on={d.keys.on} onToggle={() => toggle("keys")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            <CamelotWheel
              selected={d.keys.selected}
              notation={notation}
              onToggle={toggleKey}
            />
            <div className="mx-wheelbtns">
              <Button
                size="sm"
                tabIndex={-1}
                onClick={() =>
                  patchLine("keys", { selected: [...CANONICAL_KEYS] }, true, true)
                }
              >
                Show All Keys
              </Button>
              <Button
                size="sm"
                tabIndex={-1}
                onClick={() => patchLine("keys", { selected: [] }, true, true)}
              >
                Clear All
              </Button>
            </div>
          </div>
        </Line>

        {/* 4 — Release year: min + max YEAR fields (§11.4) */}
        <Line
          label="Release Year"
          on={d.releaseYear.on}
          onToggle={() => toggle("releaseYear")}
        >
          <input
            className="input mx-line__year"
            type="number"
            inputMode="numeric"
            aria-label="Release year from"
            placeholder="from"
            value={numVal(d.releaseYear.min)}
            onChange={(e) => patchLine("releaseYear", { min: numOrNull(e.target.value) })}
          />
          <span className="mx-line__dash">–</span>
          <input
            className="input mx-line__year"
            type="number"
            inputMode="numeric"
            aria-label="Release year to"
            placeholder="to"
            value={numVal(d.releaseYear.max)}
            onChange={(e) => patchLine("releaseYear", { max: numOrNull(e.target.value) })}
          />
        </Line>

        {/* 5 — Import date: min + max full-date fields */}
        <Line
          label="Import Date"
          on={d.importDate.on}
          onToggle={() => toggle("importDate")}
        >
          <input
            className="input mx-line__date"
            type="date"
            aria-label="Import date from"
            value={d.importDate.min}
            onChange={(e) => patchLine("importDate", { min: e.target.value })}
          />
          <span className="mx-line__dash">–</span>
          <input
            className="input mx-line__date"
            type="date"
            aria-label="Import date to"
            value={d.importDate.max}
            onChange={(e) => patchLine("importDate", { max: e.target.value })}
          />
        </Line>

        {/* 6 — Artist Name contains */}
        <Line
          label="Artist Name Contains"
          on={d.artistContains.on}
          onToggle={() => toggle("artistContains")}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            type="text"
            aria-label="Artist Name contains"
            placeholder="e.g. Kaskade"
            value={d.artistContains.text}
            onChange={(e) => patchLine("artistContains", { text: e.target.value })}
          />
        </Line>

        {/* 7 — Track Name contains */}
        <Line
          label="Track Name Contains"
          on={d.trackContains.on}
          onToggle={() => toggle("trackContains")}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            type="text"
            aria-label="Track Name contains"
            placeholder="e.g. Remix"
            value={d.trackContains.text}
            onChange={(e) => patchLine("trackContains", { text: e.target.value })}
          />
        </Line>

        {/* 8 — On Super Playlist: min count (§11.3) */}
        <Line label="On Super Playlist" on={d.onRootPl.on} onToggle={() => toggle("onRootPl")}>
          <span className="mx-line__dash">at least</span>
          <input
            className="input mx-line__num"
            type="number"
            inputMode="numeric"
            min={0}
            aria-label="On Super Playlist minimum"
            placeholder="min"
            value={numVal(d.onRootPl.min)}
            onChange={(e) => patchLine("onRootPl", { min: numOrNull(e.target.value) })}
          />
        </Line>

        {/* 9 — On Non-Super Playlist: min + max so "= 0" is expressible (§11.3) */}
        <Line
          label="On Non-Super Playlist"
          on={d.onNonRootPl.on}
          onToggle={() => toggle("onNonRootPl")}
        >
          <input
            className="input mx-line__num"
            type="number"
            inputMode="numeric"
            min={0}
            aria-label="On Non-Super Playlist minimum"
            placeholder="min"
            value={numVal(d.onNonRootPl.min)}
            onChange={(e) => patchLine("onNonRootPl", { min: numOrNull(e.target.value) })}
          />
          <span className="mx-line__dash">–</span>
          <input
            className="input mx-line__num"
            type="number"
            inputMode="numeric"
            min={0}
            aria-label="On Non-Super Playlist maximum"
            placeholder="max"
            value={numVal(d.onNonRootPl.max)}
            onChange={(e) => patchLine("onNonRootPl", { max: numOrNull(e.target.value) })}
          />
        </Line>

        {/* Quick sort (§5 bottom of drawer) — single choice, applied with Apply */}
        <div className="mx-line">
          <span style={{ width: 26 }} aria-hidden="true" />
          <div className="mx-line__body">
            <div className="mx-line__label">Quick Sort</div>
            <div className="mx-quicksort" role="radiogroup" aria-label="Quick sort">
              {QUICK_SORTS.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  tabIndex={-1}
                  role="radio"
                  aria-checked={draft.quickSort === q.id}
                  className={`mx-quicksort__opt${
                    draft.quickSort === q.id ? " mx-quicksort__opt--on" : ""
                  }`}
                  onClick={() => pickQuickSort(q.id)}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-drawer__footer">
        <div className="mx-drawer__preview" aria-live="polite">
          Would match{" "}
          <strong>{previewCount.toLocaleString("en-US")}</strong>{" "}
          {previewCount === 1 ? "track" : "tracks"}
        </div>
        {sentence.length > 0 && (
          <div className="mx-drawer__sentence">
            {sentence.map((c, i) =>
              c.strong ? <strong key={i}>{c.text}</strong> : <span key={i}>{c.text}</span>,
            )}
          </div>
        )}
        <label className="mx-drawer__skipapply">
          <input
            type="checkbox"
            checked={skipApply}
            onChange={(e) => {
              const on = e.target.checked;
              setSkipApply(on);
              // Turning live-apply ON commits the current draft at once so the
              // table immediately reflects what the drawer shows (issue #9).
              if (on) applyDraft();
            }}
          />
          <span>Auto-Apply</span>
        </label>
        <div className="mx-drawer__buttons">
          {/* Tooltip lives on the wrapper: a disabled <button> swallows hover
              events, so `title` on the button itself would never show (#9). */}
          <span
            className="mx-drawer__apply-wrap"
            title={skipApply ? SKIP_APPLY_TOOLTIP : undefined}
          >
            <Button variant="primary" onClick={applyDraft} disabled={skipApply}>
              Apply
            </Button>
          </span>
          <Button onClick={resetDrawerLines}>Reset</Button>
          <Button variant="ghost" onClick={closeDrawer}>
            Close
          </Button>
        </div>
      </div>
    </aside>
  );
}
