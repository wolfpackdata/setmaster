import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * NI-style button (§6.2). `primary` is the orange primary-action variant —
   * use it at most ONCE per view.
   */
  variant?: ButtonVariant;
  size?: "md" | "sm";
}

export function Button({
  variant = "default",
  size = "md",
  className,
  type,
  ...rest
}: ButtonProps) {
  const classes = ["btn"];
  if (variant !== "default") classes.push(`btn--${variant}`);
  if (size === "sm") classes.push("btn--sm");
  if (className) classes.push(className);
  return <button type={type ?? "button"} className={classes.join(" ")} {...rest} />;
}
