import { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { FormField } from "./FormField";

/**
 * Generic single-field text prompt with inline validation — used for
 * New Set, Rename, and Move-to-folder (§4 naming rule enforced by callers
 * via `validate`).
 */
export function NamePromptModal({
  title,
  label,
  initialValue = "",
  placeholder,
  hint,
  confirmLabel = "OK",
  validate,
  suggestions,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  hint?: string;
  confirmLabel?: string;
  /** Returns an error message, or null when valid. */
  validate?: (value: string) => string | null;
  /** Optional datalist suggestions (e.g. existing folder names). */
  suggestions?: string[];
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const err = validate ? validate(value) : null;
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const listId = suggestions ? "name-prompt-suggestions" : undefined;

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <FormField label={label} error={error} hint={hint} htmlFor="name-prompt-input">
        <input
          id="name-prompt-input"
          className="input"
          value={value}
          placeholder={placeholder}
          autoFocus
          list={listId}
          onChange={(e) => {
            setValue(e.target.value);
            if (error && validate) setError(validate(e.target.value));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        {suggestions && (
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </FormField>
    </Modal>
  );
}
