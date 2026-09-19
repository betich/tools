import type { PdfFont } from "@tools/shared";
import { cn } from "@/lib/cn";
import { bytes, delta } from "@/lib/format";

/**
 * Every font the file carries, heaviest first: its name as the file spells it
 * (a value, so normal tracking), its type, whether it is embedded whole, as a
 * subset or not at all, and what it weighs. A font that is not embedded weighs
 * nothing here and depends on the reader having it, which is worth seeing.
 *
 * Seam for #11: `after` maps font id → bytes in the compressed file, and adds
 * an `after` column with the change beside it.
 */
export function FontTable({
  fonts,
  after,
  className,
}: {
  fonts: PdfFont[];
  after?: Record<string, number>;
  className?: string;
}) {
  if (fonts.length === 0) {
    return (
      <p className="text-meta text-body font-sans normal-case">
        No fonts — this file has no text, or draws it as shapes.
      </p>
    );
  }

  const sorted = [...fonts].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

  return (
    <div className={cn("-mx-4 overflow-x-auto px-4", className)}>
      <table className="w-full min-w-[32rem] border-collapse text-left">
        <thead>
          <tr className="border-wash text-meta border-b font-mono uppercase">
            <th scope="col" className="py-2 pr-4 font-normal">
              name
            </th>
            <th scope="col" className="py-2 pr-4 font-normal">
              type
            </th>
            <th scope="col" className="py-2 pr-4 font-normal">
              embedded
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-normal last:pr-0">
              bytes
            </th>
            {after ? (
              <th scope="col" className="py-2 text-right font-normal">
                after
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {sorted.map((font) => {
            const out = after?.[font.id];
            return (
              <tr
                key={font.id}
                className={cn(
                  "border-hairline-faint text-label border-b font-mono tabular-nums tracking-normal",
                  !font.embedded && "opacity-60",
                )}
              >
                <td className="text-ink max-w-[16rem] truncate py-2.5 pr-4" title={font.name}>
                  {font.name}
                </td>
                <td className="text-label whitespace-nowrap py-2.5 pr-4">{font.type}</td>
                <td className="text-label whitespace-nowrap py-2.5 pr-4">
                  {font.embedded ? (font.subset ? "subset" : "full") : "no"}
                </td>
                <td className="text-ink whitespace-nowrap py-2.5 pr-4 text-right last:pr-0">
                  {font.embedded ? bytes(font.bytes) : "—"}
                </td>
                {after ? (
                  <td className="whitespace-nowrap py-2.5 text-right">
                    {out == null ? (
                      <span className="text-meta">—</span>
                    ) : (
                      <>
                        <span className="text-ink">{bytes(out)}</span>{" "}
                        <span className={out < font.bytes ? "text-indigo" : "text-meta"}>{delta(font.bytes, out)}</span>
                      </>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
