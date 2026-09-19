import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiCopy, FiX } from "react-icons/fi";
import { Button, Field, Input, TextButton } from "@/components/ui";
import { api, ApiError, type ProjectSummary } from "@/lib/api";
import { remember, unlockFor } from "./unlocks";

/**
 * Duplicate a saved merge, after saying exactly what the copy will be. The
 * share dialog's frame at a narrower width: a name for the copy, the facts in
 * one paragraph, and the one button. A locked original asks for its password
 * here, because its contents cannot be read without it.
 */
export function DuplicateDialog({
  project,
  isOpen,
  onDone,
  onClose,
}: {
  project: ProjectSummary;
  /** The original is the merge in the editor — the copy is its last save. */
  isOpen: boolean;
  onDone: (id: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(`${project.name || "untitled"} copy`);
  const known = unlockFor(project.id);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(project.locked && !known);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    nameInput.current?.select();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const duplicate = async () => {
    if (busy || (needsPassword && !password)) return;
    setBusy(true);
    setError(null);
    try {
      const key = needsPassword ? password : known;
      const original = await api.getProject(project.id, key);
      if (key) remember(project.id, key);
      const copyName = name.trim() || `${project.name || "untitled"} copy`;
      const created = await api.createProject(copyName, { ...original.doc, name: copyName }, original.data);
      onDone(created.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setNeedsPassword(true);
        setError(password ? "wrong password" : "this merge is locked — enter its password");
      } else setError("could not duplicate — is the api running?");
      setBusy(false);
    }
  };

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
            <span className="text-ink font-mono text-title font-bold uppercase">duplicate</span>
            <span className="text-label truncate font-mono text-label tracking-normal">{project.name || "untitled"}</span>
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
            void duplicate();
          }}
        >
          <p className="text-prose font-sans text-body normal-case">
            A new project with {isOpen ? "the last saved version of " : ""}this merge's design, sheet, edits and row layouts.
            {project.locked || project.slug ? " The copy has no link and no password until you share it." : ""}
            {isOpen ? " Unsaved changes stay with the original." : ""}
          </p>

          <Field label="name of the copy">
            <Input ref={nameInput} value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </Field>

          {needsPassword ? (
            <Field label="password of the original">
              <Input
                type="password"
                value={password}
                autoFocus
                autoComplete="off"
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </Field>
          ) : null}

          {error ? (
            <p className="text-ink font-mono text-meta uppercase" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-4 pt-1">
            <TextButton onClick={onClose} disabled={busy}>
              cancel
            </TextButton>
            <Button type="submit" disabled={busy || (needsPassword && !password)}>
              <FiCopy className="size-3.5" aria-hidden />
              {busy ? "duplicating…" : "duplicate and open"}
            </Button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
