import { useCallback, useEffect, useState } from "react";
import { fsList, type FsEntry, type FsListing } from "../lib/api";
import { Modal } from "./Modal";
import { Button } from "./Button";

/**
 * Backend filesystem browser (GET /api/fs/list) — used to pick the
 * collection.nml file (and any future path picks: SM2 workbook, etc.).
 *
 * `selectMode="file"`: entries failing `fileFilter` are dimmed/unselectable;
 * `selectMode="dir"`: the current directory is selectable via the footer.
 */
export function FsBrowserModal({
  title,
  selectMode,
  fileFilter,
  filterHint,
  initialPath = "",
  onSelect,
  onClose,
}: {
  title: string;
  selectMode: "file" | "dir";
  fileFilter?: (entry: FsEntry) => boolean;
  filterHint?: string;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<FsListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FsEntry | null>(null);
  const [loading, setLoading] = useState(false);

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      setListing(await fsList(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void navigate(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectable = (entry: FsEntry) =>
    selectMode === "file" && !entry.is_dir && (!fileFilter || fileFilter(entry));

  const confirmDisabled =
    selectMode === "file" ? !selected : !listing || loading;

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={520}
      footer={
        <>
          {filterHint && (
            <span className="small" style={{ marginRight: "auto" }}>
              {filterHint}
            </span>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={confirmDisabled}
            onClick={() => {
              if (selectMode === "file" && selected) onSelect(selected.path);
              else if (selectMode === "dir" && listing) onSelect(listing.path);
            }}
          >
            Select
          </Button>
        </>
      }
    >
      <div className="fsbrowser__path">{listing?.path || "…"}</div>
      <div className="fsbrowser__list">
        {error && (
          <div className="small" style={{ padding: 12, color: "var(--status-danger)" }}>
            {error}
          </div>
        )}
        {!error && listing && (
          <>
            {listing.parent !== null && listing.parent !== listing.path && (
              <button
                type="button"
                className="fsbrowser__entry"
                onDoubleClick={() => void navigate(listing.parent as string)}
                onClick={() => void navigate(listing.parent as string)}
              >
                <span aria-hidden>↩</span>
                <span className="fsbrowser__name">..</span>
              </button>
            )}
            {listing.entries.map((entry) => {
              const disabled = !entry.is_dir && !selectable(entry);
              const cls = [
                "fsbrowser__entry",
                selected?.path === entry.path ? "fsbrowser__entry--selected" : "",
                disabled ? "fsbrowser__entry--disabled" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={entry.path}
                  type="button"
                  className={cls}
                  onClick={() => {
                    if (entry.is_dir) void navigate(entry.path);
                    else if (!disabled) setSelected(entry);
                  }}
                  onDoubleClick={() => {
                    if (!entry.is_dir && !disabled) onSelect(entry.path);
                  }}
                >
                  <span aria-hidden>{entry.is_dir ? "📁" : "·"}</span>
                  <span className="fsbrowser__name">{entry.name}</span>
                  {!entry.is_dir && (
                    <span className="small muted">
                      {new Date(entry.mtime_iso).toLocaleDateString()}
                    </span>
                  )}
                </button>
              );
            })}
            {listing.entries.length === 0 && (
              <div className="small muted" style={{ padding: 12 }}>
                Empty folder
              </div>
            )}
          </>
        )}
        {loading && (
          <div className="small muted" style={{ padding: 12 }}>
            Loading…
          </div>
        )}
      </div>
    </Modal>
  );
}
