/**
 * Drawer line 1 — "One Playlist": single-select searchable dropdown of all
 * loaded playlists (= the matrix's playlist columns), per
 * track-playlist-matrix.md §5. The text input participates in the drawer's
 * Tab order (it is text-editable); list options are pointer targets only.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PreparedMatrix } from "./filtering";

export function PlaylistCombo({
  prep,
  path,
  disabled,
  onPick,
}: {
  prep: PreparedMatrix;
  /** Selected playlist_path ("" = none). */
  path: string;
  disabled?: boolean;
  onPick: (path: string) => void;
}) {
  const selectedName = useMemo(() => {
    if (!path) return "";
    const idx = prep.pathToIndex.get(path);
    return idx === undefined ? path : prep.playlists[idx].name;
  }, [prep, path]);

  const [text, setText] = useState(selectedName);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the field in sync when the selection changes from outside
  // (Reset, re-opened drawer, breadcrumb clear).
  useEffect(() => {
    setText(selectedName);
  }, [selectedName]);

  const options = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const all = prep.playlistOrder.map((i) => prep.playlists[i]);
    // When the field still shows the picked name, don't filter — show all.
    if (needle === "" || text === selectedName) return all;
    return all.filter((p) => p.name.toLowerCase().includes(needle));
  }, [prep, text, selectedName]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setText(selectedName);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open, selectedName]);

  const pick = (p: string) => {
    onPick(p);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      setOpen(true);
      setHi((h) => Math.min(options.length - 1, h + 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setHi((h) => Math.max(0, h - 1));
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (open && options[hi]) pick(options[hi].path);
      e.preventDefault();
    } else if (e.key === "Escape") {
      setOpen(false);
      setText(selectedName);
    }
  };

  return (
    <div className="mx-combo" ref={rootRef}>
      <input
        className="input"
        style={{ width: "100%" }}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label="One Playlist"
        placeholder="Choose a playlist…"
        value={text}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && (
        <div className="mx-combo__list" role="listbox">
          {options.length === 0 && (
            <div className="mx-combo__opt" aria-disabled="true">
              No playlists match
            </div>
          )}
          {options.map((p, i) => (
            <button
              key={p.path}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={p.path === path}
              className={`mx-combo__opt${i === hi ? " mx-combo__opt--hi" : ""}`}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(p.path)}
            >
              {p.name}
              {p.is_root && <span className="mx-combo__root">SUPER</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
