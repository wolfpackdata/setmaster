/**
 * Column show/hide + reorder menu for the 12 metadata columns (feature spec
 * §3: persisted; File Path optional, hidden by default). Playlist columns are
 * all visible in fixed alphabetical order (§11.1/§11.11) so they are not
 * listed here. Reorder = drag the grip rows (HTML5 DnD).
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { META_COLUMNS } from "./columns";
import { MatrixIcon } from "./MatrixIcons";
import { useMatrixStore } from "./matrixStore";

export function ColumnsMenu({
  anchor,
  onClose,
}: {
  anchor: { left: number; top: number };
  onClose: () => void;
}) {
  const layout = useMatrixStore((s) => s.layout);
  const toggleColumnHidden = useMatrixStore((s) => s.toggleColumnHidden);
  const moveColumn = useMatrixStore((s) => s.moveColumn);
  const resetLayout = useMatrixStore((s) => s.resetLayout);

  const rootRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
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

  const labelOf = (id: string) =>
    META_COLUMNS.find((c) => c.id === id)?.label ?? id;

  const width = 240;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));

  return (
    <div
      ref={rootRef}
      className="mx-colmenu"
      style={{ left, top: anchor.top }}
      role="dialog"
      aria-label="Columns"
    >
      {layout.order.map((id, index) => (
        <div
          key={id}
          className={`mx-colmenu__row${dragId === id ? " mx-colmenu__row--dragging" : ""}`}
          draggable
          onDragStart={(e) => {
            setDragId(id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragId && dragId !== id) moveColumn(dragId, index);
          }}
        >
          <span className="mx-colmenu__grip" aria-hidden="true">
            <MatrixIcon name="grip" size={14} />
          </span>
          <input
            type="checkbox"
            id={`mx-col-${id}`}
            checked={!layout.hidden.includes(id)}
            onChange={() => toggleColumnHidden(id)}
          />
          <label className="mx-colmenu__label" htmlFor={`mx-col-${id}`}>
            {labelOf(id)}
          </label>
        </div>
      ))}
      <div className="mx-colmenu__foot">
        <Button size="sm" variant="ghost" onClick={resetLayout}>
          Reset columns
        </Button>
      </div>
    </div>
  );
}
