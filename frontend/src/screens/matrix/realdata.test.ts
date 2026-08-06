/**
 * Real-data verification harness — runs the two SIGNATURE WORKFLOWS
 * (track-playlist-matrix.md §5/§11, walkthrough §7.5) against a real
 * GET /api/matrix payload and cross-checks the filter engine against an
 * independent brute-force computation, plus timings for the §8 targets.
 *
 * Skipped unless SM3_MATRIX_FIXTURE points at a saved payload, e.g.:
 *   SM3_MATRIX_FIXTURE=/path/to/matrix.json npm test
 * so the ordinary `npm test` run needs no multi-MB fixture in the repo.
 */

import { describe, expect, it } from "vitest";
import type { MatrixData } from "../../lib/api";
// Ambient declarations for node:fs / process live in ./node-env.d.ts (the
// shared tsconfig has no @types/node and is frozen for this workstream).
import { existsSync, readFileSync } from "node:fs";
import {
  applyFilterSort,
  countMatches,
  filterIndices,
  prepareMatrix,
} from "./filtering";
import { emptyFilterState } from "./filterState";

const FIXTURE = process.env.SM3_MATRIX_FIXTURE ?? "";
const available = FIXTURE !== "" && existsSync(FIXTURE);

// describe.runIf still executes the suite body at collection time — keep the
// (multi-MB) file read behind the availability check.
const EMPTY: MatrixData = { generated_at: "", playlists: [], rows: [] };

describe.runIf(available)("signature workflows against the real matrix payload", () => {
  const data = available
    ? (JSON.parse(readFileSync(FIXTURE, "utf-8")) as MatrixData)
    : EMPTY;

  const t0 = performance.now();
  const prep = prepareMatrix(data);
  const prepMs = performance.now() - t0;

  it("loads the real dataset", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[real-data] ${data.rows.length} rows × ${data.playlists.length} playlists; prepareMatrix ${prepMs.toFixed(1)}ms`,
    );
    expect(data.rows.length).toBeGreaterThan(1000);
    expect(data.playlists.length).toBeGreaterThan(50);
  });

  it("workflow A: playlist = Disco Cosmic + On Super Playlist ≥ 1 + On Non-Super Playlist = 0 (one drawer pass)", () => {
    const disco = data.playlists.find((p) => p.name.toLowerCase().includes("discocosmic"));
    expect(disco).toBeDefined();
    const discoIdx = data.playlists.indexOf(disco!);

    const s = emptyFilterState();
    s.drawer.playlist = { on: true, path: disco!.path };
    s.drawer.onRootPl = { on: true, min: 1 };
    s.drawer.onNonRootPl = { on: true, min: 0, max: 0 };

    const t = performance.now();
    const hits = filterIndices(prep, s, "flats");
    const ms = performance.now() - t;

    // Independent brute-force over the raw payload (no shared code paths).
    const expected = data.rows.filter(
      (r) => r.m.includes(discoIdx) && r.root >= 1 && r.nonroot === 0,
    ).length;

    // eslint-disable-next-line no-console
    console.log(
      `[real-data] workflow A → ${hits.length} rows (filter pass ${ms.toFixed(1)}ms; playlist "${disco!.name}")`,
    );
    expect(hits.length).toBe(expected);
    expect(hits.length).toBeGreaterThan(0);
    expect(countMatches(prep, s, "flats")).toBe(expected);
  });

  it("workflow B: BPM 118–122 + key Gm, sorted import date oldest first", () => {
    const s = emptyFilterState();
    s.drawer.bpm = { on: true, min: 118, max: 122 };
    s.drawer.keys = { on: true, selected: ["Gm"] };
    s.sort = [{ col: "import_date", dir: "asc" }];

    const t = performance.now();
    const out = applyFilterSort(prep, s, "flats");
    const ms = performance.now() - t;

    const expected = data.rows.filter(
      (r) => r.bpm != null && r.bpm >= 118 && r.bpm <= 122 && r.key === "Gm",
    ).length;

    // eslint-disable-next-line no-console
    console.log(
      `[real-data] workflow B → ${out.length} rows (filter+sort ${ms.toFixed(1)}ms); ` +
        `oldest import: ${data.rows[out[0]].import_date} "${data.rows[out[0]].name}"`,
    );
    expect(out.length).toBe(expected);
    expect(out.length).toBeGreaterThan(0);

    // Oldest-first ordering holds across the whole result.
    const toNum = (d: string) => {
      const [y, m, dd] = d.split("/").map(Number);
      return y * 10000 + m * 100 + dd;
    };
    for (let i = 1; i < out.length; i++) {
      expect(toNum(data.rows[out[i]].import_date)).toBeGreaterThanOrEqual(
        toNum(data.rows[out[i - 1]].import_date),
      );
    }
  });

  it("stays interactive at full scale (live preview / full sort timings)", () => {
    // Unfiltered full sort by Track Name (worst common case).
    const s = emptyFilterState();
    s.sort = [{ col: "name", dir: "asc" }];
    let t = performance.now();
    const sorted = applyFilterSort(prep, s, "flats");
    const sortMs = performance.now() - t;
    expect(sorted.length).toBe(data.rows.length);

    // Live preview count (runs per keystroke in the drawer).
    const p = emptyFilterState();
    p.drawer.trackContains = { on: true, text: "remix" };
    t = performance.now();
    const n = countMatches(prep, p, "flats");
    const previewMs = performance.now() - t;

    // eslint-disable-next-line no-console
    console.log(
      `[real-data] full name sort ${sortMs.toFixed(1)}ms; live preview ("remix" → ${n}) ${previewMs.toFixed(1)}ms`,
    );
    expect(sortMs).toBeLessThan(500);
    expect(previewMs).toBeLessThan(100);
  });
});

describe.runIf(!available)("real-data harness", () => {
  it.skip("set SM3_MATRIX_FIXTURE=<matrix.json> to run the real-data workflows", () => {});
});
