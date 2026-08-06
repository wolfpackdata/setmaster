import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  fsReveal,
  getComparisonOverview,
  getComparisonResults,
  putComparisonNote,
  type ComparisonResults,
  type ComparisonResultRow,
  type NoteSide,
  type PresenceFlag,
} from "../../lib/api";
import { usePipelineStatus } from "../../lib/usePipelineStatus";
import { fmtDateTime } from "../../lib/format";
import { useUiStore } from "../../store/uiStore";
import { Button } from "../../components/Button";
import { StatusChip } from "../../components/StatusChip";
import { Toggle } from "../../components/Toggle";
import { Icon } from "../../components/Icon";
import { ImportSpotifyDataModal } from "../comparison-settings/ImportSpotifyDataModal";
import { normalizePlaylistName } from "../comparison-settings/s8logic";
import { RevealIcon } from "../comparison-settings/icons";
import {
  EMPTY_FILTERS,
  FLAGS_BY_LABEL,
  FLAG_META,
  STALE_BANNER,
  applyFilters,
  filteredCountText,
  filtersActive,
  isNoteEditable,
  loadColumnVisibility,
  nextSort,
  applyLinkPaste,
  isPastedUrl,
  noteCellState,
  noteJoinKey,
  notesSummaryText,
  parseNoteSegments,
  saveColumnVisibility,
  setColumnVisible,
  sortRows,
  spotifyTrackUrl,
  summaryLine,
  toggleFlagFilter,
  visibleColumns,
  type ColumnVisibility,
  type CompareColumn,
  type CompareColumnId,
  type CompareFilters,
  type SortColumn,
  type SortState,
} from "./compareLogic";
import { ColumnsMenu } from "./ColumnsMenu";
import "./compare.css";

/**
 * S5 — Playlist Compare Tool (03-ui-design.md §5.5; behavior:
 * comparison-output-table.md). One page per playlist checked in S8;
 * /compare is the index of those pages.
 */
export default function CompareScreen() {
  const { slug } = useParams();
  // No key={slug}: ComparePage stays mounted across tab switches so the
  // header/tabs/filter chrome doesn't unmount+remount (the "reload" flicker,
  // #22). Per-playlist state is reset inside ComparePage on slug change.
  return slug ? <ComparePage slug={slug} /> : <CompareIndex />;
}

// ---------------------------------------------------------------------------
// Page inventory: the S8 config drives which pages exist (§9)
// ---------------------------------------------------------------------------

interface ComparePageRef {
  /** Exportify slug (results key) — null when checked but no Spotify data. */
  slug: string | null;
  name: string;
}

