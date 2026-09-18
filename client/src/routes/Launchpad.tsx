import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FiArrowRight } from "react-icons/fi";
import { Link, useNavigate } from "react-router-dom";
import { Bezel } from "@/components/Bezel";
import { Shell } from "@/components/Shell";
import { useHotkey } from "@/hooks/useHotkey";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { registry, type ClientTool } from "@/tools/registry";

/**
 * The index says nothing it does not have to. The bezel keeps the time; each
 * tool is a door with its name at full size and a drawing of what it does, so
 * the page reads before a word of it is read.
 */
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

  // 1…3 jump straight to whatever is live in that slot.
  useHotkey("1", () => tools[0] && navigate(tools[0].href));
  useHotkey("2", () => tools[1] && navigate(tools[1].href));
  useHotkey("3", () => tools[2] && navigate(tools[2].href));

  return (
    <Shell width="wide">
      <div className="-mt-4 sm:-mt-8">
        <Bezel />
      </div>

      <ul className={cn("mt-8 grid grid-cols-1 gap-3 sm:mt-10", tools.length > 1 && "lg:grid-cols-2")}>
        {tools.map((tool, i) => (
          <Door key={tool.id} tool={tool} delay={160 + i * 90} />
        ))}
      </ul>
    </Shell>
  );
}

function Door({ tool, delay }: { tool: ClientTool; delay: number }) {
  return (
    <li className="animate-resolve" style={{ animationDelay: `${delay}ms` }}>
      <Link
        to={tool.href}
        aria-label={`${tool.name} — ${tool.tagline}`}
        className={cn(
          "rounded-card group relative flex h-full min-h-[27rem] flex-col overflow-hidden border p-6 sm:min-h-[32rem] sm:p-8",
          "lg:h-[min(calc(100dvh-21.5rem),44rem)] lg:min-h-[26rem]",
          "border-wash bg-surface transition-colors duration-300",
          "hover:border-indigo/45 hover:bg-surface-high focus-visible:border-indigo focus-visible:outline-none",
        )}
      >
        {/* A wash of the accent rises from the floor of the door on approach. */}
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: "linear-gradient(0deg, rgba(90,87,240,0.22), transparent)" }}
          aria-hidden
        />

        <h2 className="text-ink group-hover:text-indigo relative text-hero font-mono font-bold uppercase transition-colors duration-300">
          {tool.name}
        </h2>

        <div className="relative flex min-h-0 flex-1 items-center justify-center pt-6 pb-10" aria-hidden>
          {ART[tool.id] ?? null}
        </div>

        <div className="border-hairline-faint relative flex items-center justify-between gap-4 border-t pt-3.5">
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

/* ── the drawings ─────────────────────────────────────────────────────────
   Each tool shows its own interface doing its own job, drawn in the page's
   ink and nothing else — periwinkle only on the part that moves. */

const EASE = "ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

const ART: Partial<Record<string, ReactNode>> = {
  squoosh: <CompareArt />,
  "mail-merge": <StackArt />,
};

/**
 * squoosh's compare slider over one image: the original on the left, the
 * compressed copy on the right — the same sphere, quantised into blocks and
 * bands the way an aggressive codec leaves it. On approach the divider slides
 * over to show more of the damage.
 */
