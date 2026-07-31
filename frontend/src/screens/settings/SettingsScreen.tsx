import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import {
  backupUrl,
  fsReveal,
  getStatus,
  getValidationLists,
  restoreBackup,
  type AppStatus,
  type KeyDisplayAs,
  type ValidationLists,
} from "../../lib/api";
import { Button } from "../../components/Button";
import { FormField } from "../../components/FormField";
import { Toggle } from "../../components/Toggle";
import { Stepper } from "../../components/Stepper";
import { FsBrowserModal } from "../../components/FsBrowserModal";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ValidationListEditor } from "./ValidationListEditor";
import rmlMark from "../../assets/rml-mark.svg";
import traktorRootDir from "../../assets/traktor-root-dir.png";

/** §1.3.3 attribution/disclaimer line — exact wording, do not edit. */
const ATTRIBUTION =
  "SetMaster 3 is independent fan software and is not affiliated with, endorsed by, or sponsored by Native Instruments®, Spotify®, or Exportify. Traktor® is a registered trademark of Native Instruments GmbH. Spotify® is a registered trademark of Spotify AB.";

const KEY_DISPLAY_OPTIONS: { value: KeyDisplayAs; label: string }[] = [
  { value: "flats", label: "Musical notes with flats (Gbm)" },
  { value: "sharps", label: "Musical notes with sharps (F#m)" },
  { value: "camelot", label: "Camelot wheel values (11A)" },
  { value: "openkey", label: "Open Key values (4m)" },
];

/**
 * S6 — Settings (03-ui-design.md §5.6): Traktor connection, Spotify data,
 * Display (the four §3.5 global options), collapsed-by-default Advanced
 * Settings (editable validation lists), Backup/Restore, About block.
 */
