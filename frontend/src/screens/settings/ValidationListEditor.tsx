import { useState } from "react";
import {
  getValidationUsage,
  putValidationList,
  renameValidationValue,
  resetValidationList,
  type ValidationField,
} from "../../lib/api";
import { graphemeCount, isSingleEmoji } from "../../lib/emoji";
import { Button } from "../../components/Button";
import { Stepper } from "../../components/Stepper";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useUiStore } from "../../store/uiStore";

/**
 * Factory defaults per field — the prototype workbook's `load`-tab lists
 * (advanced-settings-validation-lists.md §2). Used only for the Reset confirm
 * copy; the reset itself is server-side (POST …/reset).
 */
export const FACTORY_LISTS: Record<ValidationField, string[]> = {
  // #163 — the narrow factory range, ascending, `0` included. The wider
  // [-12, +12] a user may add within is the Add control's constraint below, not
  // the default. Kept in step with `backend/app/defaults.py`; this copy only
  // feeds the Reset confirm copy, the reset itself is server-side.
  delta: ["-1.5", "-1", "-0.5", "0", "+0.5", "+1", "+1.5"],
  lows: ["cut", "cut-swell", "open", "0.5"],
  level: ["silence", "open", "HOT", "HOT-LP", "LP", "HP", "LP-silence", "HP-silence"],
  i_like: ["🚀", "💜", "✔️", "⚠️", "🟥"],
};

/** Format a Δ number with explicit sign (spec §2: `+1.5`, `-0.5`). */
function formatDelta(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}

/**
 * Per-field Add/Rename constraint validation (spec §2). Returns the
 * normalized value to store, or an error message.
 */
function validateValue(
  field: ValidationField,
  raw: string,
  existing: string[],
): { value: string } | { error: string } {
  if (field === "delta") {
    const trimmed = raw.trim();
    const n = Number(trimmed);
    if (trimmed === "" || Number.isNaN(n)) return { error: "Δ must be a number." };
    if (Math.round(n * 2) !== n * 2) return { error: "Δ must be a multiple of 0.5." };
    if (n < -12 || n > 12) return { error: "Δ must be between −12 and +12." };
    const value = formatDelta(n);
    if (existing.includes(value)) return { error: `${value} is already in the list.` };
    return { value };
  }
  if (field === "i_like") {
    const value = raw.trim();
    if (!isSingleEmoji(value)) {
      return { error: "Must be exactly one emoji (letters, digits and punctuation are not allowed)." };
    }
    if (existing.includes(value)) return { error: `${value} is already in the list.` };
    return { value };
  }
  // lows / level: any text, ≤16 grapheme clusters, non-empty, unique (case-sensitive).
  const value = raw.trim();
  if (!value) return { error: "Value cannot be empty." };
  if (graphemeCount(value) > 16) return { error: "Max 16 characters." };
  if (existing.includes(value)) return { error: `"${value}" is already in the list.` };
  return { value };
}

type Confirm =
  | { kind: "remove"; value: string; count: number }
  | { kind: "reset" }
  | null;

/**
 * One editable validation list (S6 → Advanced Settings, spec §4): reorderable
 * value list (drag handles), inline click-to-edit rename (propagates to all
 * rows in all sets), remove with usage-count confirm, constrained Add control
 * (Δ = 0.5-step stepper clamped ±12; I like = single-emoji input), and a
 * Reset-to-factory button with confirm.
 */
