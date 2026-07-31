import { describe, expect, it } from "vitest";
import { graphemeCount, isSingleEmoji } from "./emoji";

describe("graphemeCount — 16-char limits count user-perceived characters", () => {
  it("counts ASCII per character", () => {
    expect(graphemeCount("cut-swell")).toBe(9);
    expect(graphemeCount("HOT-LP")).toBe(6);
    expect(graphemeCount("")).toBe(0);
  });

  it("counts a multi-codepoint emoji as 1", () => {
    expect(graphemeCount("⚠️")).toBe(1); // U+26A0 U+FE0F
    expect(graphemeCount("🎛️")).toBe(1); // U+1F39B U+FE0F
    expect(graphemeCount("👨‍👩‍👧")).toBe(1); // ZWJ family
    expect(graphemeCount("🚀🚀")).toBe(2);
  });
});

describe("isSingleEmoji — I-like validation (spec §2 / acceptance #2)", () => {
  it("accepts the factory vocabulary and 🎛️", () => {
    for (const e of ["🚀", "💜", "✔️", "⚠️", "🟥", "🎛️"]) {
      expect(isSingleEmoji(e), e).toBe(true);
    }
  });

  it("accepts multi-codepoint emoji as one grapheme", () => {
    expect(isSingleEmoji("👨‍👩‍👧")).toBe(true);
    expect(isSingleEmoji("👍🏽")).toBe(true); // skin-tone modifier
  });

  it("rejects letters, digits, punctuation", () => {
    for (const s of ["abc", "a", "!", "1", "?", " "]) {
      expect(isSingleEmoji(s), JSON.stringify(s)).toBe(false);
    }
  });

  it("rejects empty and multi-emoji strings", () => {
    expect(isSingleEmoji("")).toBe(false);
    expect(isSingleEmoji("🚀🚀")).toBe(false);
    expect(isSingleEmoji("✔️ ")).toBe(false);
  });
});
