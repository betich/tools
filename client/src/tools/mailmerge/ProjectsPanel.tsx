import { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowUpRight, FiTrash2 } from "react-icons/fi";
import { Empty, IconButton, Section, TextButton } from "@/components/ui";
import { api, type ProjectSummary } from "@/lib/api";
import { cn } from "@/lib/cn";
import { pad, stamp } from "@/lib/format";

/**
 * Saved merges, as a list rather than a grid of thumbnails: the useful
 * distinction between two projects is their name and when you last touched
 * them, and a list puts both on one line at a glance.
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
  onNew: () => void;
  onDeleted: (id: string) => void;
}) {
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
        await api.deleteProject(id);
        setItems((prev) => prev?.filter((p) => p.id !== id) ?? null);
        onDeleted(id);
      } catch {
        setOffline(true);
      }
    },
    [armed, onDeleted],
  );

  return (
    <Section
      title="projects"
      aside={
        <span className="flex items-center gap-4">
          <TextButton onClick={onNew}>new</TextButton>
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
                  <FiArrowUpRight
                    className="size-3 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    aria-hidden
                  />
                </span>
                <span className="text-meta text-meta font-mono tabular-nums">{stamp(project.updatedAt)}</span>
              </button>

              <IconButton
                label={armed === project.id ? "delete for good" : "delete"}
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
