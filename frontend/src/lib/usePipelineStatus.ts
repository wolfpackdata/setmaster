import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPipelineStatus,
  runPipeline,
  ApiError,
  type PipelineStatus,
} from "./api";

const RUNNING_POLL_MS = 1500;
const IDLE_POLL_MS = 15000;

/**
 * Pipeline stage ids for the two Spotify® comparison stages. The backend
 * pipeline emits these ids (not the app's short names); when the Exportify
 * folder is empty/missing it skips them together with state "warning" while the
 * run still completes and the matrix builds (issue #5).
 */
const SPOTIFY_COMPARISON_STAGE_IDS = new Set(["stage3_compare", "stage4_join"]);

/**
 * True when the most recent run completed but skipped the Spotify® comparison
 * because the Exportify folder was empty/missing (issue #5). Pure so it can be
 * unit-tested and shared by any screen that wants to surface a calm, non-error
 * note (e.g. MatrixScreen). Detects the exact backend signal: a completed run
 * whose stage3_compare / stage4_join entries are in state "warning".
 */
export function comparisonSkipped(status: PipelineStatus | null): boolean {
  if (!status || status.state !== "completed") return false;
  return status.stages.some(
    (s) => SPOTIFY_COMPARISON_STAGE_IDS.has(s.stage) && s.state === "warning",
  );
}

/**
 * Polls GET /api/pipeline/status — fast while a run is in flight, slowly
 * otherwise (§7.2: never block the UI during a run). Shared by S1 and any
 * screen showing the compact status chip.
 */
export function usePipelineStatus() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const disposed = useRef(false);

  const poll = useCallback(async () => {
    window.clearTimeout(timer.current);
    let next = IDLE_POLL_MS;
    try {
      const s = await getPipelineStatus();
      if (disposed.current) return;
      setStatus(s);
      setUnreachable(false);
      if (s.state === "running") next = RUNNING_POLL_MS;
    } catch {
      if (disposed.current) return;
      setUnreachable(true);
    }
    timer.current = window.setTimeout(() => void poll(), next);
  }, []);

  useEffect(() => {
    disposed.current = false;
    void poll();
    return () => {
      disposed.current = true;
      window.clearTimeout(timer.current);
    };
  }, [poll]);

  /** POST /api/pipeline/run; a 409 (already running) just tightens polling. */
  const start = useCallback(async (): Promise<string | null> => {
    try {
      await runPipeline();
      await poll();
      return null;
    } catch (err) {
      await poll();
      if (err instanceof ApiError && err.status === 409) {
        return "A pipeline run is already in progress.";
      }
      return err instanceof Error ? err.message : String(err);
    }
  }, [poll]);

  return { status, unreachable, start, refresh: poll };
}
