/**
 * S2 Set Editor — per-set, session-scoped undo history (§5.2 / §7.3).
 *
 * Covers cell edits, formatting, reorder, and row insert/delete by
 * snapshotting `{rows, formatting}` (both are small immutable arrays).
 * Histories live in a module-level map keyed by set id, so they survive
 * navigation within the session; they are never persisted (§4.1).
 */

import type { SetFormatting, SetRow } from "../../lib/api";

export interface EditorSnapshot {
  rows: SetRow[];
  formatting: SetFormatting;
}

const LIMIT = 200;

export class UndoHistory {
  private past: EditorSnapshot[] = [];
  private future: EditorSnapshot[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Record the state as it was BEFORE a mutation. Clears the redo stack. */
  record(before: EditorSnapshot): void {
    this.past.push(before);
    if (this.past.length > LIMIT) this.past.shift();
    this.future = [];
  }

  /** Pop the previous state; `current` becomes redoable. Null when empty. */
  undo(current: EditorSnapshot): EditorSnapshot | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: EditorSnapshot): EditorSnapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

const histories = new Map<string, UndoHistory>();

/** Session-scoped history for a set — survives navigating away and back. */
export function historyFor(setId: string): UndoHistory {
  let h = histories.get(setId);
  if (!h) {
    h = new UndoHistory();
    histories.set(setId, h);
  }
  return h;
}
