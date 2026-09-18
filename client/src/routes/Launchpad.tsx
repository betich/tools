import { useEffect, useState } from "react";
import { FiArrowRight } from "react-icons/fi";
import { Link, useNavigate } from "react-router-dom";
import { Bezel } from "@/components/Bezel";
import { Shell } from "@/components/Shell";
import { useHotkey } from "@/hooks/useHotkey";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { backlog, registry, type ClientTool } from "@/tools/registry";

/** The bench has nine slots. What is not a tool yet is either queued or empty. */
const SLOTS = 9;

export function Launchpad() {
  const navigate = useNavigate();
  const [tools, setTools] = useState<ClientTool[]>(registry);

  // The server may know about tools this build does not.
  useEffect(() => {
    api
      .tools()
      .then((remote) => {
        // The server is authority on which tools exist; the copy is written here.
        setTools((local) =>
          remote.map((r) => {
            const known = local.find((l) => l.id === r.id);
            return known ? { ...r, ...known } : { ...shape(), ...r };
          }),
        );
      })
      .catch(() => {
        /* offline — the bundled registry is already on screen */
      });
  }, []);

  // 1…9 jump straight to whatever is live in that slot.
  useHotkey("1", () => tools[0] && navigate(tools[0].href));
  useHotkey("2", () => tools[1] && navigate(tools[1].href));
  useHotkey("3", () => tools[2] && navigate(tools[2].href));

  const queued = backlog.slice(0, Math.max(0, SLOTS - tools.length));
  const empty = Math.max(0, SLOTS - tools.length - queued.length);

  return (
    <Shell width="page">
      <Bezel count={tools.length} />

      <p
        className="animate-resolve text-prose-muted text-body mx-auto mt-8 max-w-[62ch] text-center font-sans"
        style={{ animationDelay: "120ms" }}
      >
        A small workshop kept in public — things I built because I needed them, left out on the bench in case they are
        useful to anyone else. Everything here runs in your browser. Nothing is uploaded unless you ask for it.
      </p>

      {/*
       * Nine slots, three across. Every cell is the same size because every
       * tool is its own door — the difference between them is state, not
       * weight: a tool you can open, an idea that is queued, a slot still free.
       */}
      <ul className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {tools.map((tool, i) => (
          <ToolTile key={tool.id} tool={tool} delay={220 + i * 60} />
        ))}

        {queued.map((item, i) => (
          <QueuedTile key={item} name={item} delay={220 + (tools.length + i) * 60} />
        ))}

        {Array.from({ length: empty }, (_, i) => (
          <EmptySlot key={`slot-${i}`} delay={220 + (tools.length + queued.length + i) * 60} />
        ))}
      </ul>
    </Shell>
  );
}

const tile = "rounded-card relative flex flex-col justify-between overflow-hidden border p-6";
/** Only a slot holding something openable claims full height on a phone. */
const tall = "min-h-[13.5rem] md:min-h-[15rem]";

function ToolTile({ tool, delay }: { tool: ClientTool; delay: number }) {
  return (
    <li className="animate-resolve" style={{ animationDelay: `${delay}ms` }}>
      <Link
        to={tool.href}
        className={cn(
          tile,
          tall,
          "border-wash group h-full bg-[rgba(244,243,255,0.035)] transition-colors duration-300",
          "hover:border-[rgba(185,184,239,0.45)] hover:bg-[rgba(244,243,255,0.06)]",
        )}
      >
        {/* A wash of the accent rises from the floor of the tile on approach. */}
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 h-32 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: "linear-gradient(0deg, rgba(72,69,218,0.22), transparent)" }}
          aria-hidden
        />

        <div className="relative">
          {/* Display type is reserved for a door you can actually open. */}
          <h2 className="text-ink group-hover:text-indigo text-display font-mono font-bold uppercase transition-colors duration-300">
            {tool.name}
          </h2>
          <p className="text-label text-body mt-3.5 font-sans">{tool.blurb}</p>
        </div>

        <div className="border-hairline-faint relative mt-8 flex items-center justify-between gap-4 border-t pt-3.5">
          <span className="text-meta text-meta font-mono uppercase">{tool.tagline}</span>
          <span className="text-meta group-hover:text-indigo text-meta flex items-center gap-2 font-mono uppercase transition-colors duration-300">
            open
            <FiArrowRight
              className="size-3 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
              aria-hidden
            />
          </span>
        </div>
      </Link>
    </li>
  );
}

/** On the list, not on the bench. It holds its slot and says so. */
function QueuedTile({ name, delay }: { name: string; delay: number }) {
  return (
    <li
      className={cn(tile, "animate-resolve border-hairline-faint md:min-h-[15rem]")}
      style={{ animationDelay: `${delay}ms` }}
    >
      <h2 className="text-meta text-headline font-mono font-bold uppercase">{name}</h2>
      <div className="border-hairline-faint mt-6 flex items-center justify-between gap-4 border-t pt-3.5 md:mt-8">
        <span className="text-meta text-meta font-mono uppercase opacity-70">queued</span>
      </div>
    </li>
  );
}

/** Room left on the bench. Drawn, because an incomplete grid is the point. */
function EmptySlot({ delay }: { delay: number }) {
  return (
    <li
      className={cn(
        tile,
        "animate-resolve border-wash hidden items-center justify-center md:flex md:min-h-[15rem]",
      )}
      style={{ animationDelay: `${delay}ms` }}
      aria-hidden
    >
      <span className="bg-hairline size-1.5 rounded-full" />
    </li>
  );
}

function shape(): ClientTool {
  return {
    id: "squoosh",
    name: "tool",
    blurb: "",
    tagline: "",
    href: "/",
    index: "",
    status: "wip",
    key: "",
  };
}
