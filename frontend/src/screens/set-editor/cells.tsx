/**
 * S2 Set Editor — cell display renderer + the four inline editors
 * (text, enum dropdown, In Track typeahead, I-like emoji).
 *
 * Editors stop keyboard propagation so the grid's navigation layer never
 * double-handles keys; commit direction ("down"/"right"/…) is decided here
 * per §5.2 (Enter commits+down, Tab commits+right, Esc cancels).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { searchTracks, type TrackSearchHit, type KeyDisplayAs, type ValidationLists } from "../../lib/api";
import { formatKey, keyColor } from "../../lib/keys";
import { isSingleEmoji } from "../../lib/emoji";
import {
  enumOptions,
  isHotLevel,
  isLegacyEnumValue,
  EMPTY_ENUM,
  type ColumnDef,
} from "./columns";
import { bpmDirection, canonicalizeKey, parseNameTags } from "./model";

/**
 * Where the selection lands after an editor commits. `up` is Shift+Enter
 * (#137) — Enter's mirror image.
 */
export type CommitMove = "down" | "up" | "right" | "left" | "none";

/**
 * Commit direction for an Enter keypress inside an editor (#137): Shift+Enter
 * commits and moves to the cell ABOVE, plain Enter commits and moves down.
 * Shared by all four editors so the shortcut cannot work in some columns only.
 */
export const enterMove = (shiftKey: boolean): CommitMove =>
  shiftKey ? "up" : "down";

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function NameContent({ name }: { name: string }) {
  const parsed = parseNameTags(name);
  if (parsed.tags.length === 0) {
    return <span className="se-ellip">{name}</span>;
  }
  return (
    <span className="se-ellip">
      {parsed.tags.map((tag, i) => (
        <span key={`${tag}-${i}`} className="se-tagchip">
          {tag}
        </span>
      ))}
      {parsed.text}
    </span>
  );
}

/**
 * Ellipsised text that exposes its full value as a hover tooltip ONLY when it
 * is actually cut off (#135) — never for text that already fits, which would
 * turn every cell into a tooltip.
 *
 * Truncation depends on the rendered box, so it is measured rather than
 * guessed, and re-measured two ways: after every render (value edits) and via a
 * ResizeObserver (Font Size, Spacing, sidebar drags and column show/hide all
 * resize the cell without re-rendering the memoized row).
 */
function TruncatedText({
  text,
  suppress,
}: {
  text: string;
  /** True while the cell's inline editor is open — the editor owns the cell. */
  suppress?: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [clipped, setClipped] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 1px of tolerance: sub-pixel layout can leave scrollWidth a hair over.
    const over = el.scrollWidth > el.clientWidth + 1;
    setClipped((prev) => (prev === over ? prev : over));
  }, []);

  useLayoutEffect(measure);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <span
      ref={ref}
      className="se-ellip"
      title={clipped && !suppress ? text : undefined}
    >
      {text}
    </span>
  );
}

const LEGACY_TITLE =
  "Legacy value — kept as-is, but no longer offered in this list (Settings → Advanced Settings)";

function LegacyMark() {
  return (
    <span className="se-legacy" title={LEGACY_TITLE} aria-label="legacy value">
      ◦
    </span>
  );
}

/**
 * Tooltip on the first row's read-only Out-side cells — OUT TRACK TIMING (#83)
 * and, since #165, BPM and Key. All four describe the Out Track, and row 1
 * hasn't got one.
 */
export const ROW1_OUT_SIDE_TIP =
  "The first row has no Out Track — these columns start on row 2.";