export default function SettingsScreen() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const toast = useUiStore((s) => s.toast);
  const navigate = useNavigate();
  const location = useLocation();

  const [status, setStatus] = useState<AppStatus | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [nmlDraft, setNmlDraft] = useState<string | null>(null);
  const [nmlError, setNmlError] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState<string | null>(null);
  const [prefixDraft, setPrefixDraft] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lists, setLists] = useState<ValidationLists | null>(null);
  const [listsError, setListsError] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // Deep links like /settings#exclude-prefixes (from S1's Exclude Playlists by Prefix button).
  useEffect(() => {
    if (location.hash) {
      document
        .getElementById(location.hash.slice(1))
        ?.scrollIntoView({ block: "start" });
    }
  }, [location.hash]);

  const refreshLists = async () => {
    try {
      setLists(await getValidationLists());
      setListsError(null);
    } catch (err) {
      setListsError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (advancedOpen && !lists) void refreshLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedOpen]);

  const save = (patch: Parameters<typeof update>[0]) => {
    update(patch).catch((err) =>
      toast(err instanceof Error ? err.message : String(err), "error"),
    );
  };

  const commitNmlPath = (raw: string) => {
    const path = raw.trim();
    setNmlDraft(null);
    if (!path || path === settings.collection_nml_path) {
      setNmlError(null);
      return;
    }
    // Contract rule: the path must end with the filename exactly `collection.nml`.
    const basename = path.split(/[\\/]/).pop() ?? "";
    if (basename !== "collection.nml") {
      setNmlError("The file must be named exactly collection.nml.");
      setNmlDraft(path); // keep the invalid draft visible for correction
      return;
    }
    setNmlError(null);
    save({ collection_nml_path: path });
  };

  const commitFolder = (raw: string) => {
    const folder = raw.trim();
    setFolderDraft(null);
    if (folder !== settings.super_playlist_folder) {
      save({ super_playlist_folder: folder });
    }
  };

  const addPrefix = () => {
    const p = prefixDraft.trim();
    if (!p) return;
    if (settings.exclude_prefixes.includes(p)) {
      toast(`Prefix "${p}" is already excluded.`, "info");
      return;
    }
    setPrefixDraft("");
    save({ exclude_prefixes: [...settings.exclude_prefixes, p] });
  };

  const removePrefix = (p: string) => {
    save({
      exclude_prefixes: settings.exclude_prefixes.filter((x) => x !== p),
    });
  };

  const display = settings.display;

  const doRestore = async (file: File) => {
    setRestoring(true);
    try {
      await restoreBackup(file);
      toast("Backup restored. Reloading…", "success");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
      setRestoring(false);
    }
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Settings</h1>
      <div className="settings">
        {/* ---- Traktor connection ---- */}
        <section className="panel settings__section">
          <h2 className="section-heading" style={{ color: "var(--brand-purple)" }}>
            Traktor® connection
          </h2>

          <FormField
            label="collection.nml location"
            error={nmlError}
            hint={
              <>
                Point SetMaster at your Traktor® collection.nml file. It only
                ever reads it — SetMaster never changes collection.nml or any
                Native Instruments® file. Tip: choose Save Collection in
                Traktor® first so SetMaster sees your latest edits.
              </>
            }
            htmlFor="nml-path"
          >
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="nml-path"
                className="input mono"
                value={nmlDraft ?? settings.collection_nml_path}
                placeholder="e.g. C:\Users\you\Documents\Native Instruments\Traktor 3\collection.nml"
                onChange={(e) => setNmlDraft(e.target.value)}
                onBlur={(e) => commitNmlPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitNmlPath(e.currentTarget.value);
                }}
              />
              <Button onClick={() => setBrowserOpen(true)}>Browse…</Button>
            </div>

            {/* Collapsed by default so it doesn't crowd the field. Native
                <details> — no extra state, keyboard-accessible for free. */}
            <details className="settings__find">
              <summary className="settings__find-summary">
                Where do I find this?
              </summary>
              <div className="settings__find-body">
                <p style={{ margin: "0 0 6px" }}>
                  Your collection lives in Traktor®&rsquo;s Root Directory. To
                  find it from inside Traktor®:
                </p>
                <ol className="settings__find-steps">
                  <li>
                    Open Traktor® and go to <strong>Preferences</strong>.
                  </li>
                  <li>
                    Open <strong>File Management</strong>, then{" "}
                    <strong>Directories</strong>.
                  </li>
                  <li>
                    The <strong>Root Dir</strong> path is the folder that holds
                    your collection.nml.
                  </li>
                </ol>
                <p style={{ margin: "0 0 6px" }}>
                  On Windows and macOS it&rsquo;s usually:
                </p>
                <code className="settings__find-path">
                  …/Users/&lt;your name&gt;/Documents/Native
                  Instruments/Traktor x.x.x/collection.nml
                </code>
                <p style={{ margin: 0 }}>
                  Traktor® keeps a separate folder for each version you have
                  installed. If you see more than one Traktor® folder, pick the
                  newest one.
                </p>

                <figure className="settings__shot">
                  <img
                    src={traktorRootDir}
                    alt="Traktor Preferences: File Management → Directories, with the Root Dir path highlighted"
                    className="settings__shot-img"
                  />
                  <figcaption className="settings__shot-caption">
                    Screenshot: Traktor® Preferences → File Management
                  </figcaption>
                </figure>
              </div>
            </details>
          </FormField>

          <FormField
            label="Super playlist folder name"
            hint={
              <>
                The Traktor® folder holding your Super Playlists. Playlists
                inside it are the &ldquo;super&rdquo; playlists (On Super
                Playlist); every other playlist counts as non-super (On
                Non-Super Playlist). Only
                this folder needs a required structure — everything else can
                follow your existing organization.
              </>
            }
            htmlFor="super-folder"
          >
            <input
              id="super-folder"
              className="input"
              style={{ maxWidth: 320 }}
              value={folderDraft ?? settings.super_playlist_folder}
              placeholder="e.g. SuperPlaylists"
              onChange={(e) => setFolderDraft(e.target.value)}
              onBlur={(e) => commitFolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitFolder(e.currentTarget.value);
              }}
            />
          </FormField>

          <div id="exclude-prefixes" style={{ marginTop: 20 }}>
            <FormField
              label="Exclude Playlists by Prefix"
              hint="Traktor® playlists whose names start with any of these prefixes are excluded from the pipeline and the matrix."
              htmlFor="prefix-input"
            >
              <div className="chip-list" style={{ marginBottom: 8 }}>
                {settings.exclude_prefixes.map((p) => (
                  <span key={p} className="chip-list__chip">
                    {p}
                    <button
                      type="button"
                      className="chip-list__remove"
                      aria-label={`Remove prefix ${p}`}
                      onClick={() => removePrefix(p)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {settings.exclude_prefixes.length === 0 && (
                  <span className="small muted">No prefixes excluded.</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="prefix-input"
                  className="input mono"
                  style={{ maxWidth: 220 }}
                  value={prefixDraft}
                  placeholder="e.g. zz_"
                  onChange={(e) => setPrefixDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addPrefix();
                  }}
                />
                <Button size="sm" onClick={addPrefix} disabled={!prefixDraft.trim()}>
                  Add
                </Button>
              </div>
            </FormField>
          </div>
        </section>

        {/* ---- Spotify data ---- */}
        <section className="panel settings__section">
          <h2 className="section-heading" style={{ color: "var(--brand-purple)" }}>
            Spotify® data
          </h2>
          <p className="small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
            Spotify® playlists come in as CSV files downloaded from Exportify.
            Importing and choosing which playlists compare both live on the
            Comparison Settings page.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={() => navigate("/comparison-settings")}>
              Import Spotify® Data…
            </Button>
            <Button onClick={() => navigate("/comparison-settings")}>
              Choose Which Playlists Compare
            </Button>
          </div>
        </section>

        {/* ---- Display (§3.5 global options) ---- */}
        <section className="panel settings__section">
          <h2 className="section-heading" style={{ color: "var(--brand-purple)" }}>
            Display
          </h2>

          <FormField
            label="Spacing"
            hint="Controls the gap between lines, not font size — higher gives more room between rows, lower gives a denser grid. 100% matches Traktor®'s browse-list density."
          >
            <Stepper
              value={display.line_spacing}
              onChange={(v) => save({ display: { line_spacing: v } })}
              min={70}
              max={150}
              step={10}
              format={(v) => `${v}%`}
              ariaLabel="Spacing"
            />
          </FormField>

          <FormField
            label="Font size"
            hint="Grid and body text size. Row height follows it (composes with Spacing)."
          >
            <Stepper
              value={display.font_size}
              onChange={(v) => save({ display: { font_size: v } })}
              min={10}
              max={20}
              step={1}
              format={(v) => `${v}px`}
              ariaLabel="Font size"
            />
          </FormField>

          <FormField
            label="Key display as"
            hint="Applies everywhere a key is shown. Internally keys always stay in flats notation — this only changes how they render."
            htmlFor="key-display-as"
          >
            <select
              id="key-display-as"
              className="input"
              style={{ maxWidth: 320 }}
              value={display.key_display_as}
              onChange={(e) =>
                save({ display: { key_display_as: e.target.value as KeyDisplayAs } })
              }
            >
              {KEY_DISPLAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label="Colorful keys"
            hint="On: key text renders in its per-key color from the SM2 palette. Off: keys render like any other cell."
          >
            <Toggle
              checked={display.colorful_keys}
              onChange={(v) => save({ display: { colorful_keys: v } })}
              label={display.colorful_keys ? "On" : "Off"}
            />
          </FormField>

          {/* Issue #145 — labels are user vocabulary; render them verbatim,
              `T #` / `M #` spacing included. */}
          <FormField
            label="Loud T # Column"
            hint="On: the T # cue column takes the Out Track header color. Manual RED/YELLOW shading on a cell still wins."
          >
            <Toggle
              checked={display.loud_t_column}
              onChange={(v) => save({ display: { loud_t_column: v } })}
              label={display.loud_t_column ? "On" : "Off"}
            />
          </FormField>

          <FormField
            label="Loud M # Column"
            hint="On: the M # cue column takes the In Track header color. Manual RED/YELLOW shading on a cell still wins."
          >
            <Toggle
              checked={display.loud_m_column}
              onChange={(v) => save({ display: { loud_m_column: v } })}
              label={display.loud_m_column ? "On" : "Off"}
            />
          </FormField>
        </section>

        {/* ---- Advanced Settings (collapsed by default) ---- */}
        <section className="panel settings__section">
          <button
            type="button"
            className="settings__disclosure"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <span className="tree__disclosure" aria-hidden>
              {advancedOpen ? "▾" : "▸"}
            </span>
            <h2 className="section-heading" style={{ color: "var(--brand-coral)", marginBottom: 0 }}>
              Advanced Settings
            </h2>
          </button>

          {advancedOpen && (
            <div style={{ marginTop: 12 }}>
              <p className="small" style={{ marginBottom: 16 }}>
                Edits here apply globally, to every set — existing and new.
                Renames propagate to all rows; removed values stay in place in
                existing rows and just stop being offered.
              </p>
              {listsError && (
                <p className="small" style={{ color: "var(--status-danger)", marginBottom: 12 }}>
                  Could not load validation lists: {listsError}
                </p>
              )}
              {!lists && !listsError && <p className="small">Loading…</p>}
              {lists && (
                <div className="settings__vle-grid">
                  <ValidationListEditor
                    field="delta"
                    title="Pitch shift (Δ)"
                    constraintHint="Multiples of 0.5, between −12 and +12, shown with explicit sign."
                    values={lists.delta}
                    onRefresh={refreshLists}
                  />
                  <ValidationListEditor
                    field="lows"
                    title="Lows"
                    constraintHint="Any text up to 16 characters (emoji allowed); unique."
                    values={lists.lows}
                    onRefresh={refreshLists}
                  />
                  <ValidationListEditor
                    field="level"
                    title="Level"
                    constraintHint="Any text up to 16 characters (emoji allowed); unique."
                    values={lists.level}
                    onRefresh={refreshLists}
                  />
                  <ValidationListEditor
                    field="i_like"
                    title="I like"
                    constraintHint="Exactly one emoji per value."
                    values={lists.i_like}
                    onRefresh={refreshLists}
                  />
                </div>
              )}
            </div>
          )}
        </section>

        {/* ---- Data: backup / restore ---- */}
        <section className="panel settings__section">
          <h2 className="section-heading" style={{ color: "var(--brand-purple)" }}>
            Data
          </h2>

          {status && (
            <FormField
              label="Data folder"
              hint="Everything SetMaster stores — sets, notes, config, imported Spotify® data — lives here."
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="small mono" style={{ wordBreak: "break-all" }}>
                  {status.app_data_dir}
                </span>
                <Button
                  size="sm"
                  onClick={() =>
                    fsReveal(status.app_data_dir).catch((err) =>
                      toast(err instanceof Error ? err.message : String(err), "error"),
                    )
                  }
                >
                  Reveal
                </Button>
              </div>
            </FormField>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              onClick={() => {
                const a = document.createElement("a");
                a.href = backupUrl;
                a.download = "";
                a.click();
              }}
            >
              Back up all data
            </Button>
            <Button
              disabled={restoring}
              onClick={() => restoreInput.current?.click()}
            >
              Restore from backup…
            </Button>
            <input
              ref={restoreInput}
              type="file"
              accept=".zip,application/zip"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setRestoreFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </section>

        {/* ---- About (§1.3.4 lockup + §1.3.3 attribution) ---- */}
        <section className="panel settings__section settings__about">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={rmlMark} alt="RML" style={{ width: 26, height: 22 }} draggable={false} />
            <span style={{ fontSize: "var(--type-heading-size)", fontWeight: 700 }}>
              RML{" "}
              <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
                SetMaster
              </span>
            </span>
            <span className="small num">
              {status ? `v${status.app_version}` : ""}
            </span>
          </div>
          <p className="small" style={{ marginTop: 10, lineHeight: 1.6 }}>
            {ATTRIBUTION}
          </p>
          <p className="small" style={{ marginTop: 6 }}>
            Questions? See <Link to="/help">Help &amp; Reference</Link>.
          </p>
        </section>
      </div>

      {browserOpen && (
        <FsBrowserModal
          title="Locate collection.nml"
          selectMode="file"
          fileFilter={(e) => e.name.toLowerCase() === "collection.nml"}
          filterHint="Select your Traktor® collection.nml file."
          onSelect={(path) => {
            setBrowserOpen(false);
            setNmlError(null);
            setNmlDraft(null);
            save({ collection_nml_path: path });
          }}
          onClose={() => setBrowserOpen(false)}
        />
      )}

      {restoreFile && (
        <ConfirmDialog
          title="Restore from backup"
          message={`Restore "${restoreFile.name}"? This replaces ALL current SetMaster data — sets, notes, settings and imported Spotify® data — with the backup's contents.`}
          confirmLabel="Restore"
          danger
          onCancel={() => setRestoreFile(null)}
          onConfirm={() => {
            const f = restoreFile;
            setRestoreFile(null);
            void doRestore(f);
          }}
        />
      )}
    </div>
  );
}
