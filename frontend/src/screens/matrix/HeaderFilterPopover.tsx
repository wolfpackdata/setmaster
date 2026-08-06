/**
 * Per-column header filter popover (track-playlist-matrix.md §4): text
 * columns get contains + a distinct-value picklist; numeric/date columns get
 * a range; EVERY column (playlist columns included) gets blank / non-blank —
 * the prototype's "deselect blanks on a playlist column" gesture. Edits write
 * the shared unified filter state immediately (the Apply model is drawer-only).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import type { KeyNotation } from "../../lib/keys";
import { META_COLUMN_BY_ID } from "./columns";
import { distinctRawValues, rawToDisplay, type PreparedMatrix } from "./filtering";
import {
  isColumnFilterActive,
  isPlaylistCol,
  playlistPathOfCol,
  type ColumnFilter,
} from "./filterState";

const PICKLIST_RENDER_CAP = 400;

/**
 * Release Date is filtered YEAR-only (issue #60): the min/max inputs take a
 * bare year and this cluster of one-click presets sets the range. Relative
 * presets are computed from the current year (agreeing semantically with the
 * `released past N` search keyword, #74: "Last N Years" = the current year plus
 * the N−1 prior years); decade presets are fixed ranges; "Before 1970" is a
 * max-only bound. Years are stored on the column filter as ISO Jan-1 / Dec-31
 * bounds so the date-column filter engine stays untouched.
 */
export interface YearPreset {
  label: string;
  min: number | null;
  max: number | null;
}

export function releaseYearPresets(currentYear: number): YearPreset[] {
  return [
    { label: "This Year", min: currentYear, max: currentYear },
    { label: "Last 2 Years", min: currentYear - 1, max: currentYear },
    { label: "Last 10 Years", min: currentYear - 9, max: currentYear },
    { label: "2020s", min: 2020, max: 2029 },
    { label: "2010s", min: 2010, max: 2019 },
    { label: "2000s", min: 2000, max: 2009 },
    { label: "1990s", min: 1990, max: 1999 },
    { label: "1980s", min: 1980, max: 1989 },
    { label: "1970s", min: 1970, max: 1979 },
    { label: "Before 1970", min: null, max: 1969 },
  ];
}

/** Year bounds → ISO column-filter fields (Jan-1 / Dec-31; undefined clears). */
function yearToMinIso(year: number | null): string | undefined {
  return year == null ? undefined : `${year}-01-01`;
}
function yearToMaxIso(year: number | null): string | undefined {
  return year == null ? undefined : `${year}-12-31`;
}
/** ISO column-filter bound → its bare year string ("" when unset). */
function isoToYear(v: ColumnFilter["min"]): string {
  return v == null || v === "" ? "" : String(v).split("-")[0];
}

export interface PopoverAnchor {
  colId: string;
  /** Viewport rect of the header cell the popover hangs from. */
  left: number;
  top: number;
}

