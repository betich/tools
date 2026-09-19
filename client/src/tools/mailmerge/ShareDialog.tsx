import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiCheck, FiCopy, FiLink, FiLock, FiX } from "react-icons/fi";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ShareState } from "@/lib/api";

export const shareUrl = (slug: string) => `${location.origin}/mail-merge/s/${slug}`;

/** Clipboard, with the old select-and-copy path for a context that refuses the API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

type Access = "open" | "locked";

/**
 * Share, the way a file is shared: the link first with its copy button, then
 * who the link lets in. There are two answers — anyone holding it, or anyone
 * holding it and the password — and both of them can edit, because a share
 * here is the document, not a copy of it.
 *
 * Opening to anyone applies at once, like choosing it in a menu. Locking needs
 * a password, so it waits for one.
 */
export function ShareDialog({
  name,
  share,
  busy,
  onApply,
  onClose,
}: {
  name: string;
  share: ShareState | null;
  busy: boolean;
  /** Saves the merge and mints or updates its link. `undefined` keeps the lock as it is; `""` opens it. */
  onApply: (password: string | undefined) => Promise<ShareState | null>;
  onClose: () => void;
}) {
  const [access, setAccess] = useState<Access>(share?.protected ? "locked" : "open");
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const copyButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    copyButton.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => () => void (reset.current && clearTimeout(reset.current)), []);

  // A lock applied elsewhere (or just now) is the truth the radios show.
  useEffect(() => setAccess(share?.protected ? "locked" : "open"), [share?.protected]);

  const flashCopied = () => {
    setCopied(true);
    if (reset.current) clearTimeout(reset.current);
    reset.current = setTimeout(() => setCopied(false), 1800);
  };

  const copy = async (slug: string) => {
    if (await copyText(shareUrl(slug))) flashCopied();
  };

  /** No link yet: the one button saves, mints with the chosen access, and copies. */
  const create = async () => {
    if (access === "locked" && !password.trim()) return;
    const result = await onApply(access === "locked" ? password.trim() : "");
    if (result) {
      setPassword("");
      await copy(result.slug);
    }
  };

  const chooseOpen = async () => {
    setAccess("open");
    if (share?.protected) await onApply("");
  };

  const lock = async () => {
    if (!password.trim()) return;
    const result = await onApply(password.trim());
    if (result) setPassword("");
  };

  const url = share ? shareUrl(share.slug) : null;
  const lockPending = access === "locked" && (!share || !share.protected || password.length > 0);

  return createPortal(
    <div
      className="animate-toast-in fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-[rgb(2_2_8/0.72)] px-4 pt-[12vh] pb-10"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <section
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        className="border-wash bg-panel-high rounded-card w-full max-w-[34rem] border"
        style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <h2 id={titleId} className="flex min-w-0 items-baseline gap-3">
            <span className="text-ink font-mono text-title font-bold uppercase">share</span>
            <span className="text-label truncate font-mono text-small tracking-normal">{name || "untitled"}</span>
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

        {/* the link */}
        <div className="flex flex-col gap-2.5 px-6 pt-5">
          <span className="text-meta font-mono text-micro uppercase">link</span>
          {url && share ? (
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={url}
                aria-label="share link"
                onFocus={(e) => e.currentTarget.select()}
                className="border-wash text-label min-w-0 flex-1 truncate rounded-xs border bg-control px-2.5 font-mono text-small tracking-normal focus:border-indigo focus:outline-none"
              />
              <Button ref={copyButton} onClick={() => void copy(share.slug)} className="w-[8.5rem]">
                {copied ? <FiCheck className="size-3.5" aria-hidden /> : <FiCopy className="size-3.5" aria-hidden />}
                {copied ? "copied" : "copy link"}
              </Button>
            </div>
          ) : (
            <p className="text-label font-sans text-body normal-case">
              This merge has no link yet. Making one saves it to the shelf.
            </p>
          )}
          <span className="sr-only" aria-live="polite">
            {copied ? "link copied" : ""}
          </span>
        </div>

        {/* who it lets in */}
        <div role="radiogroup" aria-labelledby={`${titleId}-access`} className="flex flex-col gap-1 px-6 pt-6 pb-5">
          <span id={`${titleId}-access`} className="text-meta mb-1.5 font-mono text-micro uppercase">
            general access
          </span>

          <AccessRow
            icon={<FiLink className="size-3.5" aria-hidden />}
            title="anyone with the link"
            detail="Can open and edit this merge."
            checked={access === "open"}
            disabled={busy}
            onSelect={() => void chooseOpen()}
          />
          <AccessRow
            icon={<FiLock className="size-3.5" aria-hidden />}
            title="locked"
            detail="Needs a password to open, edit or delete."
            checked={access === "locked"}
            disabled={busy}
            onSelect={() => setAccess("locked")}
          />

          {access === "locked" ? (
            <form
              className="mt-2 flex items-stretch gap-2 pl-11"
              onSubmit={(e) => {
                e.preventDefault();
                void (share ? lock() : create());
              }}
            >
              <Input
                autoFocus
                type="text"
                value={password}
                spellCheck={false}
                autoComplete="off"
                aria-label="password"
                placeholder={share?.protected ? "new password" : "password"}
                onChange={(e) => setPassword(e.target.value)}
                className="min-w-0 flex-1"
              />
              {share ? (
                <Button type="submit" variant="outline" disabled={busy || !password.trim()}>
                  {share.protected ? "change" : "lock"}
                </Button>
              ) : null}
            </form>
          ) : null}
        </div>

        <div className="border-hairline-faint border-t" />

        <footer className="flex items-center justify-between gap-4 px-6 py-4">
          <p className="text-meta max-w-[22rem] font-sans text-body leading-snug normal-case">
            {share
              ? lockPending
                ? "Set a password to lock the link."
                : "Everyone with access edits the same merge — saving updates it for all of them."
              : "Everyone with access edits the same merge."}
          </p>
          {share ? (
            <Button variant="outline" onClick={onClose} disabled={busy}>
              done
            </Button>
          ) : (
            <Button
              ref={copyButton}
              onClick={() => void create()}
              disabled={busy || (access === "locked" && !password.trim())}
            >
              <FiLink className="size-3.5" aria-hidden />
              {busy ? "saving" : "create link"}
            </Button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function AccessRow({
  icon,
  title,
  detail,
  checked,
  disabled,
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-xs px-2 py-2 transition-colors duration-200",
        checked ? "bg-surface-high" : "hover:bg-hover-wash",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name="access" className="peer sr-only" checked={checked} disabled={disabled} onChange={onSelect} />
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo",
          checked ? "border-indigo text-indigo" : "border-wash text-meta group-hover:text-indigo",
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn("font-mono text-small uppercase", checked ? "text-ink" : "text-label")}>{title}</span>
        <span className="text-meta font-sans text-body leading-snug normal-case">{detail}</span>
      </span>
    </label>
  );
}