export interface CellDisplayProps {
  col: ColumnDef;
  value: string;
  lists: ValidationLists;
  keyDisplayAs: KeyDisplayAs;
  colorfulKeys: boolean;
  /** §7.1 ghost text — first empty row's In Track Name only. */
  ghost?: boolean;
  /**
   * #83, widened by #165 — this is a first-row Out-side cell (read-only): OUT
   * TRACK TIMING, BPM or Key. Render a muted em-dash placeholder (distinct from
   * the `---` empty-enum text) with a tip, or, when a legacy value survives, the
   * value rendered muted with the same tip. Never lose data: the value is only
   * display-muted, never altered — which is also why BPM and Key keep rendering
   * a value that was typed before #165 made them read-only.
   */
  readonlyOutSide?: boolean;
  /**
   * #135 — the cell's inline editor is open. CellDisplay still renders beneath
   * it, so the truncation tooltip is suppressed while editing.
   */
  editing?: boolean;
  /** #138 — the BPM of the row ABOVE, for the direction arrow. */
  prevBpm?: string;
}

/** Non-editing cell content per column semantics (§5.2). */
export function CellDisplay({
  col,
  value,
  lists,
  keyDisplayAs,
  colorfulKeys,
  ghost,
  readonlyOutSide,
  editing,
  prevBpm,
}: CellDisplayProps) {
  if (readonlyOutSide) {
    return (
      <span className="se-rocell" title={ROW1_OUT_SIDE_TIP}>
        {value ? value : "—"}
      </span>
    );
  }
  switch (col.id) {
    case "in_name":
      if (!value && ghost) {
        return <span className="se-ghost">Type the first track of the set…</span>;
      }
      return <NameContent name={value} />;
    case "out_name":
      return <NameContent name={value} />;
    case "key": {
      const trimmed = value.trim();
      if (!trimmed) return null;
      // Parseable in any of the 4 notations → render per Key Display As
      // (+ Colorful Keys); free text passes through untouched (§4.2).
      const canonical = canonicalizeKey(trimmed);
      const color = canonical ? keyColor(canonical, colorfulKeys) : null;
      return (
        <span style={color ? { color } : undefined}>
          {canonical ? formatKey(canonical, keyDisplayAs) : trimmed}
        </span>
      );
    }
    case "level": {
      if (!value) return <span className="se-empty">{EMPTY_ENUM}</span>;
      const legacy = isLegacyEnumValue("level", value, lists);
      return (
        <span style={isHotLevel(value) ? { color: "var(--brand-magenta)" } : undefined}>
          {value}
          {legacy && <LegacyMark />}
        </span>
      );
    }
    case "lows": {
      if (!value) return <span className="se-empty">{EMPTY_ENUM}</span>;
      return (
        <span>
          {value}
          {isLegacyEnumValue("lows", value, lists) && <LegacyMark />}
        </span>
      );
    }
    case "in_delta":
    case "out_delta": {
      if (!value || value === EMPTY_ENUM) {
        return <span className="se-empty">{EMPTY_ENUM}</span>;
      }
      const legacy =
        col.id === "in_delta" && isLegacyEnumValue("delta", value, lists);
      return (
        <span>
          {value}
          {legacy && <LegacyMark />}
        </span>
      );
    }
    case "t_num":
    case "a_num":
    case "m_num":
    case "swap_lows": {
      if (!value || value === EMPTY_ENUM) {
        return <span className="se-empty">{EMPTY_ENUM}</span>;
      }
      return (
        <span>
          {value}
          {isLegacyEnumValue("cue", value, lists) && <LegacyMark />}
        </span>
      );
    }
    case "bpm": {
      // #138 — a direction cue vs the row above. The number's own colour is
      // untouched; only the glyph carries the signal, and it renders in the
      // right-aligned cell's left slack so the digits never shift.
      const dir = bpmDirection(prevBpm, value);
      if (!dir) return value ? <span>{value}</span> : null;
      return (
        <>
          <span
            className={`se-bpmarrow se-bpmarrow--${dir}`}
            aria-label={dir === "up" ? "BPM higher than the row above" : "BPM lower than the row above"}
          >
            {dir === "up" ? "▲" : "▼"}
          </span>
          <span>{value}</span>
        </>
      );
    }
    case "i_like":
      return value ? <span className="se-emoji">{value}</span> : null;
    case "notes":
      // #135 — the only column whose text routinely outruns its cell.
      return value ? <TruncatedText text={value} suppress={editing} /> : null;
    default:
      return value ? <span className="se-ellip">{value}</span> : null;
  }
}

