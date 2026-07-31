/** Compact numeric stepper (NI control flavor) used for Δ, Spacing, Font Size. */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  format,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  ariaLabel?: string;
}) {
  // Guard against floating-point drift on 0.5 steps.
  const snap = (v: number) => Math.round(v / step) * step;
  const dec = () => onChange(Math.max(min, snap(value - step)));
  const inc = () => onChange(Math.min(max, snap(value + step)));
  return (
    <span
      className="stepper"
      role="spinbutton"
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
    >
      <button
        type="button"
        className="stepper__btn"
        onClick={dec}
        disabled={value <= min}
        aria-label="Decrease"
      >
        −
      </button>
      <span className="stepper__value">{format ? format(value) : value}</span>
      <button
        type="button"
        className="stepper__btn"
        onClick={inc}
        disabled={value >= max}
        aria-label="Increase"
      >
        +
      </button>
    </span>
  );
}
