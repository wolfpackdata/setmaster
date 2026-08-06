import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useSetsStore, validateSetName } from "../store/setsStore";
import { useUiStore } from "../store/uiStore";
import type { SetMeta } from "../lib/api";
import { Icon } from "../components/Icon";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { NamePromptModal } from "../components/NamePromptModal";

interface MenuState {
  x: number;
  y: number;
  set: SetMeta;
}

type Dialog =
  | { kind: "new" }
  | { kind: "rename"; set: SetMeta }
  | { kind: "move"; set: SetMeta }
  | { kind: "archive"; set: SetMeta }
  | null;

/**
 * Sidebar "Sets" section (§4): header with New Set (+), the folder/set tree
 * (28px rows, 16px indent, disclosure triangles, full-row --bg-selected
 * highlight), right-click context menu (Open / Rename / Duplicate / Move to
 * folder / Archive — NO Delete), and the collapsed "Archived · N" entry at
 * the bottom (hidden when empty).
 */
export function SetsSection() {
  const { sets, archivedSets, loaded, loadError, refresh } = useSetsStore();
  const setsStore = useSetsStore();
  const toast = useUiStore((s) => s.toast);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSetId = location.pathname.startsWith("/sets/") ? params.id : undefined;

  const { folders, rootSets } = useMemo(() => {
    const byFolder = new Map<string, SetMeta[]>();
    const root: SetMeta[] = [];
    for (const s of sets) {
      const folder = (s.folder ?? "").trim();
      if (!folder) root.push(s);
      else {
        const list = byFolder.get(folder) ?? [];
        list.push(s);
        byFolder.set(folder, list);
      }
    }
    const sortByName = (a: SetMeta, b: SetMeta) => a.name.localeCompare(b.name);
    root.sort(sortByName);
    const folderNames = [...byFolder.keys()].sort((a, b) => a.localeCompare(b));
    return {
      folders: folderNames.map((name) => ({
        name,
        sets: (byFolder.get(name) as SetMeta[]).sort(sortByName),
      })),
      rootSets: root,
    };
  }, [sets]);

  const folderNames = folders.map((f) => f.name);

  const toggleFolder = (name: string) =>
    setClosedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const openContextMenu = (e: React.MouseEvent, s: SetMeta) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, set: s });
  };

  const menuItems = (s: SetMeta): ContextMenuItem[] => [
    { label: "Open", onSelect: () => navigate(`/sets/${s.id}`) },
    { label: "Rename", onSelect: () => setDialog({ kind: "rename", set: s }) },
    {
      label: "Duplicate",
      onSelect: () => {
        setsStore
          .duplicate(s.id)
          .then((dup) => navigate(`/sets/${dup.id}`))
          .catch((err) => toast(String(err instanceof Error ? err.message : err), "error"));
      },
    },
    { label: "Move to folder", onSelect: () => setDialog({ kind: "move", set: s }) },
    {
      label: "Archive",
      separatorBefore: true,
      onSelect: () => setDialog({ kind: "archive", set: s }),
    },
  ];

  const renderSetRow = (s: SetMeta, indent: number) => (
    <button
      key={s.id}
      type="button"
      className={`tree__row${activeSetId === s.id ? " active" : ""}`}
      style={{ paddingLeft: 12 + indent * 16 }}
      onClick={() => navigate(`/sets/${s.id}`)}
      onContextMenu={(e) => openContextMenu(e, s)}
      title={s.name}
    >
      <Icon name="playlist" size={14} />
      <span className="tree__label">{s.name}</span>
    </button>
  );

  return (
    <div className="sidebar__sets">
      <div className="sidebar__sets-header">
        <span className="ni-label">Sets</span>
        <button
          type="button"
          className="sidebar__collapse"
          title="New Set"
          aria-label="New Set"
          onClick={() => setDialog({ kind: "new" })}
        >
          <Icon name="plus" size={13} />
        </button>
      </div>

      <div className="sidebar__tree">
        {!loaded && <div className="small muted" style={{ padding: "4px 12px" }}>Loading…</div>}
        {loadError && (
          <div className="small" style={{ padding: "4px 12px", color: "var(--status-danger)" }}>
            Backend unavailable
          </div>
        )}

        {folders.map((folder) => {
          const closed = closedFolders.has(folder.name);
          return (
            <div key={folder.name}>
              <button
                type="button"
                className="tree__row"
                style={{ paddingLeft: 12 }}
                onClick={() => toggleFolder(folder.name)}
              >
                <span className="tree__disclosure" aria-hidden>
                  {closed ? "▸" : "▾"}
                </span>
                <Icon name="folder" size={14} />
                <span className="tree__label">{folder.name}</span>
                <span className="tree__count">{folder.sets.length}</span>
              </button>
              {!closed && folder.sets.map((s) => renderSetRow(s, 1))}
            </div>
          );
        })}

        {rootSets.map((s) => renderSetRow(s, 0))}

        {loaded && !loadError && sets.length === 0 && (
          <div className="small muted" style={{ padding: "4px 12px" }}>
            No sets yet — click + to create one.
          </div>
        )}

        {archivedSets.length > 0 && (
          <button
            type="button"
            className={`tree__row${location.pathname === "/archive" ? " active" : ""}`}
            style={{ paddingLeft: 12, marginTop: 4 }}
            onClick={() => navigate("/archive")}
          >
            <Icon name="archive" size={14} />
            <span className="tree__label">Archived</span>
            <span className="tree__count">{archivedSets.length}</span>
          </button>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.set)}
          onClose={() => setMenu(null)}
        />
      )}

      {dialog?.kind === "new" && (
        <NamePromptModal
          title="New Set"
          label="Set name"
          placeholder="e.g. Rooftop June"
          hint="Creates a new set from the standard template."
          confirmLabel="Create"
          validate={(v) => validateSetName(v, sets)}
          onSubmit={async (name) => {
            const meta = await setsStore.create(name);
            navigate(`/sets/${meta.id}`);
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "rename" && (
        <NamePromptModal
          title={`Rename "${dialog.set.name}"`}
          label="Set name"
          initialValue={dialog.set.name}
          confirmLabel="Rename"
          validate={(v) => validateSetName(v, sets, dialog.set.id)}
          onSubmit={(name) => setsStore.rename(dialog.set.id, name)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "move" && (
        <NamePromptModal
          title={`Move "${dialog.set.name}" to folder`}
          label="Folder"
          initialValue={dialog.set.folder ?? ""}
          hint="Leave empty to move to the tree root. A new folder name creates it."
          confirmLabel="Move"
          suggestions={folderNames}
          onSubmit={(folder) =>
            setsStore.moveToFolder(dialog.set.id, folder.trim() || null)
          }
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "archive" && (
        <ConfirmDialog
          title="Archive set"
          message={`Archive "${dialog.set.name}"? It moves to Archived and can be restored anytime.`}
          confirmLabel="Archive"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const s = dialog.set;
            setDialog(null);
            setsStore
              .archive(s.id)
              .then(() => {
                toast(`Archived "${s.name}".`, "success");
                if (activeSetId === s.id) navigate("/");
              })
              .catch((err) =>
                toast(String(err instanceof Error ? err.message : err), "error"),
              );
          }}
        />
      )}
    </div>
  );
}
