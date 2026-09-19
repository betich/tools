import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiUnlock, FiX } from "react-icons/fi";
import { Button, Field, Input, TextButton } from "@/components/ui";

/** The gate a locked merge shows until its password is given. */
export function PasswordGate({
  error,
  onSubmit,
  onCancel,
}: {
  error: string | null;
  onSubmit: (password: string) => void;
  /** Offered when there is something to go back to. */
  onCancel?: () => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
      className="border-wash rounded-card mb-6 max-w-sm border bg-surface p-6"
    >
      <Field label="password" hint={error ?? "this merge is locked"}>
        <Input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
      </Field>
      <div className="mt-3 flex items-center justify-between gap-4">
        <TextButton type="submit">open</TextButton>
        {onCancel ? <TextButton onClick={onCancel}>cancel</TextButton> : null}
      </div>
    </form>
  );
}

/**
 * A locked project picked from the shelf asks for its password in a dialog
 * over the room, so the merge that is open stays exactly where it was until
 * the new one is unlocked — the duplicate dialog's frame, at its width.
 */
export function UnlockDialog({
  name,
  error,
  busy,
  onSubmit,
  onClose,
}: {
  /** Known when the shelf opened it; an address typed by hand has only an id. */
  name?: string;
  error: string | null;
  busy: boolean;
  onSubmit: (password: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // A wrong password is selected, so the next attempt types straight over it.
  useEffect(() => {
    if (error) input.current?.select();
  }, [error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return createPortal(
    <div
      className="animate-toast-in fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-[rgb(2_2_8/0.72)] px-4 pt-[14vh] pb-10"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <section
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        className="border-wash bg-panel-high rounded-card w-full max-w-[28rem] border"
        style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <h2 id={titleId} className="flex min-w-0 items-baseline gap-3">
            <span className="text-ink font-mono text-title font-bold uppercase">open</span>
            <span className="text-label truncate font-mono text-label tracking-normal">{name || "locked merge"}</span>
          </h2>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            disabled={busy}
            className="text-meta hover:text-indigo -mr-1 cursor-pointer p-1 transition-colors duration-200 disabled:opacity-35"
          >
            <FiX className="size-4" />
          </button>
        </header>

        <div className="border-hairline-faint border-t" />

        <form
          className="flex flex-col gap-5 px-6 pt-5 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (password && !busy) onSubmit(password);
          }}
        >
          <p className="text-prose font-sans text-body normal-case">
            This merge is locked. Its password opens it here, and this tab remembers it until you close the tab.
          </p>

          <Field label="password">
            <Input
              ref={input}
              type="password"
              value={password}
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </Field>

          {error ? (
            <p className="text-ink font-mono text-meta uppercase" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-4 pt-1">
            <TextButton onClick={onClose} disabled={busy}>
              cancel
            </TextButton>
            <Button type="submit" disabled={busy || !password}>
              <FiUnlock className="size-3.5" aria-hidden />
              {busy ? "opening…" : "open"}
            </Button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