export function ValidationListEditor({
  field,
  title,
  constraintHint,
  values,
  onRefresh,
}: {
  field: ValidationField;
  title: string;
  constraintHint: string;
  values: string[];
  /** Re-fetch all lists after any successful mutation. */
  onRefresh: () => Promise<void>;
}) {
  const toast = useUiStore((s) => s.toast);
  const [addDraft, setAddDraft] = useState("");
  const [deltaDraft, setDeltaDraft] = useState(0.5);
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ value: string; draft: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (op: () => Promise<void>) => {
    setBusy(true);
    try {
      await op();
      await onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const raw = field === "delta" ? formatDelta(deltaDraft) : addDraft;
    const result = validateValue(field, raw, values);
    if ("error" in result) {
      setAddError(result.error);
      return;
    }
    setAddError(null);
    setAddDraft("");
    void run(() => putValidationList(field, [...values, result.value]));
  };

  const commitRename = () => {
    if (!renaming) return;
    const { value, draft } = renaming;
    if (draft.trim() === value) {
      setRenaming(null);
      setRenameError(null);
      return;
    }
    const result = validateValue(field, draft, values.filter((v) => v !== value));
    if ("error" in result) {
      setRenameError(result.error);
      return;
    }
    setRenaming(null);
    setRenameError(null);
    void run(async () => {
      const { rows_updated } = await renameValidationValue(field, value, result.value);
      toast(
        `Renamed ${value} → ${result.value} (${rows_updated} row${rows_updated === 1 ? "" : "s"} updated).`,
        "success",
      );
    });
  };

  const requestRemove = (value: string) => {
    getValidationUsage(field, value)
      .then(({ count }) => setConfirm({ kind: "remove", value, count }))
      .catch((err) => toast(err instanceof Error ? err.message : String(err), "error"));
  };

  const drop = (target: number) => {
    if (dragIndex === null || dragIndex === target) {
      setDragIndex(null);
      return;
    }
    const next = [...values];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(target, 0, moved);
    setDragIndex(null);
    void run(() => putValidationList(field, next));
  };

  return (
    <div className="vle">
      <div className="vle__header">
        <div>
          <div className="ni-label">{title}</div>
          <div className="small" style={{ marginTop: 2 }}>{constraintHint}</div>
        </div>
        <Button size="sm" disabled={busy} onClick={() => setConfirm({ kind: "reset" })}>
          Reset to factory
        </Button>
      </div>

      <ul className="vle__list">
        {values.map((value, i) => (
          <li
            key={value}
            className={`vle__row${dragIndex === i ? " vle__row--dragging" : ""}`}
            draggable={renaming?.value !== value}
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(i)}
            onDragEnd={() => setDragIndex(null)}
          >
            <span className="vle__handle" title="Drag to reorder" aria-hidden>
              ⋮⋮
            </span>
            {renaming?.value === value ? (
              <span style={{ flex: 1 }}>
                <input
                  className="input"
                  value={renaming.draft}
                  autoFocus
                  aria-label={`Rename ${value}`}
                  onChange={(e) => setRenaming({ value, draft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") {
                      setRenaming(null);
                      setRenameError(null);
                    }
                  }}
                  onBlur={commitRename}
                />
                {renameError && <span className="field__error">{renameError}</span>}
              </span>
            ) : (
              <button
                type="button"
                className="vle__value"
                title="Click to rename — the new name propagates to every row using this value"
                disabled={busy}
                onClick={() => {
                  setRenameError(null);
                  setRenaming({ value, draft: value });
                }}
              >
                {value}
              </button>
            )}
            <button
              type="button"
              className="vle__remove"
              title={`Remove ${value} (existing cells keep it; it stops being offered)`}
              aria-label={`Remove ${value}`}
              disabled={busy}
              onClick={() => requestRemove(value)}
            >
              ✕
            </button>
          </li>
        ))}
        {values.length === 0 && (
          <li className="small muted" style={{ padding: "4px 0" }}>
            List is empty — add a value below or reset to factory.
          </li>
        )}
      </ul>

      <div className="vle__add">
        {field === "delta" ? (
          <>
            <Stepper
              value={deltaDraft}
              onChange={setDeltaDraft}
              min={-12}
              max={12}
              step={0.5}
              format={formatDelta}
              ariaLabel="New Δ value"
            />
            <Button size="sm" disabled={busy} onClick={add}>
              Add
            </Button>
          </>
        ) : (
          <>
            <input
              className="input"
              style={{ maxWidth: 200 }}
              value={addDraft}
              placeholder={field === "i_like" ? "Paste one emoji…" : "New value…"}
              aria-label={`Add ${title} value`}
              onChange={(e) => {
                setAddDraft(e.target.value);
                if (addError) setAddError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
            <Button size="sm" disabled={busy} onClick={add}>
              Add
            </Button>
          </>
        )}
      </div>
      {addError && <div className="field__error">{addError}</div>}

      {confirm?.kind === "remove" && (
        <ConfirmDialog
          title={`Remove ${confirm.value}`}
          message={
            confirm.count > 0
              ? `"${confirm.value}" is used in ${confirm.count} row${confirm.count === 1 ? "" : "s"}. Those cells keep their value — it just stops being offered in dropdowns. Remove it?`
              : `Remove "${confirm.value}" from the list? It is not used in any rows.`
          }
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const v = confirm.value;
            setConfirm(null);
            void run(() =>
              putValidationList(field, values.filter((x) => x !== v)),
            );
          }}
        />
      )}

      {confirm?.kind === "reset" && (
        <ConfirmDialog
          title={`Reset ${title} to factory`}
          message={`Replace the ${title} list with the factory settings? Afterwards the offered values will be: ${FACTORY_LISTS[field].join(", ")}. Existing rows are untouched; custom values still in use stay in place but stop being offered.`}
          confirmLabel="Reset to factory"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void run(async () => {
              await resetValidationList(field);
            });
          }}
        />
      )}
    </div>
  );
}
