/**
 * S5 "Columns" popover (issue #20): show/hide the optional artist/album columns
 * plus the two file-link columns. Modeled on the matrix ColumnsMenu shell
 * (fixed-position popover, outside-click + Esc close) but with no drag/reorder —
 * the compare column order is fixed. The three non-hideable columns (Flag,
 * Traktor® Track, Spotify® Track) render disabled + checked so the full column
 * set is legible while communicating that they can't be turned off.
 *
 * Visibility is shared across every compare playlist and persisted per-screen
 * (ruling R5) — the parent owns the state; this popover only toggles it.
 */

import { useEffect, useRef } from "react";
import {
  COMPARE_COLUMNS,
  type ColumnVisibility,
  type CompareColumnId,
} from "./compareLogic";

export function ColumnsMenu({
  anchor,
  visibility,
  onToggle,
  onClose,
}: {
  anchor: { left: number; top: number };
  visibility: ColumnVisibility;
  onToggle: (id: CompareColumnId, visible: boolean) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const width = 220;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));

  return (
    <div
      ref={rootRef}
      className="cmp-colmenu"
      style={{ left, top: anchor.top, width }}
      role="dialog"
      aria-label="Columns"
    >
      {COMPARE_COLUMNS.map((col) => (
        <div key={col.id} className="cmp-colmenu__row">
          <input
            type="checkbox"
            id={`cmp-col-${col.id}`}
            checked={visibility[col.id]}
            disabled={!col.hideable}
            onChange={(e) => onToggle(col.id, e.target.checked)}
          />
          <label className="cmp-colmenu__label" htmlFor={`cmp-col-${col.id}`}>
            {col.label}
          </label>
        </div>
      ))}
    </div>
  );
}
