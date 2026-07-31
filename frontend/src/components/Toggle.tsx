/**
 * NI badge-pattern toggle (§6.2): inactive = dark chip with muted text,
 * active = orange fill with black text.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle${checked ? " toggle--on" : ""}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
