/**
 * Typed API client for the SM3 backend — one function per endpoint in
 * build-notes/api-contract.md. Same-origin `/api` (the dev server proxies to
 * http://127.0.0.1:8137; in production the backend serves the built frontend).
 *
 * Phase 2/3 agents: consume these functions and types; do not hand-roll fetch.
 */

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`API ${status}: ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function parseError(res: Response): Promise<never> {
  let detail = res.statusText || `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") detail = body.detail;
    else if (body.detail !== undefined) detail = JSON.stringify(body.detail);
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(res.status, detail);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) return parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Settings & status
// ---------------------------------------------------------------------------

export type KeyDisplayAs = "flats" | "sharps" | "camelot" | "openkey";
export type ExportFormat = "csv" | "xlsx" | "markdown";

export interface DisplaySettings {
  line_spacing: number;
  font_size: number;
  key_display_as: KeyDisplayAs;
  colorful_keys: boolean;
  /** Issue #81: grid-only Track-Playlist Matrix (S3) zoom, percentage 50–150. */
  matrix_zoom: number;
  /** Issue #140: show the S2 OUT TRACK TIMING group (M # / T # / Play Time). */
  show_timing_columns: boolean;
  /** Issue #140: show the S2 Mix Timer column. */
  show_mix_timer_column: boolean;
  /** Issue #145: render the T # cue column in the Out Track header color. */
  loud_t_column: boolean;
  /** Issue #145: render the M # cue column in the In Track header color. */
  loud_m_column: boolean;
}

export interface Settings {
  collection_nml_path: string;
  super_playlist_folder: string;
  exclude_prefixes: string[];
  display: DisplaySettings;
  last_export_format: ExportFormat;
}

export interface SettingsPatch {
  collection_nml_path?: string;
  super_playlist_folder?: string;
  exclude_prefixes?: string[];
  display?: Partial<DisplaySettings>;
  last_export_format?: ExportFormat;
}

export const getSettings = () => request<Settings>("/api/settings");

export const putSettings = (patch: SettingsPatch) =>
  request<Settings>("/api/settings", jsonInit("PUT", patch));

export interface CollectionStatus {
  path: string;
  exists: boolean;
  mtime_iso: string | null;
  last_read_iso: string | null;
  track_count: number | null;
}

export interface AppStatus {
  app_version: string;
  app_data_dir: string;
  collection: CollectionStatus;
  pipeline: PipelineStatus;
}

export const getStatus = () => request<AppStatus>("/api/status");

/** GET /api/backup streams a zip — navigate/anchor to this URL to download. */
export const backupUrl = "/api/backup";

export interface RestoreResult {
  detail?: string;
}

export async function restoreBackup(zip: File): Promise<RestoreResult> {
  const form = new FormData();
  form.append("file", zip);
  return request<RestoreResult>("/api/restore", { method: "POST", body: form });
}

// ---------------------------------------------------------------------------
// Filesystem browser
// ---------------------------------------------------------------------------

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  mtime_iso: string;
  size: number;
}

