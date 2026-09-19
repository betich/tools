import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiX } from "react-icons/fi";
import { CODECS } from "@tools/shared";
import { Button, TextButton } from "@/components/ui";

/**
 * JPEG XL is experimental (#14): switching it on — for the run or for one
 * image — always goes through this dialog, and only its confirm turns it on.
 * Nothing remembers the answer, so the next switch asks again. Focus starts on
 * cancel, since Enter shouldn't be the way into a file nobody can open. The
 * share dialog's frame, like `SignatureDialog` — an overlay, so it may cast
 * the one shadow.
 */
export function JxlDialog({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const titleId = useId();
  const frame = useRef<HTMLElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    frame.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="animate-toast-in fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-[rgb(2_2_8/0.72)] px-4 pt-[14vh] pb-10"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={frame}
        role="alertdialog"
        aria-modal
        aria-labelledby={titleId}
        className="border-wash bg-panel-high rounded-card w-full max-w-[28rem] border"
        style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <h2 id={titleId} className="text-ink text-title font-mono font-bold uppercase">
            experimental codec
          </h2>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            className="text-meta hover:text-indigo -mr-1 cursor-pointer p-1 transition-colors duration-200"
          >
            <FiX className="size-4" />
          </button>
        </header>

        <div className="border-hairline-faint border-t" />

        <div className="flex flex-col gap-5 px-6 pt-5 pb-6">
          <p className="text-prose text-body font-sans normal-case">
            JPEG XL in PDF is newly specified, and almost no viewer opens it yet. The output may not open for the people
            you send it to — images can show blank, or the file can fail to open at all.
          </p>
          <p className="text-meta text-body font-sans normal-case">
            Keep {CODECS.mozjpeg.label} for anything you share; try {CODECS.libjxl.label} only where you know the reader.
          </p>
          <div className="flex items-center justify-between gap-4 pt-1">
            <TextButton data-cancel onClick={onClose}>
              cancel
            </TextButton>
            <Button onClick={onConfirm}>use jpeg xl</Button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/**
 * `ask(then)` opens the dialog and runs `then` only on confirm; `dialog` is
 * the element to render (null while closed). Cancel, Escape and the backdrop
 * all leave things as they were.
 */
export function useJxlConfirm() {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const close = () => setPending(null);
  return {
    ask: (then: () => void) => setPending(() => then),
    dialog: pending ? (
      <JxlDialog
        onConfirm={() => {
          pending();
          close();
        }}
        onClose={close}
      />
    ) : null,
  };
}
