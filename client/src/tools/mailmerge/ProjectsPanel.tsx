import { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowUpRight, FiLink, FiLock, FiTrash2 } from "react-icons/fi";
import { Empty, Field, IconButton, Input, Section, TextButton } from "@/components/ui";
import { api, ApiError, type ProjectSummary } from "@/lib/api";
import { cn } from "@/lib/cn";
import { pad, stamp } from "@/lib/format";
import { useToast } from "@/hooks/useToast";
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
}: {
  currentId: string | null;
  /** Bumped by the page after a save, so a new row appears without a reload. */
  refreshKey: number;
  onOpen: (id: string) => void;
  /** An empty password means a local, unshared merge — the usual case. */
  onNew: (name: string, password: string) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
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
      title="projects"
      aside={
        <span className="flex items-center gap-4">
          <NewMergeMenu onCreate={onNew} />
          <span className="text-meta text-meta font-mono tabular-nums">{items ? pad(items.length) : "—"}</span>
        </span>
      }
    >
      {offline ? (
        <Empty>server offline — saved projects need the api</Empty>
      ) : items === null ? (
        <Empty>reading the shelf…</Empty>
      ) : items.length === 0 ? (
        <Empty>nothing saved yet</Empty>
      ) : (
        <ul className="flex flex-col">
          {items.map((project) => (
            <li key={project.id} className="border-wash group flex items-center gap-2 border-b py-2 last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(project.id)}
                className={cn(
                  "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 text-left transition-colors duration-200",
                  project.id === currentId ? "text-ink" : "text-label hover:text-indigo",
                )}
              >
                <span className="flex w-full min-w-0 items-center gap-1.5">
                  <span className="text-label truncate font-mono tracking-normal">{project.name || "untitled"}</span>
                  {project.locked ? (
                    <FiLock className="text-meta size-3 shrink-0" aria-label="locked" role="img" />
                  ) : null}
                  <FiArrowUpRight
                    className="size-3 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    aria-hidden
                  />
                </span>
                <span className="text-meta text-meta font-mono tabular-nums">{stamp(project.updatedAt)}</span>
              </button>

              {project.slug ? (
                <IconButton
                  label="copy link"
                  onClick={() => {
                    const slug = project.slug!;
                    void copyText(shareUrl(slug)).then((ok) => toast(ok ? "link copied" : "could not copy the link"));
                  }}
                  className="shrink-0"
                >
                  <FiLink className="size-3.5" />
                </IconButton>
              ) : null}

              <IconButton
                label={armed === project.id ? "delete for good" : "delete"}
                // Last control in the row: its tip opens leftward so it cannot
                // hang off the edge of a phone and widen the page.
                data-tip-pos="top-right"
                onClick={() => void remove(project.id)}
                className={cn("shrink-0", armed === project.id && "text-indigo")}
              >
                <FiTrash2 className="size-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
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
      <TextButton onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        new
      </TextButton>

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

          <div className="mt-4 flex items-center justify-between gap-4">
            <TextButton onClick={create}>create</TextButton>
            <TextButton onClick={() => setOpen(false)}>cancel</TextButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
