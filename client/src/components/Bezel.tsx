import { useEffect, useState } from "react";
import { stamp } from "@/lib/format";

/**
 * A compass bezel unrolled flat — the same tick scale track.betich.me wraps
 * into a circle, run edge to edge and faded off at both ends. Drawn with
 * repeating gradients rather than SVG so the tick pitch stays constant and
 * crisp at every width instead of compressing on a phone.
 *
 * It is the page's one authored moment, and it is not decoration: it carries
 * the clock, stamped to the minute the way every entry on betich.me is.
 */
export function Bezel({ count }: { count: number }) {
  const [now, setNow] = useState(() => stamp());

  useEffect(() => {
    const id = setInterval(() => setNow(stamp()), 20_000);
    return () => clearInterval(id);
  }, []);

  const fade = "linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent)";

  return (
    <div className="animate-resolve relative isolate pt-6 pb-2 select-none">
      <div
        className="relative h-14 w-full"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
        aria-hidden
      >
        {/* minor ticks every 9px */}
        <span
          className="absolute inset-x-0 top-1/2 h-4 -translate-y-1/2"
          style={{
            backgroundImage: "repeating-linear-gradient(90deg, rgba(246,245,255,0.40) 0 1px, transparent 1px 9px)",
          }}
        />
        {/* major ticks every 72px */}
        <span
          className="absolute inset-x-0 top-1/2 h-9 -translate-y-1/2"
          style={{
            backgroundImage: "repeating-linear-gradient(90deg, rgba(246,245,255,0.80) 0 1px, transparent 1px 72px)",
          }}
        />
        {/* the needle, and its bloom */}
        <span className="bg-indigo absolute inset-y-0 left-1/2 w-px -translate-x-1/2" />
        <span
          className="absolute inset-y-0 left-1/2 w-24 -translate-x-1/2"
          style={{ background: "radial-gradient(closest-side, rgba(195,194,250,0.26), transparent)" }}
        />
      </div>

      {/* north mark, as on the reference compass */}
      <svg className="text-ink absolute top-1 left-1/2 size-2.5 -translate-x-1/2" viewBox="0 0 10 8" aria-hidden>
        <path d="M5 0 9.33 7.5H0.67z" fill="currentColor" />
      </svg>

      <div className="mt-5 flex flex-wrap items-baseline justify-center gap-x-5 gap-y-1 font-mono text-meta uppercase">
        <time className="text-ink tabular-nums">{now}</time>
        <span className="text-meta opacity-50">·</span>
        <span className="text-meta tabular-nums">
          {count} {count === 1 ? "tool" : "tools"} on the bench
        </span>
      </div>
    </div>
  );
}
