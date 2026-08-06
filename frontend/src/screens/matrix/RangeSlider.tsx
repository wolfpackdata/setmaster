/**
 * Dual-handle range slider for the BPM drawer line (§5 line 2) — linked to
 * the min/max numeric fields. Handles are pointer targets only (tabIndex -1):
 * the §5 keyboard rule routes Tab through text fields, skipping slider handles.
 *
 * Issue #75: the highlighted fill band between the handles is itself grabbable —
 * dragging it slides the whole window up/down the (linear) BPM spectrum,
 * preserving its width and clamping at the domain edges without shrinking it.
 */

import { useCallback, useRef } from "react";

/**
 * Slide a [lo, hi] window by `delta` value units, preserving its width and
 * clamping to [domainMin, domainMax] WITHOUT shrinking (issue #75 fill-drag).
 * Pure so it is unit-testable in vitest's node env.
 */
export function slideWindow(
  lo: number,
  hi: number,
  delta: number,
  domainMin: number,
  domainMax: number,
): { lo: number; hi: number } {
  const width = hi - lo;
  // A window wider than the domain can only pin to the low edge.
  if (width >= domainMax - domainMin) {
    return { lo: domainMin, hi: domainMin + width };
  }
  let nlo = lo + delta;
  if (nlo < domainMin) nlo = domainMin;
  if (nlo + width > domainMax) nlo = domainMax - width;
  return { lo: nlo, hi: nlo + width };
}

export function RangeSlider({
  domainMin,
  domainMax,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  domainMin: number;
  domainMax: number;
  /** null = unset (renders at the domain edge). */
  min: number | null;
  max: number | null;
  step?: number;
  disabled?: boolean;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"min" | "max" | "band" | null>(null);
  // Fill-drag anchor: pointer value + window bounds captured at pointer-down, so
  // the slide stays absolute (delta from anchor) across re-renders.
  const bandAnchor = useRef<{ v: number; lo: number; hi: number } | null>(null);

  const lo = min ?? domainMin;
  const hi = max ?? domainMax;
  const span = Math.max(1e-9, domainMax - domainMin);
  const pct = (v: number) =>
    Math.max(0, Math.min(100, ((v - domainMin) / span) * 100));

  const valueAt = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return domainMin;
      const rect = el.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = domainMin + frac * span;
      return Math.round(raw / step) * step;
    },
    [domainMin, span, step],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const v = valueAt(e.clientX);
    // Grab whichever handle is closer (ties → the one that can move).
    const dLo = Math.abs(v - lo);
    const dHi = Math.abs(v - hi);
    dragging.current = dLo < dHi || (dLo === dHi && v < lo) ? "min" : "max";
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    move(v);
    e.preventDefault();
  };

  // The fill band starts a whole-window drag (issue #75). stopPropagation so it
  // wins over the container's nearest-handle grab; the handles sit on top of the
  // band's edges, so edge grabs still land on a handle.
  const onFillPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.stopPropagation();
    dragging.current = "band";
    bandAnchor.current = { v: valueAt(e.clientX), lo, hi };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const move = (v: number) => {
    if (dragging.current === "min") {
      onChange(Math.min(v, hi), max);
    } else if (dragging.current === "max") {
      onChange(min, Math.max(v, lo));
    } else if (dragging.current === "band" && bandAnchor.current) {
      const a = bandAnchor.current;
      const next = slideWindow(a.lo, a.hi, v - a.v, domainMin, domainMax);
      onChange(next.lo, next.hi);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || disabled) return;
    move(valueAt(e.clientX));
  };

  const onPointerUp = () => {
    dragging.current = null;
    bandAnchor.current = null;
  };

  return (
    <div
      ref={trackRef}
      className={`mx-slider${disabled ? " mx-slider--disabled" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="group"
      aria-label="BPM range slider"
    >
      <div className="mx-slider__track" />
      <div
        className="mx-slider__fill"
        style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
        onPointerDown={onFillPointerDown}
        aria-hidden="true"
      />
      <div
        className="mx-slider__handle"
        style={{ left: `${pct(lo)}%` }}
        tabIndex={-1}
        aria-hidden="true"
      />
      <div
        className="mx-slider__handle"
        style={{ left: `${pct(hi)}%` }}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
