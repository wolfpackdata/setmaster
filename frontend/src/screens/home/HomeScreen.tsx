import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSetsStore, validateSetName } from "../../store/setsStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { getStatus, type AppStatus } from "../../lib/api";
import { usePipelineStatus } from "../../lib/usePipelineStatus";
import { fmtChipDateTime, fmtDateTime, fmtRelative } from "../../lib/format";
import { Button } from "../../components/Button";
import { StatusChip } from "../../components/StatusChip";
import { NamePromptModal } from "../../components/NamePromptModal";
import { Icon } from "../../components/Icon";
import { ImportSpotifyDataModal } from "../comparison-settings/ImportSpotifyDataModal";

/**
 * S1 — Home (03-ui-design.md §5.1, replaces the SM2 LaunchPad tab).
 * Left: Sets (recents + New Set). Right: "Traktor® Collection Tools" —
 * config summary, the three pipeline action buttons (exact SM2 labels),
 * status chip, staleness text, Save Collection reminder.
 */
export default function HomeScreen() {
  const { sets, refresh } = useSetsStore();
  const setsStore = useSetsStore();
  const settings = useSettingsStore((s) => s.settings);
  const toast = useUiStore((s) => s.toast);
  const navigate = useNavigate();
  const { status: pipeline, unreachable, start } = usePipelineStatus();
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [newSetOpen, setNewSetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    void refresh();
    getStatus()
      .then(setAppStatus)
      .catch(() => setAppStatus(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh collection mtime after a run completes.
  const pipelineState = pipeline?.state;
  useEffect(() => {
    if (pipelineState === "completed" || pipelineState === "error") {
      getStatus()
        .then(setAppStatus)
        .catch(() => undefined);
    }
  }, [pipelineState]);

  const recents = useMemo(
    () =>
      [...sets]
        .sort((a, b) => b.modified_at.localeCompare(a.modified_at))
        .slice(0, 10),
    [sets],
  );

  const runPipeline = () => {
    void start().then((err) => {
      if (err) toast(err, "error");
    });
  };

  const chip = (() => {
    if (unreachable) {
      return <StatusChip variant="neutral">Backend unavailable</StatusChip>;
    }
    if (!pipeline) return <StatusChip variant="neutral">…</StatusChip>;
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
        return <StatusChip variant="danger">Failed</StatusChip>;
      default:
        return <StatusChip variant="neutral">Not run yet</StatusChip>;
    }
  })();

  const collection = appStatus?.collection;

  return (
    <div className="screen">
      <h1 className="screen-title">Home</h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 1fr) minmax(380px, 1fr)",
          gap: 24,
          maxWidth: 1100,
        }}
      >
        {/* ---- Left column: Sets ---- */}
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <h2
              className="section-heading"
              style={{ color: "var(--brand-purple)", marginBottom: 0 }}
            >
              Sets
            </h2>
            <Button size="sm" onClick={() => setNewSetOpen(true)}>
              <Icon name="plus" size={12} /> New Set
            </Button>
          </div>

          <div className="panel" style={{ padding: 8 }}>
            {recents.length === 0 ? (
              <p className="small" style={{ padding: 8 }}>
                No sets yet. Create your first set to start writing
                transitions.
              </p>
            ) : (
              recents.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigate(`/sets/${s.id}`)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 12,
                    alignItems: "center",
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-primary)",
                    background:
                      i % 2 === 0 ? "var(--bg-row)" : "var(--bg-row-alt)",
                    height: "var(--grid-row-height)",
                    padding: "0 10px",
                    fontSize: "var(--grid-font-size)",
                  }}
                  title={`Open "${s.name}"`}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.name}
                  </span>
                  <span className="small num">{fmtRelative(s.modified_at)}</span>
                  <span
                    className="small num"
                    style={{ minWidth: 64, textAlign: "right" }}
                  >
                    {s.track_count} tracks
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        {/* ---- Right column: Traktor® Collection Tools ---- */}
        <section>
          <h2
            className="section-heading"
            style={{ color: "var(--brand-purple)" }}
          >
            Traktor® Collection Tools
          </h2>

          <div className="panel">
            {/* Config summary (read-only; configuration lives in S6) */}
            <div style={{ marginBottom: 16 }}>
              <div className="ni-label" style={{ marginBottom: 6 }}>
                Configuration
              </div>
              <div className="small mono" style={{ wordBreak: "break-all" }}>
                {settings.collection_nml_path || (
                  <span className="muted">collection.nml path not set</span>
                )}
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                Super playlist folder:{" "}
                {settings.super_playlist_folder ? (
                  <span className="mono">{settings.super_playlist_folder}</span>
                ) : (
                  <span className="muted">not set</span>
                )}
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                <Link to="/settings">Edit in Settings</Link>
              </div>
            </div>

            {/* Pipeline actions — exact SM2 labels (established vocabulary) */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "flex-start",
                marginBottom: 16,
              }}
            >
              <Button onClick={() => navigate("/comparison-settings")}>
                Choose Which Playlists Compare
              </Button>
              <Button
                variant="primary"
                onClick={runPipeline}
                disabled={pipeline?.state === "running" || unreachable}
              >
                Read Collection &amp; Remake Tables
              </Button>
              <Button onClick={() => navigate("/settings#exclude-prefixes")}>
                Exclude Playlists by Prefix
              </Button>
              {/* Import Spotify® Data entry point (exportify-import.md §3) */}
              <Button onClick={() => setImportOpen(true)}>
                Import Spotify® Data
              </Button>
            </div>

            {/* Status chip + staleness + reminder */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {chip}
            </div>

            {pipeline?.state === "error" && pipeline.error && (
              <div
                className="small"
                style={{ color: "var(--status-danger)", marginTop: 8 }}
              >
                {pipeline.error}
              </div>
            )}

            {/* §7.2 running progress: step list + indeterminate orange bar */}
            {pipeline?.state === "running" && (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    overflow: "hidden",
                    background: "var(--bg-input)",
                    position: "relative",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "var(--accent-orange)",
                      width: "35%",
                      animation: "sm3-indeterminate 1.2s ease-in-out infinite",
                    }}
                  />
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {pipeline.stages.map((stage) => (
                    <li
                      key={stage.stage}
                      className="small"
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        padding: "2px 0",
                        color:
                          stage.state === "running"
                            ? "var(--accent-orange)"
                            : stage.state === "completed"
                              ? "var(--status-success)"
                              : stage.state === "error"
                                ? "var(--status-danger)"
                                : "var(--text-muted)",
                      }}
                    >
                      <span style={{ width: 12, textAlign: "center" }}>
                        {stage.state === "completed"
                          ? "✓"
                          : stage.state === "running"
                            ? "›"
                            : stage.state === "error"
                              ? "✕"
                              : "·"}
                      </span>
                      <span>{stage.label}</span>
                      {stage.message && (
                        <span className="muted">{stage.message}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* collection.nml staleness (§5.1, decided 2026-07-06) */}
            <div className="small" style={{ marginTop: 12 }}>
              {collection?.exists ? (
                <>collection.nml last saved {fmtDateTime(collection.mtime_iso)}</>
              ) : collection ? (
                <span style={{ color: "var(--status-warn)" }}>
                  collection.nml not found at the configured path
                </span>
              ) : null}
            </div>
            <div className="small" style={{ marginTop: 4 }}>
              Remember to Save Collection inside Traktor® before reading —
              SetMaster reads the last saved collection.nml.
            </div>

            {/* Per-playlist gap counts after a run (§5.5) */}
            {pipeline?.state === "completed" &&
              pipeline.gap_counts &&
              pipeline.gap_counts.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="ni-label" style={{ marginBottom: 6 }}>
                    Comparison gaps
                  </div>
                  {pipeline.gap_counts.map((g) => (
                    <div
                      key={g.slug}
                      className="small"
                      style={{ padding: "2px 0" }}
                    >
                      <Link to={`/compare/${encodeURIComponent(g.slug)}`}>
                        {g.display_name}
                      </Link>{" "}
                      — {g.go_get} to go get · {g.organize} to organize
                    </div>
                  ))}
                </div>
              )}
          </div>
        </section>
      </div>

      {importOpen && (
        <ImportSpotifyDataModal
          onClose={() => setImportOpen(false)}
          runPipeline={start}
        />
      )}

      {newSetOpen && (
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
          onClose={() => setNewSetOpen(false)}
        />
      )}
    </div>
  );
}
