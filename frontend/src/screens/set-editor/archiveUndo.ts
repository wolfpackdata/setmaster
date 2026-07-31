/**
 * In-session Ctrl/Cmd+Z undo for "Archive Set" (set-archive.md §2:
 * "Archiving is undoable in-session — Ctrl/Cmd+Z restores it to the tree").
 *
 * Archiving navigates away from the editor, so this arms a window-level
 * one-shot listener that restores the most recently archived set. It stands
 * down when the keystroke was already handled (e.g. another set editor's own
 * undo called preventDefault) or when focus is in a text input.
 */

import { restoreSet } from "../../lib/api";
import { useSetsStore } from "../../store/setsStore";
import { useUiStore } from "../../store/uiStore";

let cleanup: (() => void) | null = null;

export function disarmArchiveUndo(): void {
  cleanup?.();
  cleanup = null;
}

export function armArchiveUndo(setId: string, setName: string): void {
  disarmArchiveUndo();
  const onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== "z" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.defaultPrevented) return; // someone closer already undid something
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    e.preventDefault();
    disarmArchiveUndo();
    restoreSet(setId)
      .then(() => {
        void useSetsStore.getState().refresh();
        useUiStore.getState().toast(`Restored "${setName}".`, "success");
      })
      .catch((err) => {
        useUiStore
          .getState()
          .toast(
            `Could not restore "${setName}": ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
      });
  };
  window.addEventListener("keydown", onKey);
  cleanup = () => window.removeEventListener("keydown", onKey);
}
