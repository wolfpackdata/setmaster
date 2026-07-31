import { describe, expect, it } from "vitest";
import type { ComparisonTraktorRow } from "../../lib/api";
import {
  ageDays,
  ageText,
  brandText,
  candidateAge,
  coverageTone,
  normalizePlaylistName,
  orderTraktorRows,
} from "./s8logic";

function tRow(
  name: string,
  checked: boolean,
  state: "fresh" | "stale" | "none" = "none",
): ComparisonTraktorRow {
  return {
    path: `/$ROOT/RML root/${name}`,
    name,
    checked,
    coverage: { state, text: state === "none" ? "no Spotify data" : "data 2 days old" },
  };
}

describe("playlist-name normalization (exportify-import §4)", () => {
  it("underscores → spaces → remove all spaces → lowercase", () => {
    expect(normalizePlaylistName("disco_cosmic")).toBe("discocosmic");
    expect(normalizePlaylistName("Disco Cosmic")).toBe("discocosmic");
    expect(normalizePlaylistName("DISCOCOSMIC")).toBe("discocosmic");
  });

  it("keeps punctuation significant", () => {
    expect(normalizePlaylistName("kootz-4")).not.toBe(
      normalizePlaylistName("kootz4"),
    );
  });
});

describe("Traktor panel ordering (§5.8: checked-first, each group A–Z)", () => {
  const rows = [
    tRow("Zebra", false),
    tRow("alpha", false),
    tRow("Vibe N Roll", true),
    tRow("Disco Cosmic", true),
    tRow("beta", false),
  ];

  it("groups checked before unchecked, each alphabetized", () => {
    expect(orderTraktorRows(rows, "").map((r) => r.name)).toEqual([
      "Disco Cosmic",
      "Vibe N Roll",
      "alpha",
      "beta",
      "Zebra",
    ]);
  });

  it("search filters case-insensitively without breaking grouping", () => {
    expect(orderTraktorRows(rows, "b").map((r) => r.name)).toEqual([
      "Vibe N Roll",
      "beta",
      "Zebra",
    ]);
    expect(orderTraktorRows(rows, "disco").map((r) => r.name)).toEqual([
      "Disco Cosmic",
    ]);
  });

  it("does not mutate the input array", () => {
    const before = rows.map((r) => r.name);
    orderTraktorRows(rows, "");
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe("coverage tone (§5.8)", () => {
  it("checked + fresh → quiet muted text", () => {
    expect(coverageTone(true, "fresh")).toBe("muted");
  });
  it("checked + stale or no data → amber warning", () => {
    expect(coverageTone(true, "stale")).toBe("warn");
    expect(coverageTone(true, "none")).toBe("warn");
  });
  it("unchecked → coverage slot empty", () => {
    expect(coverageTone(false, "fresh")).toBeNull();
    expect(coverageTone(false, "none")).toBeNull();
  });
});

describe("trademark decoration of rendered backend copy (§1.3.2)", () => {
  it("adds ® to Traktor / Spotify / Native Instruments", () => {
    expect(
      brandText(
        "Imported 12 playlists · 9 added to comparison · 2 already configured · 1 not found in Traktor.",
      ),
    ).toBe(
      "Imported 12 playlists · 9 added to comparison · 2 already configured · 1 not found in Traktor®.",
    );
    expect(brandText("no Spotify data")).toBe("no Spotify® data");
    expect(brandText("by Native Instruments GmbH")).toBe(
      "by Native Instruments® GmbH",
    );
  });

  it("is idempotent and leaves Exportify plain", () => {
    expect(brandText("Traktor® and Spotify®")).toBe("Traktor® and Spotify®");
    expect(brandText(brandText("not found in Traktor."))).toBe(
      "not found in Traktor®.",
    );
    expect(brandText("Open Exportify")).toBe("Open Exportify");
  });

  it("repairs the backend's double-encoded middle-dot separator", () => {
    // Real backend batch-summary emission: "·" arrives as "Â·".
    expect(
      brandText(
        "Imported 12 playlists Â· 9 added to comparison Â· 1 not found in Traktor.",
      ),
    ).toBe(
      "Imported 12 playlists · 9 added to comparison · 1 not found in Traktor®.",
    );
  });
});

describe("download/staleness day-age text (§3.1, §3.5)", () => {
  const now = new Date("2026-07-06T12:00:00Z");

  it("computes whole days, clamped at zero", () => {
    expect(ageDays("2026-07-06T09:00:00Z", now)).toBe(0);
    expect(ageDays("2026-07-05T09:00:00Z", now)).toBe(1);
    expect(ageDays("2026-05-24T12:00:00Z", now)).toBe(43);
    expect(ageDays("2026-07-07T12:00:00Z", now)).toBe(0); // clock skew → clamp
    expect(ageDays("not-a-date", now)).toBeNull();
  });

  it("renders today / 1 day old / N days old", () => {
    expect(ageText(0)).toBe("today");
    expect(ageText(1)).toBe("1 day old");
    expect(ageText(43)).toBe("43 days old");
    expect(ageText(null)).toBe("");
  });

  it("candidateAge composes both", () => {
    expect(candidateAge("2026-07-04T12:00:00Z", now)).toBe("2 days old");
  });
});