export interface FsListing {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

export const fsList = (path: string) =>
  request<FsListing>(`/api/fs/list?path=${encodeURIComponent(path)}`);

export const fsReveal = (path: string) =>
  request<void>("/api/fs/reveal", jsonInit("POST", { path }));

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export type PipelineState = "idle" | "running" | "completed" | "error";
// "warning" — a stage completed but was skipped or degraded (non-alarming),
// e.g. stage3_compare / stage4_join skipped because the Exportify folder was
// empty (issue #5). The overall run still reports "completed".
export type StageState =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "warning";

export interface PipelineStage {
  stage: string;
  label: string;
  state: StageState;
  message: string | null;
}

export interface NotesSummary {
  restored: number;
  dropped: number;
}

export interface GapCount {
  slug: string;
  display_name: string;
  go_get: number;
  organize: number;
}

export interface PipelineStatus {
  state: PipelineState;
  stages: PipelineStage[];
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  notes_summary: NotesSummary | null;
  gap_counts: GapCount[] | null;
}

export const runPipeline = () =>
  request<{ run_id: string }>("/api/pipeline/run", { method: "POST" });

export const getPipelineStatus = () =>
  request<PipelineStatus>("/api/pipeline/status");

// ---------------------------------------------------------------------------
// Matrix (S3)
// ---------------------------------------------------------------------------

export interface MatrixPlaylist {
  path: string;
  name: string;
  is_root: boolean;
}

export interface MatrixRow {
  tk: string; // track_key
  name: string;
  artist: string;
  album: string;
  bpm: number | null;
  key: string | null; // canonical flats
  import_date: string;
  release_date: string;
  last_played: string;
  playcount: number;
  root: number;
  nonroot: number;
  file_path: string;
  m: number[]; // indices into playlists
}

export interface MatrixData {
  generated_at: string;
  playlists: MatrixPlaylist[];
  rows: MatrixRow[];
}

export const getMatrix = () => request<MatrixData>("/api/matrix");

export interface TrackSearchHit {
  name: string;
  artist: string;
}

export const searchTracks = (q: string) =>
  request<TrackSearchHit[]>(`/api/search/tracks?q=${encodeURIComponent(q)}`);

// ---------------------------------------------------------------------------
// Sets (S2)
// ---------------------------------------------------------------------------

export interface SetMeta {
  id: string;
  name: string;
  folder: string | null;
  created_at: string;
  modified_at: string;
  archived: boolean;
  archived_at: string | null;
  track_count: number;
}

export interface SetRow {
  id: string; // client uuid
  bpm: string;
  key: string;
  in_name: string;
  in_delta: string;
  m_num: string;
  t_num: string;
  a_num: string;
  lows: string;
  level: string;
  swap_lows: string;
  i_like: string;
  notes: string;
  start: string;
  transition: string;
}

export type FillColor = "red" | "yellow";

export interface CellFill {
  row_id: string;
  col: string;
  color: FillColor;
}

export interface CellBox {
  row_ids: string[];
  cols: string[];
}

export interface SetFormatting {
  fills: CellFill[];
  boxes: CellBox[];
}

export interface SetDetail extends SetMeta {
  rows: SetRow[];
  formatting: SetFormatting;
  export_filename: string;
}

export const listSets = (archived = false) =>
  request<SetMeta[]>(`/api/sets?archived=${archived}`);

export const createSet = (name: string, folder?: string) =>
  request<SetMeta>("/api/sets", jsonInit("POST", { name, folder }));

export const getSet = (id: string) => request<SetDetail>(`/api/sets/${id}`);

export const patchSet = (id: string, patch: { name?: string; folder?: string | null }) =>
  request<SetMeta>(`/api/sets/${id}`, jsonInit("PATCH", patch));

export const duplicateSet = (id: string) =>
  request<SetMeta>(`/api/sets/${id}/duplicate`, { method: "POST" });

export const putSetRows = (id: string, rows: SetRow[]) =>
  request<void>(`/api/sets/${id}/rows`, jsonInit("PUT", rows));

export const putSetFormatting = (id: string, formatting: SetFormatting) =>
  request<void>(`/api/sets/${id}/formatting`, jsonInit("PUT", formatting));

export const patchSetExportFilename = (id: string, filename: string) =>
  request<void>(`/api/sets/${id}/export-filename`, jsonInit("PATCH", { filename }));

export const archiveSet = (id: string) =>
  request<void>(`/api/sets/${id}/archive`, { method: "POST" });

export const restoreSet = (id: string, newName?: string) =>
  request<void>(
    `/api/sets/${id}/restore`,
    jsonInit("POST", newName ? { new_name: newName } : {}),
  );

/** Only archived sets can be deleted (409 otherwise). */
export const deleteSet = (id: string) =>
  request<void>(`/api/sets/${id}`, { method: "DELETE" });

/** Returns the export file as a Blob plus the server-chosen filename. */
export async function exportSet(
  id: string,
  format: ExportFormat,
  keyDisplayAs: KeyDisplayAs,
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(`/api/sets/${id}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, key_display_as: keyDisplayAs }),
  });
  if (!res.ok) return parseError(res);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(disposition);
  return {
    blob: await res.blob(),
    filename: match ? decodeURIComponent(match[1]) : null,
  };
}

// ---------------------------------------------------------------------------
// Validation lists (S6 Advanced Settings)
// ---------------------------------------------------------------------------

export type ValidationField = "delta" | "lows" | "level" | "i_like";

export type ValidationLists = Record<ValidationField, string[]>;

export const getValidationLists = () =>
  request<ValidationLists>("/api/validation-lists");

export const putValidationList = (field: ValidationField, values: string[]) =>
  request<void>(`/api/validation-lists/${field}`, jsonInit("PUT", { values }));

export const renameValidationValue = (
  field: ValidationField,
  oldValue: string,
  newValue: string,
) =>
  request<{ rows_updated: number }>(
    `/api/validation-lists/${field}/rename`,
    jsonInit("POST", { old: oldValue, new: newValue }),
  );

export const resetValidationList = (field: ValidationField) =>
  request<ValidationLists | void>(`/api/validation-lists/${field}/reset`, {
    method: "POST",
  });

export const getValidationUsage = (field: ValidationField, value: string) =>
  request<{ count: number }>(
    `/api/validation-lists/${field}/usage?value=${encodeURIComponent(value)}`,
  );

// ---------------------------------------------------------------------------
// Exportify / comparison (S8, S5)
// ---------------------------------------------------------------------------

export interface ExportifyCandidate {
  path: string;
  filename: string;
  mtime_iso: string;
  size: number;
  slug: string;
  display_name: string;
  valid: boolean;
}

export const getExportifyCandidates = () =>
  request<ExportifyCandidate[]>("/api/exportify/candidates");

export interface ExportifyImportResult {
  imported: {
    slug: string;
    display_name: string;
    added_to_config: boolean;
    matched_traktor: string | null;
  }[];
  skipped: { path: string; reason: string }[];
  already_configured: number;
  summary: string;
}

export const importExportify = (paths: string[]) =>
  request<ExportifyImportResult>(
    "/api/exportify/import",
    jsonInit("POST", { paths }),
  );

export interface ExportifyImport {
  slug: string;
  display_name: string;
  original_filename: string;
  imported_at: string;
  source_mtime: string;
  row_count: number;
}

export const getExportifyImports = () =>
  request<ExportifyImport[]>("/api/exportify/imports");

export type CoverageState = "fresh" | "stale" | "none";
export type SpotifyMatchState = "matched" | "none" | "conflict";

export interface ComparisonTraktorRow {
  path: string;
  name: string;
  checked: boolean;
  coverage: { state: CoverageState; text: string };
}

export interface ComparisonSpotifyRow {
  slug: string;
  display_name: string;
  filename: string;
  imported_at: string;
  match: {
    state: SpotifyMatchState;
    traktor_path?: string;
    candidates?: string[];
  };
}

export interface ComparisonOverview {
  traktor: ComparisonTraktorRow[];
  spotify: ComparisonSpotifyRow[];
}

export const getComparisonOverview = () =>
  request<ComparisonOverview>("/api/comparison/overview");

export const putComparisonConfig = (checkedPaths: string[]) =>
  request<void>(
    "/api/comparison/config",
    jsonInit("PUT", { checked_paths: checkedPaths }),
  );

export type PresenceFlag =
  | "Yes-Trak-Playlist"
  | "Not-Trak-Collection"
  | "Not-Trak-Playlist / Yes-Trak-Collection"
  | "Not-Spotify / Yes-Trak-Playlist";

export type NoteSide = "traktor" | "spotify";

export interface ComparisonResultRow {
  flag: PresenceFlag;
  traktor_title: string;
  spotify_track_name: string;
  /** Artist/album pass-through from the joined CSV (issue #20) — opt-in cols. */
  traktor_artists: string;
  spotify_artists: string;
  traktor_release_name: string;
  spotify_album_name: string;
  file_paths: string[];
  spotify_uri: string;
  spotify_trackjoin: string;
  trak_trackjoin: string;
  note: { text: string; side: NoteSide } | null;
}

export interface ComparisonResults {
  display_name: string;
  generated_at: string;
  stale: boolean;
  summary: { total: number; not_matched: number };
  rows: ComparisonResultRow[];
}

export const getComparisonResults = (slug: string) =>
  request<ComparisonResults>(
    `/api/comparison/results/${encodeURIComponent(slug)}`,
  );

export const putComparisonNote = (
  slug: string,
  joinKey: string,
  side: NoteSide,
  text: string,
) =>
  request<void>(
    "/api/comparison/notes",
    jsonInit("PUT", { slug, join_key: joinKey, side, text }),
  );
