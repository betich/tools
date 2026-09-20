import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, TextButton } from "@/components/ui";

/**
 * A step that takes something away, asked before it is taken: what will go, in
 * one sentence of prose, and a button that names the act rather than agreeing
 * with a question. The duplicate dialog's frame at its narrowest.
 *
 * Escape and the backdrop cancel; focus opens on cancel, the harmless one, and
 * returns to whatever opened the dialog.
 */
export function ConfirmDialog({
  title,
  confirmLabel,
  onConfirm,
  onClose,
  children,
}: {
  /** Uppercase chrome, naming the object: "remove page". */
  title: string;
  /** The button's words — the act itself, never "yes" or "ok". */
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  /** What will happen, in sentence case. */
  children: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className="animate-toast-in fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-[rgb(2_2_8/0.72)] px-4 pb-10 pt-[18vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        className="border-wash bg-panel-high rounded-card w-full max-w-[24rem] border"
        style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
      >
        <header className="px-6 pb-4 pt-5">
          <h2 id={titleId} className="text-ink text-title font-mono font-bold uppercase">
            {title}
          </h2>
        </header>

        <div className="border-hairline-faint border-t" />

        <div className="flex flex-col gap-5 px-6 pb-6 pt-5">
          <p className="text-prose text-body font-sans normal-case">{children}</p>
          <div className="flex items-center justify-between gap-4 pt-1">
            <TextButton autoFocus onClick={onClose}>
              cancel
            </TextButton>
            <Button
              onClick={() => {
                onConfirm();
                onClose();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
