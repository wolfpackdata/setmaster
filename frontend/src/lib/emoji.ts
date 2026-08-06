/**
 * Grapheme-cluster helpers for the Advanced Settings validation-list
 * constraints (planning/02-features/advanced-settings-validation-lists.md §2):
 *
 * - Lows / Level: max 16 characters counted as user-perceived characters
 *   (grapheme clusters), not bytes — a single emoji is 1.
 * - I like: exactly one emoji grapheme cluster per value (multi-codepoint
 *   emoji count as one); no letters/digits/punctuation.
 */

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

/** User-perceived character count (grapheme clusters). */
export function graphemeCount(value: string): number {
  if (segmenter) {
    let n = 0;
    for (const _ of segmenter.segment(value)) n++;
    return n;
  }
  // Fallback: code points (over-counts ZWJ sequences, never under-counts).
  return [...value].length;
}

// RGI_Emoji is a property-of-strings — it matches complete emoji sequences
// (ZWJ families, flags, keycaps, VS16 forms) and requires the `v` flag.
// Built at runtime with a fallback for engines without `v`-flag support.
const rgiEmoji: RegExp | null = (() => {
  try {
    return new RegExp("^\\p{RGI_Emoji}$", "v");
  } catch {
    return null;
  }
})();

/**
 * True when `value` is exactly one emoji grapheme cluster — the I-like
 * validation rule. Rejects letters, digits, punctuation, empty strings and
 * multi-emoji strings; accepts multi-codepoint emoji (e.g. ⚠️, 🎛️, 👨‍👩‍👧).
 */
export function isSingleEmoji(value: string): boolean {
  if (!value || graphemeCount(value) !== 1) return false;
  if (rgiEmoji) return rgiEmoji.test(value);
  // Fallback heuristic: must contain a pictographic scalar and no
  // letters/digits/whitespace.
  return (
    /\p{Extended_Pictographic}/u.test(value) &&
    !/[\p{L}\p{N}\s]/u.test(value)
  );
}
