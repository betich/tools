import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { FiArrowRight } from "react-icons/fi";
import { Link, useNavigate } from "react-router-dom";
import { Bezel } from "@/components/Bezel";
import { Shell } from "@/components/Shell";
import { useHotkey } from "@/hooks/useHotkey";
import { useServerStatus } from "@/hooks/useServerStatus";
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
  const offline = useServerStatus() === "offline";

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

  // 1…5 jump straight to whatever is live in that slot.
  useHotkey("1", () => tools[0] && navigate(tools[0].href));
  useHotkey("2", () => tools[1] && navigate(tools[1].href));
  useHotkey("3", () => tools[2] && navigate(tools[2].href));
  useHotkey("4", () => tools[3] && navigate(tools[3].href));
  useHotkey("5", () => tools[4] && navigate(tools[4].href));

  return (
    <Shell width="wide">
      <div className="-mt-4 sm:-mt-8">
        <Bezel />
      </div>

      <ul className={cn("mt-8 grid grid-cols-1 gap-3 sm:mt-10", tools.length > 1 && "lg:grid-cols-2")}>
        {tools.map((tool, i) => (
          <Door key={tool.id} tool={tool} delay={160 + i * 90} down={offline && !!tool.needsServer} />
        ))}
      </ul>
    </Shell>
  );
}

/**
 * A door to a tool that needs the api dims while the server is down — opacity,
 * never a colour — but still opens, so its page can say why it is idle.
 */
