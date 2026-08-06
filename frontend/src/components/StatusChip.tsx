import type { ReactNode } from "react";

export type StatusChipVariant = "success" | "danger" | "running" | "neutral";

/**
 * Status chip (§6.3): pill, 24px tall, 11px uppercase. `success` matches
 * SM2's green "Completed" chip; `running` is the orange outline + spinner.
 */
export function StatusChip({
  variant,
  children,
  title,
}: {
  variant: StatusChipVariant;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`chip chip--${variant}`} title={title}>
      {variant === "running" && <span className="chip__spinner" aria-hidden />}
      {children}
    </span>
  );
}
