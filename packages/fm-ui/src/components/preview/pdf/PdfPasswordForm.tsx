import { useEffect, useId, useRef, useState } from "react";

interface PdfPasswordFormProps {
  readonly incorrect: boolean;
  readonly focusInput: boolean;
  readonly onUnlock: (password: string) => void;
}

export function PdfPasswordForm({ incorrect, focusInput, onUnlock }: PdfPasswordFormProps) {
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const messageId = useId();
  useEffect(() => {
    // The column must not take focus from file navigation when a PDF finishes loading.
    if (focusInput) input.current?.focus();
  }, [focusInput]);

  return (
    <form
      className="pdf-password pdf-message"
      aria-label="Unlock PDF"
      onSubmit={(event) => {
        event.preventDefault();
        setPassword("");
        onUnlock(password);
      }}
    >
      <label htmlFor={inputId}>PDF password</label>
      <input
        ref={input}
        id={inputId}
        type="password"
        autoComplete="off"
        value={password}
        aria-invalid={incorrect}
        aria-describedby={incorrect ? messageId : undefined}
        onChange={(event) => setPassword(event.target.value)}
      />
      {incorrect && (
        <span id={messageId} role="alert">
          Incorrect password. Try again.
        </span>
      )}
      <button type="submit">Unlock</button>
    </form>
  );
}
