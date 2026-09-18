import { useEffect, useState } from "react";
import { FiArrowRight } from "react-icons/fi";
import { Link, useNavigate } from "react-router-dom";
import { Bezel } from "@/components/Bezel";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { useHotkey } from "@/hooks/useHotkey";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { backlog, registry, type ClientTool } from "@/tools/registry";

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

  useHotkey("1", () => navigate(registry[0]!.href));
  useHotkey("2", () => navigate(registry[1]!.href));

  return (
    <Shell width="wide">
      <Bezel count={tools.length} />

      <p
        className="animate-resolve text-prose-muted mx-auto max-w-[62ch] text-center font-sans text-body"
        style={{ animationDelay: "120ms" }}
      >
        A small workshop kept in public — things I built because I needed them, left out on the bench in case they are
        useful to anyone else. Everything here runs in your browser. Nothing is uploaded unless you ask for it.
      </p>

      <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-5">
        {tools.map((tool, i) => (
          <ToolPanel key={tool.id} tool={tool} delay={220 + i * 90} lead={i === 0} />
        ))}
      </div>

      <section className="mt-14">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-meta font-mono text-meta uppercase">on the list</h2>
          <span className="text-meta font-mono text-meta tabular-nums uppercase">{backlog.length}</span>
        </header>
        <div className="border-hairline-faint mt-4 border-t" />

        {backlog.length === 0 ? (
          <div className="mt-4">
            <Empty>nothing queued</Empty>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {backlog.map((item) => (
              <li key={item} className="flex items-baseline">
                <span className="text-label font-mono text-meta uppercase">{item}</span>
                <span className="leader" aria-hidden />
                <span className="text-meta font-mono text-meta uppercase">someday</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}

/**
 * The lead tool takes three of five columns and the larger type; the rest sit
 * beside it. The grid is uneven on purpose — two identical cards would say the
 * two tools are interchangeable, and they are not.
 */
function ToolPanel({ tool, delay, lead }: { tool: ClientTool; delay: number; lead: boolean }) {
  return (
    <Link
      to={tool.href}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "group animate-resolve border-wash rounded-card relative flex flex-col justify-between overflow-hidden border",
        "bg-[rgba(244,243,255,0.035)] transition-colors duration-300",
        "hover:border-[rgba(185,184,239,0.45)] hover:bg-[rgba(244,243,255,0.06)]",
        lead ? "p-7 md:col-span-3 md:p-9" : "p-7 md:col-span-2",
      )}
    >
      {/* A wash of the accent rises from the floor of the panel on approach. */}
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: "linear-gradient(0deg, rgba(72,69,218,0.22), transparent)" }}
        aria-hidden
      />

      <div className="relative">
        <h2
          className={cn(
            "text-ink font-mono font-bold uppercase transition-colors duration-300 group-hover:text-indigo",
            lead ? "text-display" : "text-headline",
          )}
        >
          {tool.name}
        </h2>
        <p className={cn("text-label mt-4 max-w-[46ch] font-sans text-body", !lead && "max-w-[34ch]")}>{tool.blurb}</p>
      </div>

      <div className="border-hairline-faint relative mt-10 flex items-center justify-between gap-4 border-t pt-4">
        <span className="text-meta font-mono text-meta uppercase">{tool.tagline}</span>
        <span className="text-meta group-hover:text-indigo flex items-center gap-2 font-mono text-meta uppercase transition-colors duration-300">
          open
          <FiArrowRight
            className="size-3 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
            aria-hidden
          />
        </span>
      </div>
    </Link>
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
    span: "md:col-span-2",
    key: "",
  };
}
