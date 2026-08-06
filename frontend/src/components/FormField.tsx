import type { ReactNode } from "react";

/**
 * S6 form field (§5.6): uppercase 11px label above the control, helper text
 * below. Controls inside should use the `.input` class (bottom hairline,
 * blue focus — no heavy borders).
 */
export function FormField({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <div className="field__error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="field__hint">{hint}</div>
      ) : null}
    </div>
  );
}
