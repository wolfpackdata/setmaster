import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getComparisonOverview,
  getStatus,
  putComparisonConfig,
  type CollectionStatus,
  type ComparisonOverview,
  type ComparisonSpotifyRow,
} from "../../lib/api";
import { usePipelineStatus } from "../../lib/usePipelineStatus";
import { fmtChipDateTime, fmtDateTime } from "../../lib/format";
import { useUiStore } from "../../store/uiStore";
import { Button } from "../../components/Button";
import { StatusChip } from "../../components/StatusChip";
import { Icon } from "../../components/Icon";
import { ImportSpotifyDataModal } from "./ImportSpotifyDataModal";
import { CheckIcon, ConflictIcon, StopSignIcon } from "./icons";
import { brandText, coverageTone, orderTraktorRows } from "./s8logic";
import "./s8.css";

/**
 * S8 — Spotify®-Traktor® Comparison Settings (03-ui-design.md §5.8;
 * behavior: exportify-import.md §6–7). This page IS the comparison config:
 * the Traktor panel's checkboxes are the only editable control, persisted
 * via PUT /api/comparison/config.
 */
export default function ComparisonSettingsScreen() {
  const toast = useUiStore((s) => s.toast);
  const { status: pipeline, unreachable, start } = usePipelineStatus();

  const [overview, setOverview] = useState<ComparisonOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collection, setCollection] = useState<CollectionStatus | null>(null);
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const refresh = useCallback(() => {
    getComparisonOverview()
      .then((o) => {
        setOverview(o);
        setLoadError(null);
      })
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : String(err)),
      );
    getStatus()
      .then((s) => setCollection(s.collection))
      .catch(() => setCollection(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh both panels when a pipeline run finishes (Re-read Collection File).
  const prevPipelineState = useRef<string | null>(null);
  useEffect(() => {
    const s = pipeline?.state ?? null;
    if (
      prevPipelineState.current === "running" &&
      (s === "completed" || s === "error")
    ) {
      refresh();
    }
    prevPipelineState.current = s;
  }, [pipeline?.state, refresh]);

  const traktorNameByPath = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of overview?.traktor ?? []) m.set(r.path, r.name);
    return m;
  }, [overview]);

  const orderedTraktor = useMemo(
    () => orderTraktorRows(overview?.traktor ?? [], search),
    [overview, search],
  );

  const toggleChecked = (path: string) => {
    if (!overview) return;
    const prev = overview;
    const traktor = prev.traktor.map((r) =>
      r.path === path ? { ...r, checked: !r.checked } : r,
    );
    setOverview({ ...prev, traktor });
    putComparisonConfig(
      traktor.filter((r) => r.checked).map((r) => r.path),
    ).catch((err) => {
      setOverview(prev); // roll back the optimistic toggle
      toast(
        err instanceof Error ? err.message : "Failed to save the comparison config",
        "error",
      );
    });
  };

  const rereadCollection = () => {
    void start().then((err) => {
      if (err) toast(err, "error");
    });
  };

  // Compact §7.2 status chip while a run is in flight / after it finishes.
  const runChip = (() => {
    if (!pipeline || pipeline.state === "idle") return null;
    switch (pipeline.state) {
      case "running":
        return <StatusChip variant="running">Running…</StatusChip>;
      case "completed":
        return (
          <StatusChip variant="success">
            Completed {fmtChipDateTime(pipeline.finished_at)}
          </StatusChip>
        );
      case "error":
        return (
          <StatusChip variant="danger" title={pipeline.error ?? undefined}>
            Failed
          </StatusChip>
        );
      default:
        return null;
    }
  })();

  const traktorRows = overview?.traktor ?? [];
  const spotifyRows = overview?.spotify ?? [];

  return (
    <div className="s8">
      <div className="s8__toolbar">
        <h1 className="screen-title" style={{ marginBottom: 0 }}>
          Spotify®-Traktor® Comparison Settings
        </h1>
        <Button variant="primary" onClick={() => setImportOpen(true)}>
          Import Spotify® Data
        </Button>
        <Button
          onClick={rereadCollection}
          disabled={pipeline?.state === "running" || unreachable}
        >
          Re-read Collection File
        </Button>
        <span className="s8__stale">
          {collection?.exists
            ? `collection.nml last saved ${fmtDateTime(collection.mtime_iso)}`
            : collection
              ? "collection.nml not found at the configured path"
              : ""}
        </span>
        <a
          className="btn"
          href="https://exportify.net"
          target="_blank"
          rel="noopener noreferrer"
          title="Open exportify.net in a new tab"
        >
          Open Exportify <Icon name="external" size={12} />
        </a>
        {runChip}
      </div>

      {loadError && (
        <div
          className="small"
          style={{ color: "var(--status-danger)", marginBottom: 8 }}
        >
          {loadError}
        </div>
      )}

      <div className="s8__panels">
        {/* ---- Traktor panel (left, ~55%) ---- */}
        <section className="s8-panel s8-panel--traktor" aria-label="Traktor playlists">
          <div className="s8-panel__header">
            <span className="ni-label">
              Traktor® Playlists · {traktorRows.length}
            </span>
            <input
              type="search"
              className="s8-panel__search"
              placeholder="Search playlists…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search Traktor playlists"
            />
          </div>
          <div className="s8-panel__body">
            {traktorRows.length === 0 ? (
              <div className="s8-empty">
                <p>
                  No Traktor® collection has been read yet. Read the
                  collection to list its playlists here — SetMaster never
                  writes to your Traktor® collection file.
                </p>
                <Button
                  onClick={rereadCollection}
                  disabled={pipeline?.state === "running" || unreachable}
                >
                  Read Collection &amp; Remake Tables
                </Button>
              </div>
            ) : orderedTraktor.length === 0 ? (
              <div className="s8-empty">
                <p>No playlists match &ldquo;{search}&rdquo;.</p>
              </div>
            ) : (
              orderedTraktor.map((r) => {
                const tone = coverageTone(r.checked, r.coverage.state);
                return (
                  <label key={r.path} className="s8-trow" title={r.path}>
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={() => toggleChecked(r.path)}
                    />
                    <span className="s8-trow__name">{r.name}</span>
                    {tone && (
                      <span className={`s8-trow__coverage s8-trow__coverage--${tone}`}>
                        {brandText(r.coverage.text)}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </section>

        {/* ---- Spotify panel (right, ~45%) ---- */}
        <section className="s8-panel s8-panel--spotify" aria-label="Spotify data">
          <div className="s8-panel__header">
            <span className="ni-label">
              Spotify® Data · {spotifyRows.length}
            </span>
          </div>
          <div className="s8-panel__body">
            {spotifyRows.length === 0 ? (
              <div className="s8-empty">
                <p>
                  No Spotify® data yet. Export each playlist as a CSV from
                  Exportify, then import the downloads here — SetMaster copies
                  them in and matches them to your Traktor® playlists by name.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={() => setImportOpen(true)}>
                    Import Spotify® Data
                  </Button>
                  <a
                    className="btn"
                    href="https://exportify.net"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Exportify <Icon name="external" size={12} />
                  </a>
                </div>
              </div>
            ) : (
              spotifyRows.map((r) => (
                <SpotifyRow
                  key={r.slug}
                  row={r}
                  traktorNameByPath={traktorNameByPath}
                />
              ))
            )}
          </div>
        </section>
      </div>

      {importOpen && (
        <ImportSpotifyDataModal
          onClose={() => setImportOpen(false)}
          onImported={refresh}
          runPipeline={start}
        />
      )}
    </div>
  );
}

/** Spotify-panel row: display name · mono filename + import date · match indicator (§5.8). */
function SpotifyRow({
  row,
  traktorNameByPath,
}: {
  row: ComparisonSpotifyRow;
  traktorNameByPath: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const state = row.match.state;
  const danger = state !== "matched";

  const helperTitle =
    state === "none"
      ? "No Traktor® playlist matches this name. Create the playlist in Traktor®, save the collection, then Re-read Collection File."
      : state === "conflict"
        ? "Two Traktor® playlists match this name — resolve the naming conflict in Traktor®."
        : undefined;

  return (
    <div
      className={`s8-srow${danger ? " s8-srow--danger" : ""}`}
      title={helperTitle}
    >
      <div className="s8-srow__top">
        {state === "matched" && (
          <span
            className="s8-srow__icon--ok"
            title={`matched to ${
              traktorNameByPath.get(row.match.traktor_path ?? "") ??
              row.match.traktor_path
            }`}
          >
            <CheckIcon />
          </span>
        )}
        {danger && (
          <button
            type="button"
            className="s8-srow__expand s8-srow__icon--danger"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={
              state === "conflict"
                ? "Playlist name conflict — show details"
                : "No matching Traktor playlist — show help"
            }
          >
            {state === "conflict" ? <ConflictIcon /> : <StopSignIcon />}
          </button>
        )}
        <span className="s8-srow__name">{row.display_name}</span>
        <span className="s8-srow__meta">
          {row.filename} · {fmtDateTime(row.imported_at)}
        </span>
      </div>

      {danger && expanded && (
        <div className="s8-srow__helper">
          {state === "none" ? (
            <>
              No Traktor® playlist with this name exists — there is nothing to
              compare against. Create the playlist in Traktor®, save the
              collection, then use Re-read Collection File.
            </>
          ) : (
            <>
              Two Traktor® playlists match this name; SetMaster never picks
              one silently. Rename one of them in Traktor®, save the
              collection, then Re-read Collection File:
              {(row.match.candidates ?? []).map((c) => (
                <div key={c} className="mono">
                  {c}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