function useComparePages() {
  const [pages, setPages] = useState<ComparePageRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    getComparisonOverview()
      .then((o) => {
        const slugByNorm = new Map<string, string>();
        for (const s of o.spotify) {
          slugByNorm.set(normalizePlaylistName(s.slug), s.slug);
          slugByNorm.set(normalizePlaylistName(s.display_name), s.slug);
        }
        setPages(
          o.traktor
            .filter((r) => r.checked)
            .map((r) => ({
              name: r.name,
              slug: slugByNorm.get(normalizePlaylistName(r.name)) ?? null,
            }))
            .sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
            ),
        );
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { pages, error, reload };
}

// ---------------------------------------------------------------------------
// /compare — index of comparison pages with gap counts
// ---------------------------------------------------------------------------

interface PageStats {
  total: number;
  goGet: number;
  organize: number;
  stale: boolean;
}

function CompareIndex() {
  const { pages, error, reload } = useComparePages();
  const { status: pipeline, start } = usePipelineStatus();
  const [stats, setStats] = useState<Map<string, PageStats | "notrun">>(
    new Map(),
  );
  const [importOpen, setImportOpen] = useState(false);

  // Gap counts per page, from the joined results (survives app restarts,
  // unlike the in-process pipeline gap_counts).
  useEffect(() => {
    if (!pages) return;
    let disposed = false;
    void Promise.all(
      pages
        .filter((p): p is ComparePageRef & { slug: string } => p.slug !== null)
        .map(async (p): Promise<[string, PageStats | "notrun"]> => {
          try {
            const r = await getComparisonResults(p.slug);
            const organize = r.rows.filter(
              (row) => row.flag === "Not-Trak-Playlist / Yes-Trak-Collection",
            ).length;
            return [
              p.slug,
              {
                total: r.summary.total,
                goGet: r.summary.not_matched,
                organize,
                stale: r.stale,
              },
            ];
          } catch {
            return [p.slug, "notrun"];
          }
        }),
    ).then((entries) => {
      if (!disposed) setStats(new Map(entries));
    });
    return () => {
      disposed = true;
    };
  }, [pages]);

  // Reload the inventory after a pipeline run completes.
  const prevState = useRef<string | null>(null);
  useEffect(() => {
    const s = pipeline?.state ?? null;
    if (prevState.current === "running" && s === "completed") reload();
    prevState.current = s;
  }, [pipeline?.state, reload]);

  return (
    <div className="screen">
      <h1 className="screen-title">Playlist Compare Tool</h1>

      {error && (
        <div className="small" style={{ color: "var(--status-danger)" }}>
          {error}
        </div>
      )}

      {pages !== null && pages.length === 0 && (
        <div className="cmp-empty">
          <p>
            No playlists are set to compare yet. Export your Spotify®
            playlists as CSVs with Exportify, import them here, and each
            playlist checked in the comparison settings gets its own gap page
            after a pipeline run.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant="primary" onClick={() => setImportOpen(true)}>
              Import Spotify® Data
            </Button>
            <Link to="/comparison-settings">
              Choose Which Playlists Compare
            </Link>
          </div>
        </div>
      )}

      {pages !== null && pages.length > 0 && (
        <div className="panel cmp-index" style={{ padding: 8 }}>
          {pages.map((p) => {
            const s = p.slug ? stats.get(p.slug) : undefined;
            return (
              <div key={p.name} className="cmp-index__row">
                {p.slug ? (
                  <Link
                    className="cmp-index__name"
                    to={`/compare/${encodeURIComponent(p.slug)}`}
                  >
                    {p.name}
                  </Link>
                ) : (
                  <span className="cmp-index__name">{p.name}</span>
                )}
                <span className="cmp-index__counts">
                  {p.slug === null ? (
                    <span style={{ color: "var(--status-warn)" }}>
                      no Spotify® data — import it first
                    </span>
                  ) : s === undefined ? (
                    "…"
                  ) : s === "notrun" ? (
                    <span className="muted">not yet run</span>
                  ) : (
                    <>
                      {s.total} tracks · {s.goGet} Go get · {s.organize}{" "}
                      Organize
                      {s.stale && (
                        <span style={{ color: "var(--status-warn)" }}>
                          {" "}
                          · stale
                        </span>
                      )}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {importOpen && (
        <ImportSpotifyDataModal
          onClose={() => setImportOpen(false)}
          onImported={reload}
          runPipeline={start}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// /compare/:slug — the per-playlist comparison table
// ---------------------------------------------------------------------------

function ComparePage({ slug }: { slug: string }) {
  const toast = useUiStore((s) => s.toast);
  const { pages } = useComparePages();
  const { status: pipeline, unreachable, start } = usePipelineStatus();

  const [results, setResults] = useState<ComparisonResults | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<CompareFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortState | null>(null);
  const [notesBanner, setNotesBanner] = useState<string | null>(null);
  // Column visibility (#20) is shared across ALL compare playlists (ruling R5):
  // seeded from the per-screen localStorage key and deliberately NOT reset on
  // slug change (unlike filters/sort), so a user's column choices persist as
  // they tab between playlists and across reloads.
  const [columns, setColumns] = useState<ColumnVisibility>(loadColumnVisibility);
  const [colMenuAnchor, setColMenuAnchor] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const toggleColumn = useCallback(
    (id: CompareColumnId, visible: boolean) => {
      setColumns((prev) => {
        const next = setColumnVisible(prev, id, visible);
        saveColumnVisibility(next);
        return next;
      });
    },
    [],
  );

  // Reset per-playlist state the instant the slug changes (#22). ComparePage
  // is no longer remounted per tab, so filters/sort/results/etc. would
  // otherwise leak from the previous playlist into the next one. Doing this
  // during render (the React "adjust state when a prop changes" pattern)
  // discards the current output before commit, so no frame ever shows the old
  // playlist's rows/filters under the new tab.
  const prevSlug = useRef(slug);
  if (prevSlug.current !== slug) {
    prevSlug.current = slug;
    setResults(null);
    setNotFound(null);
    setLoadError(null);
    setFilters(EMPTY_FILTERS);
    setSort(null);
    setNotesBanner(null);
  }

  const load = useCallback(() => {
    getComparisonResults(slug)
      .then((r) => {
        setResults(r);
        setNotFound(null);
        setLoadError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(err.detail);
        } else {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  // After a pipeline run completes: refetch + surface the notes carry-forward
  // summary ("2 notes dropped (gaps resolved)").
  const prevState = useRef<string | null>(null);
  useEffect(() => {
    const s = pipeline?.state ?? null;
    if (prevState.current === "running" && s === "completed") {
      load();
      const text = notesSummaryText(pipeline?.notes_summary ?? null);
      if (text) setNotesBanner(text);
    }
    prevState.current = s;
  }, [pipeline?.state, pipeline?.notes_summary, load]);

  const rowIndex = useMemo(() => {
    const m = new Map<ComparisonResultRow, number>();
    results?.rows.forEach((r, i) => m.set(r, i));
    return m;
  }, [results]);

  const displayRows = useMemo(() => {
    if (!results) return [];
    return sortRows(applyFilters(results.rows, filters), sort);
  }, [results, filters, sort]);

  // Visible columns, in fixed display order, and a min-width so a wide visible
  // set scrolls horizontally in the wrapper rather than crushing the text
  // columns. Width strategy (comparison-output-table.md): under
  // `table-layout: fixed` the narrow columns (Flag/Local File/Spotify® Link)
  // take fixed px widths; the text columns (Track/Artist/Album) share the rest
  // equally. minWidth = Σ(fixed) + 200px per flexible text column keeps every
  // column legible; the table fills the container when it is wider than that.
  const cols = useMemo(() => visibleColumns(columns), [columns]);
  const tableMinWidth = useMemo(() => {
    let fixed = 0;
    let flex = 0;
    for (const c of cols) {
      if (c.width) fixed += c.width;
      else flex += 1;
    }
    return fixed + flex * 200;
  }, [cols]);

  const saveNote = useCallback(
    (row: ComparisonResultRow, side: NoteSide, text: string) => {
      const joinKey = noteJoinKey(row, side);
      putComparisonNote(slug, joinKey, side, text)
        .then(() => {
          setResults((prev) =>
            prev
              ? {
                  ...prev,
                  rows: prev.rows.map((r) =>
                    r === row
                      ? { ...r, note: text === "" ? null : { text, side } }
                      : r,
                  ),
                }
              : prev,
          );
        })
        .catch((err) => {
          toast(
            err instanceof Error ? err.message : "Failed to save the note",
            "error",
          );
        });
    },
    [slug, toast],
  );

  const runPipelineNow = () => {
    void start().then((err) => {
      if (err) toast(err, "error");
    });
  };

  const reveal = (path: string) => {
    fsReveal(path).catch((err) =>
      toast(
        err instanceof Error ? err.message : "Failed to reveal the file",
        "error",
      ),
    );
  };

  const headerCell = (column: SortColumn, label: string) => (
    <th
      key={column}
      onClick={() => setSort((s) => nextSort(s, column))}
      title="Click to sort — third click restores pipeline order"
      aria-sort={
        sort?.column === column
          ? sort.dir === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      {label}
      {sort?.column === column && (
        <span className="sort-arrow" aria-hidden>
          {sort.dir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </th>
  );

  // One <td> per visible column, in display order (#20). Track columns keep
  // their note-editing behavior; the four opt-in artist/album columns are plain
  // text with a hover tooltip; flag/file/link are unchanged.
  const renderCell = (col: CompareColumn, row: ComparisonResultRow) => {
    switch (col.id) {
      case "flag":
        return (
          <td key={col.id}>
            <FlagChip flag={row.flag} />
          </td>
        );
      case "traktorTrack":
        return (
          <TrackCell key={col.id} row={row} side="traktor" onSave={saveNote} />
        );
      case "spotifyTrack":
        return (
          <TrackCell key={col.id} row={row} side="spotify" onSave={saveNote} />
        );
      case "traktorArtist":
        return <TextCell key={col.id} value={row.traktor_artists} />;
      case "traktorAlbum":
        return <TextCell key={col.id} value={row.traktor_release_name} />;
      case "spotifyArtist":
        return <TextCell key={col.id} value={row.spotify_artists} />;
      case "spotifyAlbum":
        return <TextCell key={col.id} value={row.spotify_album_name} />;
      case "file":
        return (
          <td key={col.id}>
            {row.file_paths.map((p) => (
              <button
                key={p}
                type="button"
                className="cmp-action"
                title={p}
                onClick={() => reveal(p)}
              >
                <RevealIcon size={13} /> Reveal
              </button>
            ))}
          </td>
        );
      case "link": {
        const url = spotifyTrackUrl(row.spotify_uri);
        return (
          <td key={col.id}>
            {url && (
              <a
                className="cmp-action"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={row.spotify_uri}
              >
                Open <Icon name="external" size={11} />
              </a>
            )}
          </td>
        );
      }
    }
  };

  const tabs =
    pages !== null && pages.length > 1 ? (
      <nav className="cmp__tabs" aria-label="Comparison pages">
        {pages
          .filter((p) => p.slug !== null)
          .map((p) => (
            <Link
              key={p.slug}
              to={`/compare/${encodeURIComponent(p.slug as string)}`}
              className={`cmp__tab${p.slug === slug ? " cmp__tab--active" : ""}`}
            >
              {p.name}
            </Link>
          ))}
      </nav>
    ) : null;

  // The <h1> is the constant page title "Playlist Compare Tool" in every state
  // (#21); the selected playlist's display name is a subordinate secondary line
  // so the title persists once results load. During a tab switch the new slug's
  // results are still loading, so the secondary line falls back to the tab's
  // name from the page inventory (already loaded) and never flashes empty.
  // The header stays mounted across every state (loading / empty / error /
  // loaded) so switching tabs never blanks the screen (#22).
  const activeName = pages?.find((p) => p.slug === slug)?.name;
  const playlistName = results?.display_name ?? activeName ?? null;

  return (
    <div className="cmp">
      <div className="cmp__header">
        <h1 className="screen-title" style={{ marginBottom: 0 }}>
          Playlist Compare Tool
        </h1>
        {playlistName && (
          <span className="cmp__playlist-name" title={playlistName}>
            {playlistName}
          </span>
        )}
        {results && (
          <>
            {/* §9 summary line — exact decided format */}
            <span className="cmp__summary">
              {summaryLine(results.summary.total, results.summary.not_matched)}
            </span>
            <span className="small muted">
              generated {fmtDateTime(results.generated_at)}
            </span>
          </>
        )}
        {pipeline?.state === "running" && (
          <StatusChip variant="running">Running…</StatusChip>
        )}
      </div>

      {tabs}

      {notFound ? (
        // ---- checked-but-not-yet-run empty state (§9, §7.1-consistent) ----
        <div className="cmp-empty">
          <p>
            No comparison data for this playlist yet. The comparison table is
            generated by the pipeline — run it to build the Spotify® ↔
            Traktor® gap table for every checked playlist.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Button
              variant="primary"
              onClick={runPipelineNow}
              disabled={pipeline?.state === "running" || unreachable}
            >
              Read Collection &amp; Remake Tables
            </Button>
            {pipeline?.state === "running" && (
              <StatusChip variant="running">Running…</StatusChip>
            )}
          </div>
          <Link to="/comparison-settings" className="small">
            Choose Which Playlists Compare
          </Link>
        </div>
      ) : loadError ? (
        <div className="small" style={{ color: "var(--status-danger)" }}>
          {loadError}
        </div>
      ) : (
        <>
          {results?.stale && (
            <div className="cmp-banner cmp-banner--warn">
              <span>{STALE_BANNER}</span>
              <Button
                size="sm"
                onClick={runPipelineNow}
                disabled={pipeline?.state === "running" || unreachable}
              >
                Run the pipeline
              </Button>
            </div>
          )}

          {notesBanner && (
            <div className="cmp-banner cmp-banner--info">
              <span>Pipeline completed — {notesBanner}</span>
              <button
                type="button"
                className="cmp-banner__dismiss"
                onClick={() => setNotesBanner(null)}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {/* §8 filters — AND-combined, active state always visible.
              Stays mounted while the next playlist loads so the filter bar
              doesn't unmount+remount on tab switch (#22). */}
          <div className="cmp__filters">
            <span className="ni-label">Flags</span>
            {FLAGS_BY_LABEL.map((flag) => (
              <FlagFilterChip
                key={flag}
                flag={flag}
                active={filters.flags.includes(flag)}
                onToggle={() => setFilters((f) => toggleFlagFilter(f, flag))}
              />
            ))}
            <Toggle
              label="Noted cells"
              checked={filters.notedOnly}
              onChange={(v) => setFilters((f) => ({ ...f, notedOnly: v }))}
            />
            <Toggle
              label="Hide matched"
              checked={filters.hideMatched}
              onChange={(v) => setFilters((f) => ({ ...f, hideMatched: v }))}
            />
            <Button
              size="sm"
              aria-haspopup="dialog"
              aria-expanded={colMenuAnchor !== null}
              onClick={(e) => {
                if (colMenuAnchor) {
                  setColMenuAnchor(null);
                  return;
                }
                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                setColMenuAnchor({ left: rect.right - 220, top: rect.bottom + 4 });
              }}
            >
              Columns
            </Button>
            {results && filtersActive(filters) && (
              <span className="cmp__count">
                {filteredCountText(displayRows.length, results.rows.length)}
              </span>
            )}
          </div>

          {colMenuAnchor && (
            <ColumnsMenu
              anchor={colMenuAnchor}
              visibility={columns}
              onToggle={toggleColumn}
              onClose={() => setColMenuAnchor(null)}
            />
          )}

          {/* Only this table region swaps to a loading placeholder while the
              new playlist's rows load — the chrome above stays put (#22). */}
          <div className="cmp__tablewrap">
            {results ? (
              <>
                <table
                  className="cmp-table"
                  style={{ minWidth: tableMinWidth }}
                >
                  <colgroup>
                    {cols.map((c) => (
                      <col
                        key={c.id}
                        style={c.width ? { width: c.width } : undefined}
                      />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>{cols.map((c) => headerCell(c.id, c.label))}</tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => {
                      const key = rowIndex.get(row) ?? -1;
                      return (
                        <tr key={key}>
                          {cols.map((c) => renderCell(c, row))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {displayRows.length === 0 && (
                  <div className="small muted" style={{ padding: 16 }}>
                    No rows match the active filters.
                  </div>
                )}
              </>
            ) : (
              <div className="cmp__loading small muted">Loading…</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cells & chips
// ---------------------------------------------------------------------------

/** Flag chip (§4): friendly label, §5.5 colors, gap flags loudest. */
function FlagChip({ flag }: { flag: PresenceFlag }) {
  const meta = FLAG_META[flag];
  if (!meta) return <span className="cmp-flag cmp-flag--quiet">{flag}</span>;
  return meta.prominent ? (
    <span className="cmp-flag cmp-flag--loud" style={{ background: meta.color }}>
      {meta.label}
    </span>
  ) : (
    <span className="cmp-flag cmp-flag--quiet" style={{ color: meta.color }}>
      {meta.label}
    </span>
  );
}

function FlagFilterChip({
  flag,
  active,
  onToggle,
}: {
  flag: PresenceFlag;
  active: boolean;
  onToggle: () => void;
}) {
  const meta = FLAG_META[flag];
  return (
    <button
      type="button"
      className={`cmp-flagchip${active ? " cmp-flagchip--on" : ""}`}
      onClick={onToggle}
      aria-pressed={active}
    >
      <span className="cmp-flagchip__dot" style={{ background: meta.color }} />
      {meta.label}
    </button>
  );
}

/** Plain read-only text cell for the opt-in artist/album columns (#20). */
function TextCell({ value }: { value: string }) {
  return <td title={value || undefined}>{value}</td>;
}

/**
 * Track-name cell: real names render as text; blank cells are editable note
 * fields with §5 shading (gold = gap without note, noted = user note with no
 * fill + orange text, clear = quiet Spotify blank).
 */
function TrackCell({
  row,
  side,
  onSave,
}: {
  row: ComparisonResultRow;
  side: NoteSide;
  onSave: (row: ComparisonResultRow, side: NoteSide, text: string) => void;
}) {
  const state = noteCellState(row, side);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (state === "filled") {
    const name = side === "traktor" ? row.traktor_title : row.spotify_track_name;
    return <td title={name}>{name}</td>;
  }

  const editable = isNoteEditable(row, side);
  const noteText = row.note?.side === side ? row.note.text : "";
  const cls =
    state === "gold"
      ? "cmp-cell--gold"
      : state === "noted"
        ? "cmp-cell--noted"
        : "";

  const commit = () => {
    setEditing(false);
    if (draft !== noteText) onSave(row, side, draft);
  };

  return (
    <td className={cls}>
      {editing ? (
        <input
          className="cmp-note__input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onPaste={(e) => {
            // #142 — paste a URL over selected text to make it a link.
            const pasted = e.clipboardData.getData("text");
            if (!isPastedUrl(pasted)) return;
            const el = e.currentTarget;
            const start = el.selectionStart ?? draft.length;
            const end = el.selectionEnd ?? start;
            e.preventDefault();
            const next = applyLinkPaste(draft, start, end, pasted);
            setDraft(next.text);
            requestAnimationFrame(() =>
              el.setSelectionRange(next.caret, next.caret),
            );
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
          aria-label={`Note (${side} column)`}
        />
      ) : (
        <div
          className="cmp-note"
          role={editable ? "button" : undefined}
          tabIndex={editable ? 0 : undefined}
          title={
            editable
              ? noteText
                ? "Click to edit this note (empty deletes it)"
                : "Click to add a note"
              : undefined
          }
          onClick={() => {
            if (!editable) return;
            setDraft(noteText);
            setEditing(true);
          }}
          onKeyDown={(e) => {
            if (editable && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              setDraft(noteText);
              setEditing(true);
            }
          }}
        >
          {noteText && (
            <span className="cmp-note__text">
              {parseNoteSegments(noteText).map((seg, i) =>
                seg.kind === "link" ? (
                  // #142 — SM3 is fully offline; this opens in the user's
                  // browser as an ordinary external link and makes no request
                  // from the app. The click must not also open the note editor.
                  <a
                    key={i}
                    href={seg.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={seg.url}
                    className="cmp-note__link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {seg.text}
                  </a>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </span>
          )}
        </div>
      )}
    </td>
  );
}
