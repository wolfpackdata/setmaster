/**
 * S3 breadcrumb — sentence-form filter summary (track-playlist-matrix.md §6).
 * Pure composition: unified filter state → list of segments, `strong`
 * segments rendered highlighted. Reflects the FULL unified state (drawer
 * lines + column filters + sort), e.g.:
 *
 *   Show tracks only from **discoCosmic** with BPM **122 through 126**,
 *   show me **all keys**, released **2025** through **Present**,
 *   where Artist Name contains **Kaskade**, sorted by **BPM**.
 */

import { formatKey, type KeyNotation } from "../../lib/keys";
import { fmtMatrixDate } from "./filtering";
import {
  isColumnFilterActive,
  isLineEffective,
  isPlaylistCol,
  playlistPathOfCol,
  type ColumnFilter,
  type MatrixFilterState,
  type SortLevel,
} from "./filterState";
import { META_COLUMN_BY_ID } from "./columns";

export interface CrumbSeg {
  text: string;
  strong?: boolean;
}

export interface BreadcrumbCtx {
  /** playlist_path → display name (falls back to the path). */
  playlistName: (path: string) => string;
  notation: KeyNotation;
}

const seg = (text: string): CrumbSeg => ({ text });
const strong = (text: string): CrumbSeg => ({ text, strong: true });

