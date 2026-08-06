import { useEffect, useMemo, useState } from "react";
import { useSetsStore, validateSetName } from "../../store/setsStore";
import { useUiStore } from "../../store/uiStore";
import { ApiError, type SetMeta } from "../../lib/api";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { NamePromptModal } from "../../components/NamePromptModal";

type Dialog =
  | { kind: "delete"; set: SetMeta }
  | { kind: "rename-restore"; set: SetMeta }
  | null;

function fmtDate(iso: string | null): string {
  if (!iso) return "---";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Set archive view (planning/02-features/set-archive.md §3): one row per
 * archived set — name, track count, last-modified, archived date — newest
 * archived first, searchable. Row actions: Restore, Delete permanently.
 * Archived sets are not openable from here — Restore first.
 */
export default function ArchiveScreen() {
  const { sets, archivedSets, refresh } = useSetsStore();
  const setsStore = useSetsStore();
  const toast = useUiStore((s) => s.toast);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? archivedSets.filter((s) => s.name.toLowerCase().includes(q))
      : archivedSets;
    return [...filtered].sort((a, b) =>
      (b.archived_at ?? "").localeCompare(a.archived_at ?? ""),
    );
  }, [archivedSets, query]);

  const restore = async (s: SetMeta, newName?: string) => {
    try {
      await setsStore.restore(s.id, newName);
      toast(`Restored "${newName ?? s.name}" to the Sets tree.`, "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Active-name collision — prompt to rename on restore (§3).
        setDialog({ kind: "rename-restore", set: s });
      } else {
        toast(err instanceof Error ? err.message : String(err), "error");
      }
    }
  };

  const cell: React.CSSProperties = {
    height: "var(--grid-row-height)",
    display: "flex",
    alignItems: "center",
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Archived Sets</h1>

      <div style={{ maxWidth: 860 }}>
        <input
          className="input"
          style={{ maxWidth: 320, marginBottom: 16 }}
          placeholder="Search archived sets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search archived sets"
        />

        {rows.length === 0 ? (
          <p className="small">
            {archivedSets.length === 0
              ? "No archived sets. Archiving a set moves it here — it can be restored anytime."
              : "No archived sets match the search."}
          </p>
        ) : (
          <div role="table" aria-label="Archived sets">
            <div
              role="row"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 90px 170px 170px 190px",
                gap: 8,
                padding: "0 10px 6px",
              }}
            >
              <span className="ni-label" role="columnheader">Name</span>
              <span className="ni-label" role="columnheader" style={{ textAlign: "right" }}>Tracks</span>
              <span className="ni-label" role="columnheader">Last modified</span>
              <span className="ni-label" role="columnheader">Archived</span>
              <span className="ni-label" role="columnheader" />
            </div>
            {rows.map((s, i) => (
              <div
                role="row"
                key={s.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 90px 170px 170px 190px",
                  gap: 8,
                  alignItems: "center",
                  padding: "0 10px",
                  background: i % 2 === 0 ? "var(--bg-row)" : "var(--bg-row-alt)",
                  fontSize: "var(--grid-font-size)",
                }}
              >
                <span style={{ ...cell, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </span>
                <span className="num" style={{ ...cell, justifyContent: "flex-end" }}>
                  {s.track_count}
                </span>
                <span className="num small" style={cell}>{fmtDate(s.modified_at)}</span>
                <span className="num small" style={cell}>{fmtDate(s.archived_at)}</span>
                <span style={{ ...cell, gap: 6, justifyContent: "flex-end" }}>
                  <Button size="sm" onClick={() => void restore(s)}>
                    Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setDialog({ kind: "delete", set: s })}
                  >
                    Delete permanently
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title="Delete permanently"
          message={`Permanently delete "${dialog.set.name}" (${dialog.set.track_count} tracks)? This cannot be undone.`}
          confirmLabel="Delete permanently"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const s = dialog.set;
            setDialog(null);
            setsStore
              .deletePermanently(s.id)
              .then(() => toast(`Deleted "${s.name}" permanently.`, "success"))
              .catch((err) =>
                toast(err instanceof Error ? err.message : String(err), "error"),
              );
          }}
        />
      )}

      {dialog?.kind === "rename-restore" && (
        <NamePromptModal
          title="Name in use"
          label="New name"
          initialValue={`${dialog.set.name} (2)`}
          hint={`An active set is already named "${dialog.set.name}". Choose a new name to restore.`}
          confirmLabel="Restore"
          validate={(v) => validateSetName(v, sets)}
          onSubmit={(name) => restore(dialog.set, name)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
