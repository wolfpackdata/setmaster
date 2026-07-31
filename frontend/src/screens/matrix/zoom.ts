/**
 * Issue #81 — grid-only "Zoom" control for the Track-Playlist Matrix (S3).
 *
 * Zoom is implemented as CSS `zoom` on `.mx-gridwrap` (ruling R4): it scales the
 * whole grid subtree — headers, cells, row heights, column widths, padding —
 * while participating in layout, so the sticky header, both virtualizers, and
 * scroll extents stay internally consistent (the scroll container reports its
 * client/scroll sizes in the same logical coordinate space the virtualizer's
 * fixed `estimateSize` estimates live in). Everything OUTSIDE `.mx-gridwrap`
 * (sidebar, toolbar, search row, drawer, popovers) stays at 100%.
 *
 * Zoom is a MULTIPLIER on the rendered result of Font (text size) and Spacing
 * (row height): it is never folded into the stored column widths, font size, or
 * the row-height formula, so 80% → 100% round-trips pixel-exactly.
 */

/** §3.5 Matrix Zoom bounds (percent). */
export const MATRIX_ZOOM_MIN = 50;
export const MATRIX_ZOOM_MAX = 150;
export const MATRIX_ZOOM_STEP = 10;
export const MATRIX_ZOOM_DEFAULT = 100;

/** Clamp a zoom percentage into the valid 50–150 range. */
export function clampMatrixZoom(pct: number): number {
  return Math.min(MATRIX_ZOOM_MAX, Math.max(MATRIX_ZOOM_MIN, pct));
}

/** The CSS `zoom` factor for a zoom percentage (100 → 1). */
export function zoomFactor(pct: number): number {
  return pct / 100;
}

/**
 * Column resize under zoom (the #81 gotcha). Pointer drag deltas arrive in
 * screen (page) pixels, but stored column widths are UNZOOMED logical pixels.
 * At 80% zoom a 100px on-screen drag must add 100 / 0.8 = 125px of logical
 * width so the resized edge tracks the cursor 1:1. Divide the screen-pixel
 * delta by the zoom factor. Returns the new (unclamped) logical width; callers
 * clamp to MIN/MAX via the store.
 */
export function resizedColumnWidth(
  startWidth: number,
  deltaScreenPx: number,
  zoomPct: number,
): number {
  return startWidth + deltaScreenPx / zoomFactor(zoomPct);
}
