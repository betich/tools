import { useEffect, useRef, useState } from "react";
import { Field, Input, TextButton } from "@/components/ui";

/**
 * Share is one button with a popover, because a link and its password are one
 * decision. Leaving the field empty makes an open link; filling it locks the
 * link without changing the slug, so a URL already sent out keeps working.
 */
export function ShareMenu({
  disabled,
  currentSlug,
  isProtected,
  onShare,
}: {
  disabled?: boolean;
  currentSlug: string | null;
  isProtected: boolean;
  onShare: (password: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <TextButton onClick={() => setOpen((v) => !v)} disabled={disabled} aria-expanded={open}>
        share
      </TextButton>

      {open ? (
        <div
          className="animate-menu-in border-wash bg-panel-high absolute top-full right-0 z-50 mt-3 w-[min(19rem,80vw)] rounded-card border p-4"
          style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
        >
          <Field
            label="password"
            hint={
              currentSlug
                ? isProtected
                  ? "this link is locked — empty the field to unlock it"
                  : "this link is open"
                : "leave empty for an open link"
            }
          >
            <Input
              autoFocus
              type="text"
              value={password}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setOpen(false);
                  void onShare(password);
                }
              }}
            />
          </Field>

          <div className="mt-3 flex items-center justify-between gap-4">
            <TextButton
              onClick={() => {
                setOpen(false);
                void onShare(password);
              }}
            >
              {currentSlug ? "update link" : "create link"}
            </TextButton>
            <TextButton onClick={() => setOpen(false)}>cancel</TextButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The gate a locked share link shows instead of the editor. */
export function PasswordGate({ error, onSubmit }: { error: string | null; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
      className="border-wash rounded-card max-w-sm border bg-surface p-6"
    >
      <Field label="password" hint={error ?? "this merge is locked"}>
        <Input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
      </Field>
      <div className="mt-3">
        <TextButton type="submit">open</TextButton>
      </div>
    </form>
  );
}
