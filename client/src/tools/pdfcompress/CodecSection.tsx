import type { ReactNode } from "react";
import {
  CODECS,
  DEFAULT_CODEC,
  NEVER_CODECS,
  reasonCodecUnsupported,
  type CodecId,
  type EngineId,
} from "@tools/shared";
import { Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useJxlConfirm } from "./JxlDialog";
import { codecLine } from "./overrides";

/** What choosing each codec means for the reader of the file, beyond the capability line. */
const WHY: Partial<Record<CodecId, string>> = {
  mozjpeg: "Used unless something below is switched on.",
  openjpeg:
    "Smaller than JPEG at the same look, and no blocky edges — but some older viewers and printers can't open it.",
  libjxl:
    "Experimental. Often the smallest at the same look, but JPEG XL in PDF is newly specified and almost no viewer opens it yet.",
  flate: "For images that must stay exact, such as screenshots and line art. Pick it per image in the table.",
};

/**
 * Which encoder writes re-encoded images. mozjpeg is the default and is always
 * there; the others are opt-ins, each a switch that takes over from it (one
 * codec per run — per-image overrides can still mix them). Every row carries
 * its capability line straight from `CODECS`, and the codecs this tool will
 * never write are listed, dimmed, with why, so nobody wonders where they went.
 */
export function CodecSection({
  engine,
  codec,
  onChange,
}: {
  engine: EngineId;
  codec: CodecId;
  onChange: (codec: CodecId) => void;
}) {
  const jxl = useJxlConfirm();
  const optIn = (id: CodecId) => {
    const reason = reasonCodecUnsupported(engine, id);
    const experimental = CODECS[id].availability === "experimental";
    const pick = (on: boolean) => {
      if (reason) return;
      if (!on) return onChange(DEFAULT_CODEC);
      // Experimental codecs ask every time they're switched on; cancel leaves the switch off.
      if (experimental) jxl.ask(() => onChange(id));
      else onChange(id);
    };
    return (
      <Row key={id} id={id} dim={reason} note={reason ?? WHY[id]}>
        <span className="flex items-center gap-2.5">
          <Toggle checked={codec === id} onChange={pick} label={CODECS[id].label} />
          {experimental ? <span className="text-meta text-meta font-mono uppercase">· experimental</span> : null}
        </span>
      </Row>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <span className="text-meta text-meta font-mono uppercase">images are written as</span>
      <ul className="flex flex-col gap-4">
        <Row id="mozjpeg" note={WHY.mozjpeg}>
          <span className="text-meta flex items-center gap-2.5 font-mono uppercase">
            <Bullet on={codec === "mozjpeg"} />
            <span className={codec === "mozjpeg" ? "text-ink" : "text-meta"}>{CODECS.mozjpeg.label}</span>
            <span className="text-meta">· default</span>
          </span>
        </Row>
        {optIn("openjpeg")}
        {optIn("libjxl")}
        <Row id="flate" note={WHY.flate}>
          <span className="text-meta flex items-center gap-2.5 font-mono uppercase">
            <Bullet />
            {CODECS.flate.label}
          </span>
        </Row>
      </ul>
      {jxl.dialog}

      <span className="text-meta text-meta font-mono uppercase">never offered</span>
      <ul className="flex flex-col gap-3">
        {NEVER_CODECS.map((c) => (
          <li key={c.label} className="flex flex-col gap-1 opacity-40">
            <span className="text-meta text-meta font-mono uppercase line-through decoration-1">{c.label}</span>
            <p className="text-meta text-body font-sans normal-case leading-snug">{c.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({
  id,
  note,
  dim,
  children,
}: {
  id: CodecId;
  note?: string | null;
  dim?: string | null;
  children: ReactNode;
}) {
  return (
    <li className={cn("flex flex-col gap-1.5", dim && "opacity-35")} title={dim ?? undefined}>
      {children}
      <span className="text-meta text-meta pl-6 font-mono normal-case tracking-normal">{codecLine(id)}</span>
      {note ? <p className="text-meta text-body pl-6 font-sans normal-case leading-snug">{note}</p> : null}
    </li>
  );
}

/** A dot in the toggle's column, so rows without a switch line up with the ones that have one. */
function Bullet({ on }: { on?: boolean }) {
  return (
    <span aria-hidden className="flex w-3.5 shrink-0 justify-center">
      <span className={cn("size-1.5 rounded-full transition-colors duration-200", on ? "bg-indigo" : "bg-ink/40")} />
    </span>
  );
}
