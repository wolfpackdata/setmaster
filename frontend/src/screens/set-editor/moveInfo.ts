/**
 * S2 Set Editor — "How to use Move" info-tooltip copy (issue #26).
 *
 * The copy is kept here as structured, plain-text-recoverable segments so it
 * can be asserted verbatim in a unit test (the grid is only render-tested
 * indirectly — the repo runs vitest in a node environment with no DOM/RTL).
 * Each segment is plain text; `strong` marks the key-combo emphasis the
 * SetEditorScreen toolbar renders as <strong>.
 *
 * Behaviour facts are verified against the real handlers in SetEditorScreen:
 * Shift+arrows / Shift+click extend the selection, ↑/↓ move the block while
 * Move is on, Esc turns Move off, and Alt+↑/↓ moves the block even with Move
 * off.
 */

export interface MoveInfoSegment {
  text: string;
  strong?: boolean;
}

export const MOVE_INFO_TITLE = "Move rows";

export const MOVE_INFO_STEPS: readonly (readonly MoveInfoSegment[])[] = [
  [{ text: "Click a cell in the row you want to move." }],
  [
    { text: "Select more rows with " },
    { text: "Shift + Arrow keys", strong: true },
    { text: " or " },
    { text: "Shift + click", strong: true },
    { text: "." },
  ],
  [{ text: "Turn " }, { text: "Move", strong: true }, { text: " on." }],
  [
    { text: "Press " },
    { text: "↑ / ↓", strong: true },
    { text: " to move the selection." },
  ],
  [
    { text: "Turn " },
    { text: "Move", strong: true },
    { text: " off or Press " },
    { text: "Esc", strong: true },
  ],
];

export const MOVE_INFO_TIP: readonly MoveInfoSegment[] = [
  { text: "Tip: " },
  { text: "Alt + ↑/↓", strong: true },
  { text: " moves rows anytime, without Move mode." },
];

/** Flatten segments back to their plain-text sentence. */
export const moveInfoText = (segments: readonly MoveInfoSegment[]): string =>
  segments.map((s) => s.text).join("");