/** "2026-07-04" (date input value) → "07/04/2026" for the sentence. */
function isoToDisplay(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

function rangeSegs(
  min: string | null,
  max: string | null,
  out: CrumbSeg[],
): void {
  if (min != null && max != null) {
    out.push(strong(min), seg(" through "), strong(max));
  } else if (min != null) {
    out.push(strong(min), seg(" through "), strong("Present"));
  } else if (max != null) {
    out.push(seg("through "), strong(max ?? ""));
  }
}

/**
 * Release Year range (issue #60), shared by the drawer's Release Year line and
 * the mirrored Release Date column filter so both read identically. Collapses a
 * single-year range (min == max, e.g. the "This Year" preset) to just the year.
 */
function yearRangeSegs(
  min: string | null,
  max: string | null,
  out: CrumbSeg[],
): void {
  if (min != null && max != null && min === max) {
    out.push(strong(min));
    return;
  }
  rangeSegs(min, max, out);
}

/** ISO "2019-06-15" → its year "2019"; "" when blank. */
function isoYear(v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  return String(v).split("-")[0];
}

function drawerClauses(s: MatrixFilterState, ctx: BreadcrumbCtx): CrumbSeg[][] {
  const d = s.drawer;
  const clauses: CrumbSeg[][] = [];

  if (isLineEffective(d, "playlist")) {
    clauses.push([seg("only from "), strong(ctx.playlistName(d.playlist.path))]);
  }
  if (isLineEffective(d, "bpm")) {
    const c: CrumbSeg[] = [seg("with BPM ")];
    if (d.bpm.min != null && d.bpm.max != null) {
      c.push(strong(String(d.bpm.min)), seg(" through "), strong(String(d.bpm.max)));
    } else if (d.bpm.min != null) {
      c.push(strong(`${d.bpm.min} or more`));
    } else {
      c.push(strong(`${d.bpm.max} or less`));
    }
    clauses.push(c);
  }
  if (isLineEffective(d, "keys")) {
    const n = d.keys.selected.length;
    if (n >= 24) {
      clauses.push([seg("show me "), strong("all keys")]);
    } else if (n === 0) {
      clauses.push([seg("in "), strong("no keys")]);
    } else if (n <= 6) {
      const names = d.keys.selected.map((k) => formatKey(k, ctx.notation)).join(", ");
      clauses.push([seg(n === 1 ? "in key " : "in keys "), strong(names)]);
    } else {
      clauses.push([seg("in "), strong(`${n} keys`)]);
    }
  }
  if (isLineEffective(d, "releaseYear")) {
    const c: CrumbSeg[] = [seg("released ")];
    yearRangeSegs(
      d.releaseYear.min != null ? String(d.releaseYear.min) : null,
      d.releaseYear.max != null ? String(d.releaseYear.max) : null,
      c,
    );
    clauses.push(c);
  }
  if (isLineEffective(d, "importDate")) {
    const c: CrumbSeg[] = [seg("imported ")];
    rangeSegs(
      d.importDate.min !== "" ? isoToDisplay(d.importDate.min) : null,
      d.importDate.max !== "" ? isoToDisplay(d.importDate.max) : null,
      c,
    );
    clauses.push(c);
  }
  if (isLineEffective(d, "artistContains")) {
    clauses.push([seg("where Artist Name contains "), strong(d.artistContains.text.trim())]);
  }
  if (isLineEffective(d, "trackContains")) {
    clauses.push([seg("where Track Name contains "), strong(d.trackContains.text.trim())]);
  }
  if (isLineEffective(d, "onRootPl")) {
    clauses.push([seg("with On Super Playlist at least "), strong(String(d.onRootPl.min))]);
  }
  if (isLineEffective(d, "onNonRootPl")) {
    const { min, max } = d.onNonRootPl;
    if (min != null && max != null && min === max) {
      clauses.push([seg("with On Non-Super Playlist exactly "), strong(String(min))]);
    } else if (min != null && max != null) {
      clauses.push([
        seg("with On Non-Super Playlist "),
        strong(String(min)),
        seg(" through "),
        strong(String(max)),
      ]);
    } else if (min != null) {
      clauses.push([seg("with On Non-Super Playlist at least "), strong(String(min))]);
    } else {
      clauses.push([seg("with On Non-Super Playlist at most "), strong(String(max))]);
    }
  }
  return clauses;
}

function columnClause(
  colId: string,
  f: ColumnFilter,
  ctx: BreadcrumbCtx,
): CrumbSeg[][] {
  const clauses: CrumbSeg[][] = [];
  const isPl = isPlaylistCol(colId);
  const label = isPl
    ? ctx.playlistName(playlistPathOfCol(colId))
    : (META_COLUMN_BY_ID.get(colId)?.label ?? colId);
  const meta = META_COLUMN_BY_ID.get(colId);

  if (f.blank !== undefined) {
    if (isPl) {
      // Playlist column blank gesture = membership (walkthrough §7.5).
      clauses.push(
        f.blank === "nonblank"
          ? [seg("on "), strong(label)]
          : [seg("not on "), strong(label)],
      );
    } else {
      clauses.push([
        seg("where "),
        strong(label),
        seg(f.blank === "blank" ? " is blank" : " is non-blank"),
      ]);
    }
  }
  if (f.contains !== undefined && f.contains.trim() !== "") {
    clauses.push([seg(`where ${label} contains `), strong(f.contains.trim())]);
  }
  if (f.picked !== undefined && f.picked.length > 0) {
    if (f.picked.length <= 4) {
      const shown = f.picked
        .map((v) => {
          if (meta?.kind === "date") return fmtMatrixDate(v);
          if (meta?.kind === "key") return formatKey(v, ctx.notation);
          return v;
        })
        .join(", ");
      clauses.push([seg(`where ${label} is `), strong(shown)]);
    } else {
      clauses.push([seg(`where ${label} is one of `), strong(`${f.picked.length} values`)]);
    }
  }
  const hasMin = f.min !== undefined && f.min !== null && f.min !== "";
  const hasMax = f.max !== undefined && f.max !== null && f.max !== "";
  // Release Date is the year-only mirror of the drawer's Release Year line
  // (issue #60): render it with the same "released <year> through <year>"
  // wording as the drawer, not as a full-date "where Release Date is …" range.
  if ((hasMin || hasMax) && colId === "release_date") {
    const c: CrumbSeg[] = [seg("released ")];
    yearRangeSegs(hasMin ? isoYear(f.min) : null, hasMax ? isoYear(f.max) : null, c);
    clauses.push(c);
    return clauses;
  }
  if (hasMin || hasMax) {
    const show = (v: number | string) =>
      meta?.kind === "date" ? isoToDisplay(String(v)) : String(v);
    const c: CrumbSeg[] = [seg(`where ${label} is `)];
    if (hasMin && hasMax) {
      c.push(strong(show(f.min as number | string)), seg(" through "), strong(show(f.max as number | string)));
    } else if (hasMin) {
      c.push(seg("at least "), strong(show(f.min as number | string)));
    } else {
      c.push(seg("at most "), strong(show(f.max as number | string)));
    }
    clauses.push(c);
  }
  return clauses;
}

function sortClause(sort: SortLevel[], ctx: BreadcrumbCtx): CrumbSeg[] | null {
  if (sort.length === 0) return null;
  const out: CrumbSeg[] = [seg("sorted by ")];
  sort.forEach((level, i) => {
    if (i > 0) out.push(seg(" then "));
    const isPl = isPlaylistCol(level.col);
    const meta = META_COLUMN_BY_ID.get(level.col);
    const label = isPl
      ? ctx.playlistName(playlistPathOfCol(level.col))
      : (meta?.label ?? level.col);
    out.push(strong(label));
    if (meta?.kind === "date") {
      out.push(seg(level.dir === "desc" ? " newest first" : " oldest first"));
    } else if (level.dir === "desc") {
      out.push(seg(" descending"));
    }
  });
  return out;
}

/**
 * Compose the full sentence. Returns [] when there is nothing to say
 * (no filters AND no sort) — but note the strip's VISIBILITY is governed by
 * hasActiveFilters (filters only, §6), not by this returning content.
 */
export function composeBreadcrumb(
  s: MatrixFilterState,
  ctx: BreadcrumbCtx,
): CrumbSeg[] {
  const clauses: CrumbSeg[][] = [...drawerClauses(s, ctx)];
  // Column filters, deterministic order: metadata columns first (spec order),
  // then playlist columns alphabetically by label.
  const colIds = Object.keys(s.columns).filter((id) =>
    isColumnFilterActive(s.columns[id]),
  );
  const metaIds = colIds.filter((id) => !isPlaylistCol(id));
  const plIds = colIds
    .filter(isPlaylistCol)
    .sort((a, b) =>
      ctx.playlistName(playlistPathOfCol(a)).localeCompare(
        ctx.playlistName(playlistPathOfCol(b)),
        undefined,
        { sensitivity: "base" },
      ),
    );
  for (const id of [...metaIds, ...plIds]) {
    clauses.push(...columnClause(id, s.columns[id], ctx));
  }

  const sortSegs = sortClause(s.sort, ctx);
  if (clauses.length === 0 && !sortSegs) return [];

  const out: CrumbSeg[] = [seg("Show tracks")];
  clauses.forEach((c, i) => {
    out.push(seg(i === 0 ? " " : ", "));
    out.push(...c);
  });
  if (sortSegs) {
    out.push(seg(clauses.length > 0 ? ", " : " "));
    out.push(...sortSegs);
  }
  out.push(seg("."));
  return out;
}

/** Plain-text form (tests, tooltips). */
export function breadcrumbText(s: MatrixFilterState, ctx: BreadcrumbCtx): string {
  return composeBreadcrumb(s, ctx)
    .map((c) => c.text)
    .join("");
}