export function HeaderFilterPopover({
  prep,
  anchor,
  filter,
  notation,
  playlistName,
  onChange,
  onClose,
}: {
  prep: PreparedMatrix;
  anchor: PopoverAnchor;
  filter: ColumnFilter;
  notation: KeyNotation;
  playlistName: (path: string) => string;
  onChange: (next: ColumnFilter | null) => void;
  onClose: () => void;
}) {
  const { colId } = anchor;
  const meta = META_COLUMN_BY_ID.get(colId);
  const isPl = isPlaylistCol(colId);
  const kind = isPl ? "text" : (meta?.kind ?? "text");
  const label = isPl
    ? playlistName(playlistPathOfCol(colId))
    : (meta?.label ?? colId);
  // Release Date is filtered by YEAR only (issue #60) — year inputs + decade
  // presets replace the full-date range, though the column still SORTS and
  // DISPLAYS as a full date (unchanged elsewhere). Import Date stays full-date.
  const isReleaseYear = !isPl && colId === "release_date";

  const rootRef = useRef<HTMLDivElement>(null);
  const [pickSearch, setPickSearch] = useState("");

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

  const patch = (p: Partial<ColumnFilter>) => {
    const next = { ...filter, ...p };
    onChange(isColumnFilterActive(next) ? next : null);
  };

  // Distinct picklist values — text/key columns only (dates/numbers use range).
  const wantPicklist = kind === "text" || kind === "key";
  const distinct = useMemo(
    () => (wantPicklist && !isPl ? distinctRawValues(prep, colId) : []),
    [prep, colId, wantPicklist, isPl],
  );
  const shownDistinct = useMemo(() => {
    const needle = pickSearch.trim().toLowerCase();
    const all = needle
      ? distinct.filter((v) =>
          rawToDisplay(v, colId, notation).toLowerCase().includes(needle),
        )
      : distinct;
    return all.slice(0, PICKLIST_RENDER_CAP);
  }, [distinct, pickSearch, colId, notation]);

  const picked = filter.picked ?? [];
  const togglePick = (v: string) => {
    const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v];
    patch({ picked: next.length > 0 ? next : undefined });
  };

  const blankChoice = (choice: "blank" | "nonblank") =>
    patch({ blank: filter.blank === choice ? undefined : choice });

  // Clamp to the viewport so popovers near the right edge stay visible.
  const width = 260;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const top = Math.min(anchor.top, window.innerHeight - 320);

  return (
    <div
      ref={rootRef}
      className="mx-popover"
      style={{ left, top }}
      role="dialog"
      aria-label={`Filter ${label}`}
    >
      <div className="mx-popover__title">Filter · {label}</div>

      {isReleaseYear && (
        <>
          <div className="mx-popover__row">
            <input
              className="input"
              style={{ flex: 1 }}
              type="number"
              inputMode="numeric"
              aria-label={`${label} minimum year`}
              placeholder="year"
              value={isoToYear(filter.min)}
              onChange={(e) =>
                patch({ min: e.target.value === "" ? undefined : yearToMinIso(Number(e.target.value)) })
              }
            />
            <span className="mx-line__dash">–</span>
            <input
              className="input"
              style={{ flex: 1 }}
              type="number"
              inputMode="numeric"
              aria-label={`${label} maximum year`}
              placeholder="year"
              value={isoToYear(filter.max)}
              onChange={(e) =>
                patch({ max: e.target.value === "" ? undefined : yearToMaxIso(Number(e.target.value)) })
              }
            />
          </div>
          <div
            className="mx-popover__presets"
            role="group"
            aria-label={`${label} quick filters`}
          >
            {releaseYearPresets(new Date().getFullYear()).map((p) => {
              const active =
                isoToYear(filter.min) === (p.min == null ? "" : String(p.min)) &&
                isoToYear(filter.max) === (p.max == null ? "" : String(p.max));
              return (
                <Button
                  key={p.label}
                  size="sm"
                  className={active ? "btn--primary" : undefined}
                  onClick={() => patch({ min: yearToMinIso(p.min), max: yearToMaxIso(p.max) })}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>
        </>
      )}

      {!isReleaseYear && (kind === "num" || kind === "date") && (
        <div className="mx-popover__row">
          <input
            className="input"
            style={{ flex: 1 }}
            type={kind === "date" ? "date" : "number"}
            aria-label={`${label} minimum`}
            placeholder="min"
            value={filter.min == null ? "" : String(filter.min)}
            onChange={(e) =>
              patch({
                min:
                  e.target.value === ""
                    ? undefined
                    : kind === "date"
                      ? e.target.value
                      : Number(e.target.value),
              })
            }
          />
          <span className="mx-line__dash">–</span>
          <input
            className="input"
            style={{ flex: 1 }}
            type={kind === "date" ? "date" : "number"}
            aria-label={`${label} maximum`}
            placeholder="max"
            value={filter.max == null ? "" : String(filter.max)}
            onChange={(e) =>
              patch({
                max:
                  e.target.value === ""
                    ? undefined
                    : kind === "date"
                      ? e.target.value
                      : Number(e.target.value),
              })
            }
          />
        </div>
      )}

      {kind === "text" && (
        <div className="mx-popover__row">
          <input
            className="input"
            style={{ flex: 1 }}
            type="text"
            aria-label={`${label} contains`}
            placeholder="contains…"
            value={filter.contains ?? ""}
            onChange={(e) =>
              patch({ contains: e.target.value === "" ? undefined : e.target.value })
            }
          />
        </div>
      )}

      {wantPicklist && !isPl && distinct.length > 0 && (
        <>
          {distinct.length > 12 && (
            <div className="mx-popover__row">
              <input
                className="input"
                style={{ flex: 1 }}
                type="text"
                aria-label="Search values"
                placeholder={`Search ${distinct.length.toLocaleString("en-US")} values…`}
                value={pickSearch}
                onChange={(e) => setPickSearch(e.target.value)}
              />
            </div>
          )}
          <div className="mx-popover__picklist">
            {shownDistinct.map((v) => (
              <label key={v} className="mx-popover__pick">
                <input
                  type="checkbox"
                  checked={picked.includes(v)}
                  onChange={() => togglePick(v)}
                />
                <span>{rawToDisplay(v, colId, notation)}</span>
              </label>
            ))}
            {distinct.length > shownDistinct.length && (
              <div className="mx-popover__hint" style={{ padding: "3px 8px" }}>
                {(distinct.length - shownDistinct.length).toLocaleString("en-US")} more —
                type to narrow
              </div>
            )}
          </div>
        </>
      )}

      <div className="mx-popover__row" role="group" aria-label="Blank filter">
        <Button
          size="sm"
          className={filter.blank === "nonblank" ? "btn--primary" : undefined}
          onClick={() => blankChoice("nonblank")}
        >
          {isPl ? "On playlist" : "Non-blank"}
        </Button>
        <Button
          size="sm"
          className={filter.blank === "blank" ? "btn--primary" : undefined}
          onClick={() => blankChoice("blank")}
        >
          {isPl ? "Not on playlist" : "Blank"}
        </Button>
      </div>

      <div className="mx-popover__foot">
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Clear
        </Button>
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