// ---------------------------------------------------------------------------
// Popover positioning (fixed, flips up near the viewport bottom)
// ---------------------------------------------------------------------------

const POP_MAX_HEIGHT = 240;

function usePopoverStyle(anchorRef: React.RefObject<HTMLElement | null>) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const cell = anchorRef.current?.closest(".se-cell");
    if (!cell) return;
    const rect = cell.getBoundingClientRect();
    const openUp = rect.bottom + POP_MAX_HEIGHT > window.innerHeight - 8;
    setStyle({
      position: "fixed",
      left: Math.min(rect.left, window.innerWidth - 260),
      minWidth: Math.max(rect.width, 120),
      maxHeight: POP_MAX_HEIGHT,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top }
        : { top: rect.bottom }),
    });
  }, [anchorRef]);
  return style;
}

// ---------------------------------------------------------------------------
// Text editor (BPM, Key, FX & Mix Notes, Start, Transition)
// ---------------------------------------------------------------------------

/** Default rejection message for the Start/Transition M:SS validator (#25). */
export const MSS_INVALID_MSG =
  "Enter a time as M:SS or a number — e.g. 1:30, 130, or 30.";

export interface TextEditorProps {
  initial: string;
  /** true → select-all (Enter/double-click); false → caret at end (type-over). */
  selectAll: boolean;
  align: "left" | "center" | "right";
  /** FX & Mix Notes is multiline (§4.2): Alt+Enter inserts a newline. */
  multiline?: boolean;
  /**
   * Opt-in commit-time validation (Start/Transition, §25). Returns the
   * canonical value to store, null to reject with `invalidMessage`, or
   * `{ error }` to reject with a specific message (#70 Start < Transition).
   * Blank always clears the cell without running the validator. On reject the
   * editor stays open, shows an inline message and re-selects the text
   * (mirrors the EmojiEditor pattern).
   */
  normalize?: (raw: string) => string | { error: string } | null;
  invalidMessage?: string;
  onCommit: (value: string, move: CommitMove) => void;
  onCancel: () => void;
}