function CompareArt() {
  const W = 480;
  const H = 300;
  const CELL = 15;
  const cx = W / 2;
  const cy = H / 2;
  const r = 118;
  // Light falls from the upper left, as on any sphere worth drawing.
  const lx = cx - 42;
  const ly = cy - 46;
  const reach = 190;

  const blocks = useMemo(() => {
    const out: { x: number; y: number; a: number }[] = [];
    for (let y = 0; y < H; y += CELL) {
      for (let x = 0; x < W; x += CELL) {
        const mx = x + CELL / 2;
        const my = y + CELL / 2;
        if (Math.hypot(mx - cx, my - cy) > r) continue;
        const lit = Math.max(0, 1 - Math.hypot(mx - lx, my - ly) / reach);
        // Five bands: the banding is the point.
        const a = Math.round(lit * 4) / 4;
        out.push({ x, y, a: 0.06 + a * 0.84 });
      }
    }
    return out;
  }, [cx, cy, lx, ly]);

  return (
    <div className="relative aspect-[16/10] w-full max-w-[34rem] lg:h-full lg:max-h-[21rem] lg:w-auto lg:max-w-full">
      <div className="border-wash absolute inset-0 overflow-hidden rounded-sm border">
        {/* the original */}
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full">
          <defs>
            <radialGradient id="squoosh-lit" gradientUnits="userSpaceOnUse" cx={lx} cy={ly} r={reach}>
              <stop offset="0" stopColor="#F6F5FF" stopOpacity="0.9" />
              <stop offset="1" stopColor="#F6F5FF" stopOpacity="0.06" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={r} fill="url(#squoosh-lit)" />
        </svg>

        {/* the compressed copy, revealed from the divider rightward */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={cn(
            "absolute inset-0 size-full transition-[clip-path] duration-700",
            "[clip-path:inset(0_0_0_50%)] group-hover:[clip-path:inset(0_0_0_28%)]",
            EASE,
          )}
          shapeRendering="crispEdges"
        >
          <rect width={W} height={H} fill="#04040D" />
          {blocks.map((b) => (
            <rect key={`${b.x}-${b.y}`} x={b.x} y={b.y} width={CELL} height={CELL} fill="#F6F5FF" fillOpacity={b.a} />
          ))}
        </svg>

        {/* the divider and its handle */}
        <div
          className={cn(
            "bg-indigo absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-[left] duration-700 group-hover:left-[28%]",
            EASE,
          )}
        >
          <span className="border-indigo bg-panel absolute top-1/2 left-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border">
            <svg viewBox="0 0 12 8" className="text-indigo w-3" fill="currentColor">
              <path d="M0 4 3.5 0.5v7zM12 4 8.5 0.5v7z" />
            </svg>
          </span>
        </div>
      </div>

      <span className="text-meta absolute -bottom-6 left-0 font-mono text-meta uppercase">original</span>
      <span className="text-meta absolute right-0 -bottom-6 font-mono text-meta uppercase">webp</span>
    </div>
  );
}

/**
 * A merge is one design and a sheet of rows: a stack of the same poster, each
 * with a different name on it, taken from the editor's own sample sheet. On
 * approach the stack deals itself out.
 */
function StackArt() {
  const cards = [
    { name: "katherine johnson", role: "orbital mechanics", rest: "-translate-x-6 -translate-y-5 -rotate-6", fan: "group-hover:-translate-x-[118%] group-hover:translate-y-2 group-hover:-rotate-[9deg]" },
    { name: "grace hopper", role: "compiler pioneer", rest: "-translate-x-2 -translate-y-2 -rotate-2", fan: "group-hover:-translate-y-4 group-hover:rotate-0" },
    { name: "ada lovelace", role: "first programmer", rest: "translate-x-3 translate-y-1 rotate-3", fan: "group-hover:translate-x-[118%] group-hover:translate-y-2 group-hover:rotate-[9deg]" },
  ];

  return (
    <div className="relative flex aspect-[16/10] w-full max-w-[34rem] items-center justify-center lg:h-full lg:max-h-[21rem] lg:w-auto lg:max-w-full">
      {cards.map((card, i) => (
        <div
          key={card.name}
          className={cn(
            "border-wash bg-panel absolute flex aspect-[4/5] w-[34%] flex-col gap-2 rounded-sm border p-[3.5%] transition-transform duration-700",
            card.rest,
            card.fan,
            EASE,
          )}
          style={{ zIndex: i }}
        >
          {/* the base artwork, the same on every card */}
          <span className="border-hairline-faint block flex-1 rounded-[3px] border bg-[repeating-linear-gradient(135deg,rgba(246,245,255,0.07)_0_1px,transparent_1px_7px)]" />
          {/* the merged row */}
          <span className="text-ink block truncate font-mono text-[clamp(0.55rem,1.05vw,0.8rem)] leading-tight font-bold tracking-normal uppercase">
            {card.name}
          </span>
          <span className="text-meta block truncate font-mono text-[clamp(0.45rem,0.8vw,0.625rem)] leading-tight tracking-[0.12em] uppercase">
            {card.role}
          </span>
        </div>
      ))}
    </div>
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
