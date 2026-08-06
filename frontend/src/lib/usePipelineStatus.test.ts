/**
 * comparisonSkipped — issue #5 warning-detection logic. A completed run whose
 * Spotify® comparison stages (stage3_compare / stage4_join) are in state
 * "warning" means the matrix built but the Exportify folder was empty/missing;
 * MatrixScreen uses this to show a calm, non-error note.
 */

import { describe, expect, it } from "vitest";
import { comparisonSkipped } from "./usePipelineStatus";
import type { PipelineStage, PipelineStatus } from "./api";

const stage = (
  id: string,
  state: PipelineStage["state"],
): PipelineStage => ({ stage: id, label: id, state, message: null });

function status(
  state: PipelineStatus["state"],
  stages: PipelineStage[],
): PipelineStatus {
  return {
    state,
    stages,
    started_at: null,
    finished_at: null,
    error: null,
    notes_summary: null,
    gap_counts: null,
  };
}

const FULL_RUN = [
  stage("stage1_load", "completed"),
  stage("stage2_playlists", "completed"),
  stage("stage3_compare", "completed"),
  stage("stage4_join", "completed"),
];

const SKIPPED_RUN = [
  stage("stage1_load", "completed"),
  stage("stage2_playlists", "completed"),
  stage("stage3_compare", "warning"),
  stage("stage4_join", "warning"),
];

describe("comparisonSkipped", () => {
  it("is false when there is no status", () => {
    expect(comparisonSkipped(null)).toBe(false);
  });

  it("is false for a completed full-data run (no warnings)", () => {
    expect(comparisonSkipped(status("completed", FULL_RUN))).toBe(false);
  });

  it("is true when a completed run skipped both Spotify stages", () => {
    expect(comparisonSkipped(status("completed", SKIPPED_RUN))).toBe(true);
  });

  it("is true when only stage3_compare is warning", () => {
    expect(
      comparisonSkipped(
        status("completed", [stage("stage3_compare", "warning")]),
      ),
    ).toBe(true);
  });

  it("is true when only stage4_join is warning", () => {
    expect(
      comparisonSkipped(status("completed", [stage("stage4_join", "warning")])),
    ).toBe(true);
  });

  it("is false while the run is still in flight", () => {
    expect(comparisonSkipped(status("running", SKIPPED_RUN))).toBe(false);
  });

  it("is false for an errored run", () => {
    expect(comparisonSkipped(status("error", FULL_RUN))).toBe(false);
  });

  it("ignores warnings on non-Spotify stages (e.g. notes_merge)", () => {
    expect(
      comparisonSkipped(
        status("completed", [
          ...FULL_RUN,
          stage("notes_merge", "warning"),
        ]),
      ),
    ).toBe(false);
  });
});
