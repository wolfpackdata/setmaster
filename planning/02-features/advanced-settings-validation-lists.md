# Feature: Advanced Settings — Editable Validation Lists

**Status:** Spec v1 (2026-07-06).
**Provenance:** requested directly by Ry (2026-07-06); rename/remove semantics confirmed same day. No prototype equivalent — SM2's validation lists are fixed ranges on the workbook's `load` tab. That tab is, however, the source of the **factory defaults** below (extracted from `legacy/setmaster-2/.../RML SetMaster Public 2.68.xlsm`, 2026-07-06).
**UI context:** an **Advanced Settings** section of the global Settings screen (S6) — see `planning/03-ui-design.md` §5.6.

## 1. What it is

Four of the Set Editor's dropdown fields draw their allowed values from user-editable validation lists: **Pitch shift (Δ)**, **Lows**, **Level**, and **I like**. Advanced Settings lets the user **Add**, **Rename**, and **Remove** values in each list, and **Reset** each list independently to factory settings.

Changes are global: they apply to every set (existing and new) and everywhere the values surface — S2 enum dropdowns, Perform Mode chips, filter vocabularies, and exports.

**Not editable:** cue-number lists (`T #`, `A #`, `M #`, `Swap Lows` — fixed `---`, `#1`–`#8`). *(An earlier draft also excluded the "semantic row-flag vocabulary" — that feature was vetoed by Ry 2026-07-06; cell formatting (design spec §6.5) has no vocabulary to manage.)*

## 2. Per-field rules

| Field | Value constraints | Factory settings (from `load` tab) |
|---|---|---|
| **Pitch shift (Δ)** | Numeric only; multiples of **0.5**; range **[−12, +12]**. Displayed with explicit sign (`+1.5`, `-0.5`) — **except zero, which is the bare `0`** (decided 2026-07-29, issue #163: a signed zero is not a shift in either direction). No free text. | `-1.5, -1, -0.5, 0, +0.5, +1, +1.5` (ascending) |
| **Lows** | Any text, **max 16 characters**, emoji allowed. Non-empty after trimming; unique within the list (case-sensitive). | `cut, cut-swell, open, 0.5` |
| **Level** | Any text, **max 16 characters**, emoji allowed. Non-empty after trimming; unique within the list (case-sensitive). | `silence, open, HOT, HOT-LP, LP, HP, LP-silence, HP-silence` |
| **I like** | **Emoji only** — exactly one emoji grapheme cluster per value (multi-codepoint emoji count as one); no letters/digits/punctuation. Unique within the list. | `🚀, 🥰, ✅, ⚠️, 👎` (⚠️ remains the template default for new rows) |

- The 16-char limit counts user-perceived characters (grapheme clusters), not bytes — a single emoji is 1.
- The `---` "not used" placeholder on Δ is system-managed: always present, never listed in the editor, never removable.
- **Δ factory list vs. Δ range — decided 2026-07-29 (issue #163).** The two are deliberately different sizes and must not be conflated. The **range** `[−12, +12]` is the *constraint*: what a user may add, enforced identically by the backend validator and the Add stepper. The **factory list** is only what ships out of the box, and stays the narrow daily-use set `-1.5 … +1.5`. Reset to factory returns those seven. The original list (`+1.5, +1, +0.5, -0.5, -1, -1.5`, from the SM2 `load` tab) omitted `0`, so a cell holding it rendered with the ◦ **legacy-value marker** — the "kept as-is, but no longer offered" signal reserved for *retired* values. `0` is now a member (the interval contains it), which is also why zero canonicalizes bare. **No migration:** a user's stored list is never rewritten on startup, in either direction; widening or narrowing it is theirs to do via Add / Remove / Reset.
- Validation errors (out-of-range Δ, duplicate, too long, non-emoji in I like) show inline at the input; the Add/Rename is blocked until valid.

## 3. Operations & data semantics (decided with Ry, 2026-07-06)

| Operation | Behavior |
|---|---|
| **Add** | Appends a new value to the list (drag to reorder afterwards; list order = dropdown order). Available immediately in all dropdowns. |
| **Rename** | **Propagates everywhere**: every row in every set using the old value updates to the new label — it is the same value with a new name, not a new value. One undoable operation. Value-tied styling follows the value (e.g. if `HOT` — rendered in `--brand-magenta` — is renamed, the new label keeps that styling). |
| **Remove** | **Keep in place, stop offering**: existing cells retain the value (rendered as-is, with a subtle "legacy" marker in the cell tooltip); the value simply disappears from dropdowns for new entries. No data is lost or blanked. A removed value can be re-added later, which clears the legacy status. |
| **Reset** (per field) | One Reset button per field. Replaces that list with the factory settings above, after a confirm dialog stating what will be offered afterwards. Existing rows are untouched: custom values still in use follow the Remove semantics (kept in place, no longer offered); renames revert per the Rename semantics (factory labels propagate back). Reset affects only its own field. |

## 4. UI

- **Location:** Settings (S6) → **Advanced Settings**, a collapsed-by-default section below the standard sections, with a one-line warning that edits apply globally to all sets.
- **Layout:** four field editors (Pitch shift Δ, Lows, Level, I like), each: field name + short constraint hint, the current values as a vertical reorderable list (drag handles), per-value inline Rename (click-to-edit) and Remove (× on hover / always visible on touch), an Add input at the bottom, and a **Reset to factory** button at the editor's top right.
- Style: standard S6 form treatment (`03-ui-design.md` §5.6) — uppercase 11px labels, `--bg-input` fields, no heavy borders. Destructive confirms (Remove of an in-use value shows usage count; Reset) use plain dialogs, never silent.
- The Δ editor's Add control is a numeric stepper (0.5 steps, clamped to ±12) rather than free text.
- The I like editor's Add control opens an emoji picker; paste is accepted but validated to a single emoji.

## 5. Acceptance criteria

1. Each of the four lists can be added to, renamed, removed from, reordered, and reset independently; dropdowns across all sets reflect changes immediately.
2. Constraint enforcement: Δ rejects 0.3 / +13 / text; Lows/Level reject empty, 17+ chars, duplicates; I like rejects `abc`, `!`, and two-emoji strings, accepts `🎛️`.
3. Renaming a value used in N rows across multiple sets updates all N rows (verifiable by export before/after) and is undoable.
4. Removing an in-use value leaves every existing cell intact and only shrinks the dropdown.
5. Reset restores exactly the factory list from §2 for that field only, leaving the other three lists and all row data untouched.