export function TextEditor({
  initial,
  selectAll,
  align,
  multiline,
  normalize,
  invalidMessage = MSS_INVALID_MSG,
  onCommit,
  onCancel,
}: TextEditorProps) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  /** Active rejection message; null = valid. */
  const [invalid, setInvalid] = useState<string | null>(null);
  const [msgPos, setMsgPos] = useState<{ left: number; top: number } | null>(null);
  const done = useRef(false);

  // Anchor the rejection message under the cell with position:fixed so it
  // escapes the cell's overflow:hidden clip.
  useLayoutEffect(() => {
    if (!invalid) {
      setMsgPos(null);
      return;
    }
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      setMsgPos({
        left: Math.min(r.left, window.innerWidth - 230),
        top: r.bottom + 2,
      });
    }
  }, [invalid]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Resolve the value to store, or a rejection (blank clears the cell). */
  const resolve = (): string | { error: string } | null => {
    if (!normalize) return value;
    const trimmed = value.trim();
    if (trimmed === "") return "";
    return normalize(trimmed);
  };

  const commit = (move: CommitMove) => {
    if (done.current) return;
    const resolved = resolve();
    if (typeof resolved !== "string") {
      // Invalid — keep editing, flag it, re-select for an immediate retype.
      setInvalid(resolved === null ? invalidMessage : resolved.error);
      ref.current?.select();
      return;
    }
    done.current = true;
    onCommit(resolved, move);
  };

  const onKeyDown = (
    e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      if (multiline && e.altKey) {
        // Alt+Enter inserts a newline (Excel muscle memory for column P).
        e.preventDefault();
        const el = ref.current;
        const at = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? at;
        setValue(value.slice(0, at) + "\n" + value.slice(end));
        requestAnimationFrame(() => el?.setSelectionRange(at + 1, at + 1));
        return;
      }
      e.preventDefault();
      commit(enterMove(e.shiftKey));
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit(e.shiftKey ? "left" : "right");
    } else if (e.key === "Escape") {
      done.current = true;
      onCancel();
    }
  };

  // Blur can't keep the editor open; discard invalid input rather than store it.
  const onBlur = () => {
    if (done.current) return;
    if (typeof resolve() !== "string") {
      done.current = true;
      onCancel();
      return;
    }
    commit("none");
  };

  if (multiline) {
    return (
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        className="se-editor se-editor--area"
        style={{ textAlign: align }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        rows={1}
      />
    );
  }
  return (
    <>
      <input
        ref={ref as React.RefObject<HTMLInputElement>}
        className={`se-editor${invalid ? " invalid" : ""}`}
        style={{ textAlign: align }}
        title={invalid ?? undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {invalid && msgPos && (
        <div
          className="se-editor-msg"
          style={{ position: "fixed", left: msgPos.left, top: msgPos.top }}
          role="alert"
        >
          {invalid}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Enum dropdown editor (Δ, T/A/M #, Lows, Level, Swap Lows)
// ---------------------------------------------------------------------------

export interface EnumEditorProps {
  source: "delta" | "cue" | "lows" | "level";
  lists: ValidationLists;
  current: string;
  /** Type-over keystroke that opened the dropdown — pre-filters the list. */
  initialFilter: string;
  onSelect: (option: string, move: CommitMove) => void;
  onCancel: () => void;
}

export function EnumEditor({
  source,
  lists,
  current,
  initialFilter,
  onSelect,
  onCancel,
}: EnumEditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const popStyle = usePopoverStyle(wrapRef);
  const { options } = enumOptions(source, lists);
  const [filter, setFilter] = useState(initialFilter);

  const lowered = filter.toLowerCase();
  let filtered = lowered
    ? options.filter((o) => o.toLowerCase().startsWith(lowered))
    : options;
  if (lowered && filtered.length === 0) {
    filtered = options.filter((o) => o.toLowerCase().includes(lowered));
  }

  const currentIdx = filtered.findIndex(
    (o) => o === (current || EMPTY_ENUM),
  );
  const [hi, setHi] = useState(() => Math.max(currentIdx, 0));

  // Reset the highlight when the FILTER changes — not on mount (the initial
  // highlight is the cell's current value).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setHi(0);
  }, [filter]);

  useLayoutEffect(() => {
    wrapRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = wrapRef.current?.querySelector('[data-hi="1"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [hi, filter]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const pick = filtered[Math.min(hi, filtered.length - 1)];
      if (pick !== undefined) {
        onSelect(
          pick,
          e.key === "Tab"
            ? e.shiftKey
              ? "left"
              : "right"
            : enterMove(e.shiftKey),
        );
      } else {
        onCancel();
      }
    } else if (e.key === "Escape") {
      onCancel();
    } else if (e.key === "Backspace") {
      setFilter((f) => f.slice(0, -1));
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setFilter((f) => f + e.key);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="se-enumwrap"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) onCancel();
      }}
    >
      {popStyle && (
        <div className="se-pop" style={popStyle} role="listbox">
          {filter && <div className="se-pop__filter">{filter}</div>}
          {filtered.length === 0 && (
            <div className="se-pop__none">No matching value</div>
          )}
          {filtered.map((opt, i) => (
            <div
              key={opt}
              role="option"
              aria-selected={i === hi}
              data-hi={i === hi ? "1" : undefined}
              className={`se-pop__opt${i === hi ? " hi" : ""}${
                opt === (current || EMPTY_ENUM) ? " cur" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(opt, "none");
              }}
            >
              {opt === EMPTY_ENUM ? (
                <span className="se-empty">{EMPTY_ENUM}</span>
              ) : source === "level" && isHotLevel(opt) ? (
                // #136 — the option and the committed cell must never disagree
                // about which values read as hot.
                <span style={{ color: "var(--brand-magenta)" }}>{opt}</span>
              ) : (
                opt
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// In Track Name typeahead (§6.4 — inserts NAME TEXT ONLY, no binding)
// ---------------------------------------------------------------------------

export interface TypeaheadEditorProps {
  initial: string;
  selectAll: boolean;
  onCommit: (value: string, move: CommitMove) => void;
  onCancel: () => void;
}

export function TypeaheadEditor({
  initial,
  selectAll,
  onCommit,
  onCancel,
}: TypeaheadEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const popStyle = usePopoverStyle(inputRef);
  const [value, setValue] = useState(initial);
  const [hits, setHits] = useState<TrackSearchHit[] | null>(null);
  const [hi, setHi] = useState(-1);
  const done = useRef(false);
  const seq = useRef(0);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setHits(null);
      setHi(-1);
      return;
    }
    const mySeq = ++seq.current;
    const t = window.setTimeout(() => {
      searchTracks(q)
        .then((res) => {
          if (seq.current !== mySeq) return;
          setHits(res);
          setHi(-1);
        })
        .catch(() => {
          if (seq.current === mySeq) setHits(null);
        });
    }, 150);
    return () => window.clearTimeout(t);
  }, [value]);

  const commit = (v: string, move: CommitMove) => {
    if (done.current) return;
    done.current = true;
    onCommit(v, move);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "ArrowDown" && hits && hits.length > 0) {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, hits.length - 1));
    } else if (e.key === "ArrowUp" && hits && hits.length > 0) {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // §6.4: selecting a match inserts the NAME TEXT ONLY.
      commit(hits && hi >= 0 ? hits[hi].name : value, enterMove(e.shiftKey));
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit(hits && hi >= 0 ? hits[hi].name : value, e.shiftKey ? "left" : "right");
    } else if (e.key === "Escape") {
      if (hits) {
        setHits(null);
        setHi(-1);
      } else {
        done.current = true;
        onCancel();
      }
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        className="se-editor"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(value, "none")}
      />
      {hits && hits.length > 0 && popStyle && (
        <div className="se-pop se-pop--typeahead" style={popStyle} role="listbox">
          {hits.map((hit, i) => (
            <div
              key={`${hit.name} ${hit.artist} ${i}`}
              role="option"
              aria-selected={i === hi}
              className={`se-pop__opt${i === hi ? " hi" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(hit.name, "none");
              }}
            >
              <span className="se-ellip">{hit.name}</span>
              <span className="se-pop__artist">{hit.artist}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// I like emoji editor (§6.5 — quick-pick of the I-like list + free entry
// validated to a single emoji grapheme)
// ---------------------------------------------------------------------------

export interface EmojiEditorProps {
  initial: string;
  quickPick: string[];
  onCommit: (value: string, move: CommitMove) => void;
  onCancel: () => void;
}

export function EmojiEditor({ initial, quickPick, onCommit, onCancel }: EmojiEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const popStyle = usePopoverStyle(inputRef);
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const done = useRef(false);

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const tryCommit = (move: CommitMove) => {
    if (done.current) return;
    const v = value.trim();
    if (v === "" || isSingleEmoji(v)) {
      done.current = true;
      onCommit(v, move);
    } else {
      setInvalid(true);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      tryCommit(enterMove(e.shiftKey));
    } else if (e.key === "Tab") {
      e.preventDefault();
      tryCommit(e.shiftKey ? "left" : "right");
    } else if (e.key === "Escape") {
      done.current = true;
      onCancel();
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        className={`se-editor se-editor--emoji${invalid ? " invalid" : ""}`}
        title={invalid ? "Enter a single emoji" : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // Quick-pick mousedown commits first; don't cancel it from blur.
          if (done.current) return;
          const v = value.trim();
          if (v === "" || isSingleEmoji(v)) {
            done.current = true;
            onCommit(v, "none");
          } else {
            done.current = true;
            onCancel();
          }
          void e;
        }}
      />
      {popStyle && (
        <div className="se-pop se-pop--emoji" style={popStyle}>
          {quickPick.map((emo) => (
            <button
              key={emo}
              type="button"
              className="se-pop__emoji"
              onMouseDown={(e) => {
                e.preventDefault();
                done.current = true;
                onCommit(emo, "none");
              }}
            >
              {emo}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
