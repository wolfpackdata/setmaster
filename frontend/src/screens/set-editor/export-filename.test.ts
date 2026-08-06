import { describe, expect, it } from "vitest";
import {
  defaultFilename,
  initialFilename,
  slugify,
  withFormatExt,
} from "./export-filename";

describe("slugify (set-export §5)", () => {
  it("lowercases and turns spaces into hyphens", () => {
    expect(slugify("Kimma Bryan")).toBe("kimma-bryan");
  });

  it("strips filesystem-illegal characters", () => {
    expect(slugify('My: Set/Name?*"')).toBe("my-setname");
  });

  it("collapses repeated hyphens and trims edges", () => {
    expect(slugify("  --Big   Room--  ")).toBe("big-room");
  });

  it("falls back to 'set' when nothing survives", () => {
    expect(slugify("///")).toBe("set");
    expect(slugify("   ")).toBe("set");
  });
});

describe("defaultFilename", () => {
  it("is <slug>_<date>.<ext>", () => {
    const name = defaultFilename("Kimma Bryan", "xlsx");
    expect(name).toMatch(/^kimma-bryan_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(defaultFilename("Kimma Bryan", "markdown")).toMatch(/\.md$/);
    expect(defaultFilename("Kimma Bryan", "csv")).toMatch(/\.csv$/);
  });
});

describe("withFormatExt", () => {
  it("swaps a recognised export extension", () => {
    expect(withFormatExt("mix.xlsx", "csv")).toBe("mix.csv");
    expect(withFormatExt("mix.md", "xlsx")).toBe("mix.xlsx");
    expect(withFormatExt("mix.csv", "markdown")).toBe("mix.md");
  });

  it("preserves an unrecognised extension and appends", () => {
    expect(withFormatExt("my.set", "csv")).toBe("my.set.csv");
    expect(withFormatExt("plainname", "xlsx")).toBe("plainname.xlsx");
  });

  it("returns empty for an empty name", () => {
    expect(withFormatExt("   ", "csv")).toBe("");
  });
});

describe("initialFilename", () => {
  it("uses the remembered name with the current format's extension", () => {
    expect(initialFilename("my-set.xlsx", "Whatever", "csv")).toBe("my-set.csv");
  });

  it("computes the default when nothing is remembered", () => {
    expect(initialFilename(null, "Kimma Bryan", "csv")).toMatch(
      /^kimma-bryan_\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(initialFilename("", "Kimma Bryan", "xlsx")).toMatch(/^kimma-bryan_.*\.xlsx$/);
  });
});
