import { useEffect, useMemo, useRef, useState } from "react";
import { FiUpload } from "react-icons/fi";
import type { FontSpec } from "@tools/shared";
import { Field, Input, TextButton } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { api, type FontList } from "@/lib/api";
import { cn } from "@/lib/cn";
import { hasItalic, loadGoogleFont, loadUploadedFont, SYSTEM_STACKS, variantFor, weightsOf } from "./fonts";

type Catalogue = FontList["fonts"];

/** Fetched once per session and shared by every picker instance. */
let cataloguePromise: Promise<FontList> | null = null;

function catalogue(): Promise<FontList> {
  cataloguePromise ??= api.fonts("", 400);
  return cataloguePromise;
}

export function FontPicker({ font, onChange }: { font: FontSpec; onChange: (patch: Partial<FontSpec>) => void }) {
  const toast = useToast();
  const [fonts, setFonts] = useState<Catalogue>([]);
  const [source, setSource] = useState<FontList["source"] | "offline">("fallback");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    catalogue()
      .then((list) => {
        setFonts(list.fonts);
        setSource(list.source);
      })
      .catch(() => setSource("offline"));
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? fonts.filter((f) => f.family.toLowerCase().includes(q)) : fonts;
    return list.slice(0, 60);
  }, [fonts, query]);

  const variants = useMemo(
    () => fonts.find((f) => f.family === font.family)?.variants ?? ["400", "700"],
    [fonts, font.family],
  );

  const pick = async (family: string, familyVariants: string[]) => {
    setOpen(false);
    setQuery("");
    try {
      await loadGoogleFont(family, familyVariants);
    } catch {
      toast(`could not load ${family}`);
    }
    const weight = weightsOf(familyVariants).includes(font.weight) ? font.weight : (weightsOf(familyVariants)[0] ?? 400);
    onChange({
      family,
      weight,
      italic: font.italic && hasItalic(familyVariants),
      source: { kind: "google", family, variant: variantFor(weight, font.italic, familyVariants) },
    });
  };

  const upload = async (file: File) => {
    const family = file.name.replace(/\.[^.]+$/, "");
    try {
      await loadUploadedFont(family, file);
    } catch {
      toast("that font file could not be read");
      return;
    }
    // Upload the bytes too, so the server-side batch render uses the same face.
    let assetId = "";
    try {
      assetId = (await api.uploadAsset(file)).id;
    } catch {
      toast("font loaded locally — server render will substitute");
    }
    onChange({ family, source: { kind: "upload", assetId, fileName: file.name } });
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label="family" hint={source === "offline" ? "api unreachable — system fonts only" : undefined}>
        <div ref={box} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="border-wash text-ink hover:border-[rgba(244,243,255,0.28)] focus:border-indigo flex w-full items-center justify-between gap-2 rounded-xs border bg-[rgba(244,243,255,0.04)] px-2.5 py-2 text-left font-mono text-label tracking-normal transition-colors duration-200"
          >
            <span className="truncate">{font.family}</span>
            <span className="text-meta text-meta uppercase">{font.source.kind}</span>
          </button>

          {open ? (
            <div className="animate-menu-in border-wash bg-panel-high absolute top-full left-0 z-50 mt-2 w-full rounded-card border p-2" style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}>
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search fonts"
                className="mb-1.5"
              />
              <ul className="max-h-64 overflow-y-auto">
                {SYSTEM_STACKS.map((family) => (
                  <Row
                    key={family}
                    label={family}
                    meta="system"
                    active={font.family === family}
                    onClick={() => {
                      setOpen(false);
                      onChange({ family, source: { kind: "system" } });
                    }}
                  />
                ))}
                {results.map((f) => (
                  <Row
                    key={f.family}
                    label={f.family}
                    meta={f.category}
                    active={font.family === f.family}
                    onClick={() => void pick(f.family, f.variants)}
                  />
                ))}
                {results.length === 0 && query ? (
                  <li className="text-meta px-2 py-1.5 font-mono text-meta uppercase">no match</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      </Field>

      <label className="text-meta hover:text-indigo inline-flex w-fit cursor-pointer items-center gap-2 font-mono text-meta uppercase transition-colors duration-200">
        <FiUpload className="size-3" aria-hidden />
        upload a font
        <input
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <Field label="weight">
          <select
            value={font.weight}
            onChange={(e) => {
              const weight = Number(e.target.value);
              onChange({
                weight,
                source:
                  font.source.kind === "google"
                    ? { kind: "google", family: font.source.family, variant: variantFor(weight, font.italic, variants) }
                    : font.source,
              });
            }}
            className="border-wash text-ink hover:border-[rgba(244,243,255,0.28)] focus:border-indigo w-full cursor-pointer rounded-xs border bg-[rgba(244,243,255,0.04)] px-2.5 py-2 font-mono text-label tracking-normal transition-colors duration-200 focus:outline-none"
          >
            {(font.source.kind === "google" ? weightsOf(variants) : [300, 400, 500, 600, 700, 800, 900]).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label="style">
          <div className="flex items-center gap-3 pt-1.5">
            <TextButton active={!font.italic} onClick={() => onChange({ italic: false })}>
              normal
            </TextButton>
            <TextButton active={font.italic} onClick={() => onChange({ italic: true })}>
              italic
            </TextButton>
          </div>
        </Field>
      </div>
    </div>
  );
}

function Row({ label, meta, active, onClick }: { label: string; meta: string; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "hover:bg-hover-wash hover:text-indigo focus-visible:bg-hover-wash flex w-full items-baseline justify-between gap-3 rounded-xs px-2.5 py-2 text-left font-mono text-label tracking-normal transition-colors duration-150",
          active ? "text-indigo" : "text-prose",
        )}
      >
        <span className="truncate">{label}</span>
        <span className="text-meta shrink-0 text-meta uppercase">{meta}</span>
      </button>
    </li>
  );
}
