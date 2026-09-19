import { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowRight, FiCopy, FiLink, FiLock, FiPlus, FiSave, FiTrash2 } from "react-icons/fi";
import { Button, Empty, Field, IconButton, Input, Section, TextButton } from "@/components/ui";
import { api, ApiError, type ProjectSummary } from "@/lib/api";
import { cn } from "@/lib/cn";
import { pad, stamp } from "@/lib/format";
import { useToast } from "@/hooks/useToast";
import { DuplicateDialog } from "./DuplicateDialog";
import { copyText, shareUrl } from "./ShareDialog";
import { unlockFor } from "./unlocks";

/**
 * Saved merges, as a list rather than a grid of thumbnails: the useful
 * distinction between two projects is their name and when you last touched
 * them, and a list puts both on one line at a glance.
 *
 * Every project is listed, locked ones included — a lock keeps the contents
 * behind a password, not the fact that the project exists. Opening a locked
 * one asks for the password; deleting one needs it to have been given.
 *
 * Needs the server. With it down the panel says so and the editor carries on.
 */
export function ProjectsPanel({
  currentId,
  refreshKey,
  onOpen,
  onNew,
  onDeleted,
  onSave,
  onDuplicated,
}: {
  /** A copy was made; the page opens it. */
  onDuplicated: (id: string) => void;
  currentId: string | null;
  /** The one thing to do with an empty shelf: put this merge on it. */
  onSave: () => void;
  /** Bumped by the page after a save, so a new row appears without a reload. */
  refreshKey: number;
  onOpen: (id: string, name: string) => void;
  /** An empty password means a local, unshared merge — the usual case. */
  onNew: (name: string, password: string) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [copying, setCopying] = useState<ProjectSummary | null>(null);
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.listProjects());
      setOffline(false);
    } catch {
      setItems(null);
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => () => void (disarm.current && clearTimeout(disarm.current)), []);

  // Delete is two taps, not a dialog: the row arms itself and stands down again.
  const remove = useCallback(
    async (id: string) => {
      if (armed !== id) {
        setArmed(id);
        if (disarm.current) clearTimeout(disarm.current);
        disarm.current = setTimeout(() => setArmed(null), 3500);
        return;
      }
      setArmed(null);
      try {
        await api.deleteProject(id, unlockFor(id));
        setItems((prev) => prev?.filter((p) => p.id !== id) ?? null);
        onDeleted(id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) toast("locked — open it with its password first");
        else setOffline(true);
      }
    },
    [armed, onDeleted, toast],
  );

  return (
    <Section
      title={items && items.length > 0 ? `projects · ${pad(items.length)}` : "projects"}
      aside={<NewMergeMenu onCreate={onNew} />}
    >
      {offline ? (
        <div className="flex flex-col gap-1.5">
          <Empty>server offline</Empty>
          <p className="text-meta font-sans text-body normal-case">Saved projects need the api. This merge still works here.</p>
        </div>
      ) : items === null ? (
        <Empty>reading the shelf…</Empty>
      ) : items.length === 0 ? (
        <div className="border-wash flex flex-col items-start gap-3 rounded-card border border-dashed px-4 py-4">
          <p className="text-prose font-sans text-body normal-case">Nothing saved yet. Saving puts this merge here, ready to reopen or share.</p>
          <Button variant="outline" size="sm" onClick={onSave}>
            <FiSave className="size-3" aria-hidden />
            save this merge
          </Button>
        </div>
      ) : (
        // Each project is one row you can press: the name and when it was last
        // touched, the open arrow on approach, and its two actions at the end.
        <ul className="-mx-1.5 flex max-h-72 flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {items.map((project) => {
            const here = project.id === currentId;
            return (
              <li key={project.id} className="group relative flex items-center">
                <button
                  type="button"
                  onClick={() => onOpen(project.id, project.name || "untitled")}
                  aria-current={here || undefined}
                  className={cn(
                    "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-xs py-2 pl-2.5 text-left transition-colors duration-200",
                    project.slug ? "pr-24" : "pr-16",
                    here ? "bg-surface-high" : "hover:bg-hover-wash",
                  )}
                >
                  <span className="flex w-full min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate font-mono text-small tracking-normal transition-colors duration-200",
                        here ? "text-ink" : "text-label group-hover:text-indigo",
                      )}
                    >
                      {project.name || "untitled"}
                    </span>
                    {project.locked ? <FiLock className="text-meta size-3 shrink-0" aria-label="locked" role="img" /> : null}
                  </span>
                  <span className="text-meta flex items-center gap-2 font-mono text-micro tabular-nums">
                    {here ? <span className="text-indigo uppercase">open</span> : null}
                    {stamp(project.updatedAt)}
                    {!here ? (
                      <FiArrowRight
                        className="text-indigo size-3 -translate-x-1 opacity-0 transition-[opacity,translate] duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                </button>

                <span
                  className={cn(
                    "absolute right-2 flex items-center gap-3 transition-opacity duration-200",
                    here || armed === project.id
                      ? "opacity-100"
                      : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100",
                  )}
                >
                  {project.slug ? (
                    <IconButton
                      label="copy link"
                      onClick={() => {
                        const slug = project.slug!;
                        void copyText(shareUrl(slug)).then((ok) => toast(ok ? "link copied" : "could not copy the link"));
                      }}
                    >
                      <FiLink className="size-3.5" />
                    </IconButton>
                  ) : null}
                  <IconButton label="duplicate" onClick={() => setCopying(project)}>
                    <FiCopy className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={armed === project.id ? "delete for good" : "delete"}
                    // Last control in the row: its tip opens leftward so it cannot
                    // hang off the edge of a phone and widen the page.
                    data-tip-pos="top-right"
                    onClick={() => void remove(project.id)}
                    className={cn(armed === project.id && "text-indigo")}
                  >
                    <FiTrash2 className="size-3.5" />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {copying ? (
        <DuplicateDialog
          project={copying}
          isOpen={copying.id === currentId}
          onClose={() => setCopying(null)}
          onDone={(id) => {
            setCopying(null);
            toast(`duplicated as a new project`);
            onDuplicated(id);
          }}
        />
      ) : null}
    </Section>
  );
}

/**
 * New merge, with its lock decided at birth. The password is optional and the
 * usual answer is no password at all — but a collection that is going out to a
 * group is easier to lock here than to remember to lock after the first save.
 */
function NewMergeMenu({ onCreate }: { onCreate: (name: string, password: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
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

  const create = () => {
    setOpen(false);
    onCreate(name.trim() || "untitled", password);
    setName("");
    setPassword("");
  };

  return (
    <div ref={box} className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn(open && "border-indigo text-indigo")}>
        <FiPlus className="size-3" aria-hidden />
        new
      </Button>

      {open ? (
        <div
          className="animate-menu-in border-wash bg-panel-high rounded-card absolute right-0 top-full z-50 mt-3 w-[min(16.5rem,calc(100vw-2.5rem))] border p-4"
          style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
        >
          <Field label="name">
            <Input
              autoFocus
              value={name}
              placeholder="untitled"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </Field>

          <div className="mt-4">
            <Field label="password" hint="optional — leave empty and the merge stays unshared">
              <Input
                type="text"
                value={password}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
            </Field>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <TextButton onClick={() => setOpen(false)}>cancel</TextButton>
            <Button onClick={create} size="sm">
              {password ? <FiLock className="size-3" aria-hidden /> : null}
              {password ? "create locked" : "create"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