function Door({ tool, delay, down }: { tool: ClientTool; delay: number; down: boolean }) {
  return (
    <li className="animate-resolve" style={{ animationDelay: `${delay}ms` }}>
      <Link
        to={tool.href}
        aria-label={`${tool.name} — ${tool.tagline}${down ? " — needs the api, which is offline" : ""}`}
        className={cn(
          down && "opacity-45",
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
          <span className="text-meta text-meta font-mono uppercase">{down ? `${tool.tagline} · api offline` : tool.tagline}</span>
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
  "pdf-compress": <ShrinkArt />,
  "pdf-merge": <JoinArt />,
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

/**
 * The frame both pdf drawings share: the same box as the other two doors, with
 * a container inside it so every length below is a share of the drawing's own
 * width (`cqw`) and the drawing scales as one piece from a phone to a billboard.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="relative aspect-[16/10] w-full max-w-[34rem] lg:h-full lg:max-h-[21rem] lg:w-auto lg:max-w-full">
      <div className="@container absolute inset-0">{children}</div>
    </div>
  );
}

/** One line of type on a drawn page: a bar of ink at the given width. */
function Line({ w, strong = false }: { w: string; strong?: boolean }) {
  return <span className={cn("block shrink-0 rounded-[1px]", strong ? "bg-ink/40 h-[1.1cqw]" : "bg-ink/16 h-[0.55cqw]")} style={{ width: w }} />;
}

/** Two labels in one place, the second taking over on approach. */
function Swap({ from, to, toClass }: { from: ReactNode; to: ReactNode; toClass?: string }) {
  return (
    <span className="grid">
      <span className={cn("[grid-area:1/1] transition-opacity duration-700 group-hover:opacity-0", EASE)}>{from}</span>
      <span className={cn("[grid-area:1/1] opacity-0 transition-opacity duration-700 group-hover:opacity-100", EASE, toClass)}>{to}</span>
    </span>
  );
}

/**
 * pdf compress's own size breakdown beside the page it measures: the file
 * split by what it carries, before and after, on one scale. At rest the two
 * bars match. On approach the images are re-encoded — their segment gives back
 * most of its length, the after bar ends short of the before bar, and the
 * photo on the page lights with it, as pointing at a category does in the tool.
 */
function ShrinkArt() {
  // Tenths of a megabyte, so the bars and the readout are the same numbers.
  const parts = [
    { key: "images", was: 36, now: 5, fill: "bg-ink/60" },
    { key: "fonts", was: 7, now: 7, fill: "bg-ink/48" },
    { key: "content", was: 4, now: 4, fill: "bg-ink/38" },
    { key: "metadata", was: 1, now: 1, fill: "bg-ink/30" },
  ];
  const was = parts.reduce((n, p) => n + p.was, 0);
  const now = parts.reduce((n, p) => n + p.now, 0);
  // A length that holds `rest` and becomes `on` when the door is approached;
  // the before bar passes the same number twice and stays put.
  const grows = "basis-0 grow-[var(--rest)] group-hover:grow-[var(--on)] transition-[flex-grow] duration-700";
  const grow = (rest: number, on: number) => ({ "--rest": rest, "--on": on }) as CSSProperties;

  const bar = (after: boolean) => (
    <span className="flex w-full">
      <span
        className={cn("border-wash bg-surface rounded-hairline flex h-[2.4cqw] gap-px overflow-hidden border", grows, EASE)}
        style={grow(was, after ? now : was)}
      >
        {parts.map((p) => (
          <span
            key={p.key}
            className={cn(
              "block h-full min-w-[2px] transition-[flex-grow,background-color]",
              grows,
              p.fill,
              after && p.was !== p.now && "group-hover:bg-indigo",
              EASE,
            )}
            style={grow(p.was, after ? p.now : p.was)}
          />
        ))}
      </span>
      {/* What the file gave back: bare ground past the end of the after bar. */}
      <span className={cn("block", grows, EASE)} style={grow(0, after ? was - now : 0)} />
    </span>
  );

  const label = "text-meta font-mono text-[max(7px,1.9cqw)] leading-none tracking-[0.18em] uppercase";
  const mb = (tenths: number) => `${(tenths / 10).toFixed(1)} mb`;

  return (
    <Frame>
      <div className="flex size-full items-center justify-center gap-[7cqw]">
        {/* the page: a heading, a photograph, a column of type */}
        <div className="border-wash bg-panel flex aspect-[1/1.414] h-[50cqw] shrink-0 flex-col gap-[1.2cqw] rounded-sm border p-[2.6cqw]">
          <Line w="62%" strong />
          <Line w="38%" />
          <span
            className={cn(
              "border-hairline-faint mt-[0.8cqw] mb-[0.6cqw] block h-[40%] shrink-0 rounded-[3px] border transition-colors duration-700",
              "bg-[repeating-linear-gradient(135deg,rgba(246,245,255,0.09)_0_1px,transparent_1px_6px)]",
              "group-hover:border-indigo/70",
              EASE,
            )}
          />
          <Line w="100%" />
          <Line w="94%" />
          <Line w="100%" />
          <Line w="71%" />
          <Line w="88%" />
        </div>

        {/* the breakdown */}
        <div className="flex w-[44cqw] flex-col">
          <span className={cn(label, "mb-[1.4cqw]")}>before</span>
          {bar(false)}
          <span className={cn(label, "mt-[3.4cqw] mb-[1.4cqw]")}>after</span>
          {bar(true)}

          <span className="border-hairline-faint mt-[4.4cqw] flex items-baseline justify-between gap-[2cqw] border-t pt-[2.4cqw]">
            <span className="text-ink font-mono text-[5.4cqw] leading-none font-bold tracking-normal tabular-nums">
              <Swap from={mb(was)} to={mb(now)} />
            </span>
            <span className="font-mono text-[max(7px,1.9cqw)] leading-none tracking-normal tabular-nums">
              <Swap
                from={<span className="text-meta uppercase tracking-[0.18em]">original</span>}
                to={`−${Math.round((1 - now / was) * 100)}%`}
                toClass="text-indigo text-right"
              />
            </span>
          </span>

          <span className="mt-[2.6cqw] flex flex-wrap gap-x-[2.4cqw] gap-y-[1cqw]">
            {parts.slice(0, 2).map((p) => (
              <span key={p.key} className={cn(label, "flex items-center gap-[0.9cqw] text-[max(7px,1.6cqw)]")}>
                <span
                  className={cn(
                    "block size-[1.3cqw] rounded-[1px] transition-colors duration-700",
                    p.fill,
                    p.was !== p.now && "group-hover:bg-indigo",
                    EASE,
                  )}
                />
                {p.key}
              </span>
            ))}
          </span>
        </div>
      </div>
    </Frame>
  );
}

/**
 * pdf merge's input list drawn as what it becomes: three files, each its own
 * run of pages under its own bracket and numbered from one. On approach they
 * close up into a single document — one bracket, one name, and the pages that
 * moved take their new numbers.
 */
function JoinArt() {
  const files: { name: string; pages: ("text" | "image" | "table")[] }[] = [
    { name: "report.pdf", pages: ["text", "text"] },
    { name: "scan.jpg", pages: ["image"] },
    { name: "notes.pdf", pages: ["table"] },
  ];
  // Page 15cqw wide, 1.2cqw between pages, 10cqw between files at rest.
  const total = files.reduce((n, f) => n + f.pages.length, 0);
  const joined = `${total * 15 + (total - 1) * 1.2}cqw`;
  let at = 0;

  return (
    <Frame>
      <div className="flex size-full items-center justify-center">
        <div className={cn("relative flex items-start gap-[10cqw] transition-[gap] duration-700 group-hover:gap-[1.2cqw]", EASE)}>
          {files.map((file) => (
            <div key={file.name} className="flex flex-col">
              <div className="flex gap-[1.2cqw]">
                {file.pages.map((kind, i) => {
                  at += 1;
                  const own = i + 1;
                  return <Page key={i} kind={kind} own={own} merged={at} />;
                })}
              </div>
              {/* each file's bracket and name, giving way to the merged one */}
              <span className={cn("flex flex-col transition-opacity duration-500 group-hover:opacity-0", EASE)}>
                <span className="border-edge mt-[2.4cqw] block h-[1.4cqw] border-x border-b" />
                <span className="text-meta mt-[1.4cqw] truncate text-center font-mono text-[max(7px,1.8cqw)] leading-none tracking-normal">
                  {file.name}
                </span>
              </span>
            </div>
          ))}

          <span
            className={cn(
              "pointer-events-none absolute top-[calc(21.2cqw+2.4cqw)] left-1/2 flex -translate-x-1/2 flex-col opacity-0 transition-opacity duration-700 group-hover:opacity-100",
              EASE,
            )}
            style={{ width: joined }}
          >
            <span className="border-indigo block h-[1.4cqw] border-x border-b" />
            <span className="text-indigo mt-[1.4cqw] text-center font-mono text-[max(7px,1.8cqw)] leading-none tracking-normal whitespace-nowrap">
              merged.pdf · {String(total).padStart(2, "0")} pages
            </span>
          </span>
        </div>
      </div>
    </Frame>
  );
}

/** One page of a file, with its number at the foot: its own at rest, the merged one on approach. */
function Page({ kind, own, merged }: { kind: "text" | "image" | "table"; own: number; merged: number }) {
  const n = (v: number) => String(v).padStart(2, "0");
  return (
    <span className="border-wash bg-panel flex aspect-[1/1.414] w-[15cqw] flex-col gap-[0.9cqw] rounded-[3px] border p-[1.5cqw]">
      {kind === "image" ? (
        <span className="border-hairline-faint block flex-1 rounded-[2px] border bg-[repeating-linear-gradient(135deg,rgba(246,245,255,0.09)_0_1px,transparent_1px_5px)]" />
      ) : (
        <>
          <Line w="70%" strong />
          {kind === "text" ? (
            ["100%", "92%", "100%", "64%", "100%", "86%"].map((w, i) => <Line key={i} w={w} />)
          ) : (
            <span className="mt-[0.4cqw] grid grid-cols-3 gap-x-[0.8cqw] gap-y-[1cqw]">
              {Array.from({ length: 15 }, (_, i) => (
                <span key={i} className={cn("block h-[0.55cqw] rounded-[1px]", i < 3 ? "bg-ink/32" : "bg-ink/16")} />
              ))}
            </span>
          )}
          <span className="flex-1" />
        </>
      )}
      <span className={cn("self-center font-mono text-[max(6px,1.5cqw)] leading-none tracking-normal tabular-nums", kind === "image" && "mt-[0.3cqw]")}>
        {own === merged ? (
          <span className="text-meta">{n(own)}</span>
        ) : (
          <Swap from={<span className="text-meta">{n(own)}</span>} to={n(merged)} toClass="text-indigo" />
        )}
      </span>
    </span>
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
