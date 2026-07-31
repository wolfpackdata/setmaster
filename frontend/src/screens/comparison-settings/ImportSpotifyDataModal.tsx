import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  getExportifyCandidates,
  importExportify,
  type ExportifyCandidate,
  type ExportifyImportResult,
} from "../../lib/api";
import { useUiStore } from "../../store/uiStore";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { FsBrowserModal } from "../../components/FsBrowserModal";
import { brandText, candidateAge } from "./s8logic";
import "./exportify.css";

/**
 * Import Spotify® Data flow (exportify-import.md §3, §5) — the shared modal
 * behind every entry point (S8 toolbar, Home, S5 empty state).
 *
 * Default entry: backend Downloads scan pre-list (newest first, filename +
 * age, only valid candidates ticked). File-browser fallback for files
 * elsewhere. After import: batch summary (§5 format) + a "Run comparison
 * now?" prompt — the pipeline is prompt-to-run, never auto-run.
 */
export function ImportSpotifyDataModal({
  onClose,
  onImported,
  runPipeline,
}: {
  onClose: () => void;
  /** Fired after a successful import so the host screen can refresh. */
  onImported?: (result: ExportifyImportResult) => void;
  /** Host's pipeline starter (usePipelineStatus().start); resolves to an error message or null. */
  runPipeline: () => Promise<string | null>;
}) {
  const toast = useUiStore((s) => s.toast);
  const navigate = useNavigate();

  const [candidates, setCandidates] = useState<ExportifyCandidate[] | null>(
    null,
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [extraFiles, setExtraFiles] = useState<
    { path: string; filename: string }[]
  >([]);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportifyImportResult | null>(null);

  useEffect(() => {
    getExportifyCandidates()
      .then((list) => {
        setCandidates(list);
        // only valid candidates are ticked by default (§3.1)
        setTicked(new Set(list.filter((c) => c.valid).map((c) => c.path)));
      })
      .catch((err) => {
        setCandidates([]);
        setScanError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const toggle = (path: string) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const addBrowsedFile = (path: string) => {
    setBrowsing(false);
    const known = candidates?.find((c) => c.path === path);
    if (known && !known.valid) return; // stays listed as "not Exportify"
    const filename = path.split(/[\\/]/).pop() ?? path;
    setExtraFiles((prev) =>
      prev.some((f) => f.path === path) || known
        ? prev
        : [...prev, { path, filename }],
    );
    setTicked((prev) => new Set(prev).add(path));
  };

  const selectedPaths = useMemo(() => [...ticked], [ticked]);

  const doImport = async () => {
    setBusy(true);
    setImportError(null);
    try {
      const res = await importExportify(selectedPaths);
      setResult(res);
      onImported?.(res);
    } catch (err) {
      // zero valid files → single error message, nothing stored (§7)
      setImportError(
        err instanceof ApiError
          ? brandText(err.detail)
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    const err = await runPipeline();
    setBusy(false);
    if (err) toast(err, "error");
    onClose();
  };

  const openS8 = () => {
    onClose();
    navigate("/comparison-settings");
  };

  // ---- post-import view (§5) ----
  if (result) {
    const added = result.imported.filter((i) => i.added_to_config);
    const noMatch = result.imported.filter((i) => i.matched_traktor === null);
    return (
      <Modal title="Import Spotify® Data" onClose={onClose} width={520}>
        <p className="imp-summary">{brandText(result.summary)}</p>

        {added.map((i) => (
          <div key={i.slug} className="imp-detail">
            Added &lsquo;{i.display_name}&rsquo; to the comparison.
          </div>
        ))}
        {noMatch.map((i) => (
          <div key={i.slug} className="imp-detail imp-detail--warn">
            &lsquo;{i.display_name}&rsquo; — no Traktor® playlist with this
            name exists. Create the playlist in Traktor®, save the collection,
            then use Re-read Collection File.
          </div>
        ))}
        {result.skipped.map((s) => (
          <div key={s.path} className="imp-detail imp-detail--danger">
            Skipped {s.path.split(/[\\/]/).pop()} — {brandText(s.reason)}
          </div>
        ))}

        <div style={{ marginTop: 10 }}>
          <Button size="sm" onClick={openS8}>
            Change Which Playlists Compare
          </Button>
        </div>

        <div className="imp-runprompt">
          <span style={{ fontSize: "var(--type-body-size)" }}>Run comparison now?</span>
          <Button variant="primary" disabled={busy} onClick={() => void runNow()}>
            Run Comparison Now
          </Button>
          <Button disabled={busy} onClick={onClose}>
            Not Now
          </Button>
        </div>
      </Modal>
    );
  }

  // ---- pick-files view (§3.1) ----
  const hasRows = (candidates?.length ?? 0) + extraFiles.length > 0;

  // Secondary "leaves the app" affordance — same anchor pattern as the
  // Comparison Settings toolbar (external browser tab; user-clicked link is
  // allowed under the offline-only constraint). "Exportify" renders plain
  // (no ®) per 03-ui-design.md §1.3.
  const openExportifyLink = (
    <a
      className="btn"
      href="https://exportify.net"
      target="_blank"
      rel="noopener noreferrer"
      title="Open exportify.net in a new tab"
    >
      Open Exportify <Icon name="external" size={12} />
    </a>
  );

  return (
    <>
      <Modal
        title="Import Spotify® Data"
        onClose={onClose}
        width={520}
        footer={
          <>
            <span className="small" style={{ marginRight: "auto" }}>
              {ticked.size} file{ticked.size === 1 ? "" : "s"} selected
            </span>
            {openExportifyLink}
            <Button onClick={() => setBrowsing(true)}>Browse Files…</Button>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={ticked.size === 0 || busy}
              onClick={() => void doImport()}
            >
              {busy ? "Importing…" : "Import"}
            </Button>
          </>
        }
      >
        <p className="small" style={{ marginBottom: 10 }}>
          Exportify-shaped CSV files found in your Downloads folder, newest
          first. Tick the playlists to import — files are copied into
          SetMaster; your downloads are left in place.
        </p>

        {candidates === null && (
          <div className="small muted" style={{ padding: 12 }}>
            Scanning Downloads…
          </div>
        )}

        {scanError && (
          <div
            className="small"
            style={{ color: "var(--status-danger)", marginBottom: 8 }}
          >
            Downloads scan failed: {scanError}
          </div>
        )}

        {candidates !== null && (
          <div className="imp-list">
            {candidates.map((c) => (
              <label
                key={c.path}
                className={`imp-row${c.valid ? "" : " imp-row--invalid"}`}
                title={c.valid ? c.path : "Not a valid Exportify CSV"}
              >
                <input
                  type="checkbox"
                  checked={ticked.has(c.path)}
                  disabled={!c.valid}
                  onChange={() => toggle(c.path)}
                />
                <span className="imp-row__name">{c.display_name}</span>
                <span className="imp-row__file">{c.filename}</span>
                <span className="imp-row__age">
                  {c.valid ? candidateAge(c.mtime_iso) : "not Exportify"}
                </span>
              </label>
            ))}
            {extraFiles.map((f) => (
              <label key={f.path} className="imp-row" title={f.path}>
                <input
                  type="checkbox"
                  checked={ticked.has(f.path)}
                  onChange={() => toggle(f.path)}
                />
                <span className="imp-row__name">{f.filename}</span>
                <span className="imp-row__file">{f.path}</span>
              </label>
            ))}
            {!hasRows && (
              <div className="small muted" style={{ padding: 12 }}>
                No Exportify CSV files found in your Downloads folder. Open
                Exportify to download a playlist, or use Browse Files… to pick
                CSVs from another location.
                <div style={{ marginTop: 10 }}>{openExportifyLink}</div>
              </div>
            )}
          </div>
        )}

        {importError && (
          <div className="small" style={{ color: "var(--status-danger)" }}>
            {importError}
          </div>
        )}
      </Modal>

      {browsing && (
        <FsBrowserModal
          title="Choose an Exportify CSV"
          selectMode="file"
          fileFilter={(e) => e.name.toLowerCase().endsWith(".csv")}
          filterHint="Exportify CSV files (.csv)"
          onSelect={addBrowsedFile}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  );
}
