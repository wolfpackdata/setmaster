# Feature: Set Archive

**Status:** Spec v1 (2026-07-06). Requested directly by Ry same day; placement/restore/menu decisions confirmed via Q&A. No SM2 equivalent (SM2 sets are worksheet tabs, deleted via Excel).
**UI context:** S2 three-dot menu (`03-ui-design.md` §5.2), sidebar Sets tree (§4).

## 1. What it is

A safety layer between "working set" and "gone": sets are **archived** (removed from the active tree, kept forever) and can only be **permanently deleted from the archive view**. There is no direct-delete path for an active set anywhere in the app.

Lifecycle: `active → archived → (restored → active | deleted permanently)`.

## 2. Archiving a set

- **Primary entry (decided):** on the set's own page (S2), a **three-dot (⋯) overflow menu** at the right end of the toolbar containing exactly: **Export…** (moves here from its standalone toolbar button; `Ctrl/Cmd+E` still works) and **Archive Set**.
- **Sidebar shortcut (decided):** the sets right-click context menu replaces its former **Delete** item with **Archive** — same action as the S2 menu item. Menu becomes: Open, Rename, Duplicate, Move to folder, **Archive**.
- Archiving shows a lightweight confirm ("Archive 'KimmaBryan'? It moves to Archived and can be restored anytime."), then: the set leaves the Sets tree, closes if open (navigate to Home), and appears in the archive.
- Archiving is undoable in-session (Ctrl/Cmd+Z restores it to the tree) in addition to Restore (§3).

## 3. The archive view

- **Location (decided):** a collapsed **"Archived"** section at the bottom of the sidebar Sets tree, with a count badge (e.g. `Archived · 7`); hidden entirely when empty. Clicking it opens the archive view in the main pane.
- **List contents:** one row per archived set — name, track count, last-modified date, **archived date** — sorted newest-archived first, searchable by name. Grid style per `03-ui-design.md` §6.1.
- **Row actions (decided — Restore + Delete):**
  - **Restore** — set returns to the Sets tree (its former folder if it still exists, else tree root), fully editable, immediately. If an active set now holds the same name, prompt to rename on restore (suggest `Name (2)`), since uniqueness applies to active sets.
  - **Delete permanently** — destructive-styled action with a confirm dialog naming the set and its track count ("Permanently delete 'kootz4' (24 tracks)? This cannot be undone."). Not undoable. Removes the set, its rows, formatting, and export-name memory.
- Archived sets are **not openable/editable** from the archive — Restore first. (Read-only preview was considered and not chosen.)

## 4. Data semantics

- Archive state is a flag + `archived_at` timestamp on the Set entity (`01-data-model.md` §4.1) — archiving moves nothing on disk and loses nothing: rows, cell formatting, I-like emoji, notes text, and export-name memory all persist untouched, forever, until the user deletes.
- Archived sets are **excluded from**: the sidebar tree (except the Archived section), set search/navigation, Duplicate targets, and anywhere sets are listed for action. They are **included in** the backup zip (they are user data).
- Name uniqueness (ui spec §4 rule) is enforced among **active** sets only; the archive may hold a name an active set also uses (resolved at restore time, §3).
- Permanent deletion must be atomic — no half-deleted sets after a crash.

## 5. Acceptance criteria

1. From S2, ⋯ → Archive Set moves the set to the Archived section; it disappears from the tree and reopens nothing on restart.
2. The sidebar context menu offers Archive (not Delete); no UI path permanently deletes an active set.
3. Restore returns a set fully intact (rows, formatting, emoji, timing, export-name memory verified identical); name collisions prompt a rename.
4. Delete permanently requires the confirm dialog, survives restart as deleted, and is absent from a subsequent backup zip.
5. An archived set persists indefinitely (no auto-purge of any kind) and appears in backup zips until deleted.
