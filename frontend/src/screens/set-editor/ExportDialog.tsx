/**
 * S2 Export dialog (planning/02-features/set-export.md; ui §5.2 ⋯ menu, §6.2
 * NI toggle chips, §7.3 feedback).
 *
 * A small dialog (not a takeover) with: a CSV / XLSX / Markdown format chooser
 * defaulting to settings.last_export_format, an editable filename preview
 * (§5), and an Export action. On confirm it remembers an edited filename
 * (PATCH export-filename) and the chosen format (PUT settings.last_export_format),
 * asks the backend to generate the file (exportSet), and triggers the browser
 * download. Read-only over set data — it never mutates rows or blocks editing.
 */

import { useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import { Button } from "../../components/Button";
import {
  exportSet,
  patchSetExportFilename,
  type ExportFormat,
  type KeyDisplayAs,
} from "../../lib/api";
import { useSettingsStore } from "../../store/settingsStore";
import { initialFilename, withFormatExt } from "./export-filename";

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "XLSX" },
  { value: "markdown", label: "Markdown" },
];

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportDialogProps {
  setId: string;
  setName: string;
  /** The set's remembered export filename (null until edited). */
  exportFilename: string | null;
  keyDisplayAs: KeyDisplayAs;
  onClose: () => void;
  /** Success toast — "Exported <filename>". */
  onExported: (filename: string) => void;
}

export function ExportDialog({
  setId,
  setName,
  exportFilename,
  keyDisplayAs,
  onClose,
  onExported,
}: ExportDialogProps) {
  const lastFormat = useSettingsStore((s) => s.settings.last_export_format);
  const updateSettings = useSettingsStore((s) => s.update);

  const [format, setFormat] = useState<ExportFormat>(lastFormat);
  const [filename, setFilename] = useState(() =>
    initialFilename(exportFilename, setName, lastFormat),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track whether the user edited the name — only edited names are remembered
  // per set (§5); an untouched default stays fresh (its date) on the server.
  const editedRef = useRef(false);

  const chooseFormat = (next: ExportFormat) => {
    if (next === format) return;
    setFormat(next);
    // Keep the filename's extension aligned to the selected format.
    setFilename((cur) => withFormatExt(cur, next));
  };

  const onFilenameChange = (value: string) => {
    editedRef.current = true;
    setFilename(value);
  };

  const doExport = async () => {
    const name = filename.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Remember the chosen format for next time (any set).
      if (format !== lastFormat) {
        await updateSettings({ last_export_format: format }).catch(() => {
          /* non-fatal: the export itself is what matters */
        });
      }
      // Remember an edited filename for this set.
      if (editedRef.current) {
        await patchSetExportFilename(setId, name);
      }
      const { blob, filename: served } = await exportSet(setId, format, keyDisplayAs);
      const finalName = served ?? name;
      triggerDownload(blob, finalName);
      onExported(finalName);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Export Set"
      onClose={busy ? () => {} : onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void doExport()}
            disabled={busy || filename.trim() === ""}
            autoFocus
          >
            {busy ? "Exporting…" : "Export"}
          </Button>
        </>
      }
    >
      <div className="se-export">
        <div className="se-export__field">
          <span className="ni-label">Format</span>
          <div className="se-export__chips" role="radiogroup" aria-label="Export format">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={format === f.value}
                className={`se-chip${format === f.value ? " se-chip--on" : ""}`}
                disabled={busy}
                onClick={() => chooseFormat(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <label className="se-export__field">
          <span className="ni-label">Filename</span>
          <input
            className="se-export__name"
            value={filename}
            spellCheck={false}
            disabled={busy}
            onChange={(e) => onFilenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void doExport();
              }
            }}
          />
        </label>

        {error && (
          <div className="se-export__error" role="alert">
            Export failed: {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
