import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { FiX } from "react-icons/fi";
import {
  CODECS,
  supportsCodec,
  type CodecId,
  type CompressParams,
  type ImageOverride,
  type PdfImage,
} from "@tools/shared";
import { QueueNotice } from "@/components/QueueNotice";
import { Field, IconButton, Select, TextButton, Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { bytes } from "@/lib/format";
import { pdfJobs } from "@/lib/pdfjobs";
import { change, colourName, pageRanges } from "./analysis";
import { DpiControl, PutBack, QualityControl } from "./controls";
import { useJxlConfirm } from "./JxlDialog";
import {
  asCropResult,
  boxAround,
  canPick,
  centreBox,
  CODEC_SHORT,
  effectiveFor,
  pruneOverride,
  type Box,
} from "./overrides";
import type { CropState } from "./useCrop";

/** Codecs an image can be switched to. */
const PER_IMAGE: CodecId[] = [
  "mozjpeg",
  "openjpeg",
  "libjxl", // experimental: picking it goes through `JxlDialog` first
  "flate",
];

/**
 * One image, opened from its row: its override on the left — codec, quality,
 * DPI cap, or leave it alone — and on the right the same patch of it before
 * and after, drawn by the worker under the current settings. Both crops sit
 * at the same size, so they are at the same zoom whatever the after's pixel
 * count. The small overview picks which patch; it is a plan of the image, not
 * a picture of it, because drawing the whole image would cost as much as the
 * crop is meant to save.
 */
export function CropPanel({
  jobId,
  image,
  params,
  override,
  onOverride,
  box,
  onBox,
  crop,
  onCommitStart,
  onClose,
}: {
  jobId: string;
  image: PdfImage;
  /** The run's settings, without this image's override. */
  params: CompressParams;
  override: ImageOverride | undefined;
  onOverride: (o: ImageOverride | null) => void;
  box: Box | null;
  onBox: (box: Box | null) => void;
  crop: CropState;
  onCommitStart: () => void;
  onClose: () => void;
}) {
  const o = override ?? {};
  const eff = effectiveFor(params, override);
  const set = (patch: Partial<ImageOverride>) => onOverride(pruneOverride({ ...o, ...patch }));
  const clear = (field: keyof ImageOverride) => {
    const next = { ...o };
    delete next[field];
    onOverride(pruneOverride(next));
  };
  const lossless = !CODECS[eff.codec].lossy;
  const jxl = useJxlConfirm();
  const pickCodec = (codec: CodecId | "") => {
    if (!codec) return clear("codec");
    // The select is controlled, so until the dialog is confirmed it keeps showing the old choice.
    if (CODECS[codec].availability === "experimental") jxl.ask(() => set({ codec }));
    else set({ codec });
  };

  return (
    <div className="flex flex-col gap-6 px-1 pb-6 pt-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-ink text-label font-mono uppercase">
            image {image.id} · page {pageRanges(image.pages)}
          </span>
          <span className="text-meta text-label font-mono tabular-nums tracking-normal">
            {image.width}×{image.height} · {image.dpi == null ? "not drawn" : `${Math.round(image.dpi)} dpi`} ·{" "}
            {colourName(image)} · {bytes(image.bytes)}
          </span>
        </div>
        <IconButton label="close" onClick={onClose}>
          <FiX className="size-4" aria-hidden />
        </IconButton>
      </header>

      <div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-meta text-meta font-mono uppercase">this image</span>
            {override ? <TextButton onClick={() => onOverride(null)}>follow the run</TextButton> : null}
          </div>

          <Toggle checked={eff.skip} onChange={(skip) => set({ skip: skip || undefined })} label="leave it as it is" />

          <div className={cn("flex flex-col gap-5 transition-opacity duration-200", eff.skip && "opacity-35")}>
            <Field
              label="codec"
              changed={o.codec !== undefined}
              hint={
                CODECS[eff.codec].availability === "experimental"
                  ? "Experimental — almost no viewer opens JPEG XL in PDF yet."
                  : undefined
              }
              action={
                o.codec !== undefined ? <PutBack label="back to the run's" onClick={() => clear("codec")} /> : null
              }
            >
              <Select
                value={o.codec ?? ""}
                disabled={eff.skip}
                onChange={(e) => pickCodec(e.target.value as CodecId | "")}
              >
                <option value="">as the run · {CODEC_SHORT[params.codec]}</option>
                {PER_IMAGE.map((id) => (
                  <option key={id} value={id} disabled={!supportsCodec(params.engine, id)}>
                    {CODECS[id].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="quality"
              changed={o.quality !== undefined}
              hint={lossless ? "Lossless — quality doesn't apply." : undefined}
              action={
                o.quality !== undefined ? <PutBack label="back to the run's" onClick={() => clear("quality")} /> : null
              }
            >
              <QualityControl
                value={eff.quality}
                onChange={(quality) => set({ quality })}
                onCommitStart={onCommitStart}
                disabled={eff.skip || lossless}
              />
            </Field>

            <Field
              label="downsample above"
              changed={o.dpiCap !== undefined}
              hint={dpiHint(image, eff.dpiCap)}
              action={
                o.dpiCap !== undefined ? <PutBack label="back to the run's" onClick={() => clear("dpiCap")} /> : null
              }
            >
              <DpiControl
                value={eff.dpiCap}
                fallback={params.dpiCap ?? 150}
                onChange={(dpiCap) => set({ dpiCap })}
                onCommitStart={onCommitStart}
                disabled={eff.skip}
              />
            </Field>
          </div>

          {canPick(image) && !eff.skip ? <Overview image={image} box={box} onBox={onBox} /> : null}
        </div>

        <Compare jobId={jobId} image={image} crop={crop} skipped={eff.skip} codec={eff.codec} />
      </div>
      {jxl.dialog}
    </div>
  );
}

/** Whether the cap touches this image at all, since most caps leave small images alone. */
function dpiHint(image: PdfImage, cap: number | null): string | undefined {
  if (image.dpi == null) return "Not drawn on any page, so its size is kept.";
  if (cap === null) return "Kept at its full resolution.";
  if (image.dpi <= cap) return `Drawn at ${Math.round(image.dpi)} dpi — already under the cap, so its size is kept.`;
  const f = cap / image.dpi;
  return `Drawn at ${Math.round(image.dpi)} dpi — becomes ${Math.round(image.width * f)}×${Math.round(image.height * f)}.`;
}

/** The two crops side by side at one size, with what the whole image weighs each way. */
function Compare({
  jobId,
  image,
  crop,
  skipped,
  codec,
}: {
  jobId: string;
  image: PdfImage;
  crop: CropState;
  skipped: boolean;
  /** The codec this image is written with, run or override. */
  codec: CodecId;
}) {
  if (skipped) {
    return (
      <div className="border-wash rounded-xs flex min-h-48 items-center justify-center border px-6 py-8">
        <p className="text-meta text-body max-w-sm text-center font-sans normal-case">
          Left as it is — this image is copied into the output byte for byte.
        </p>
      </div>
    );
  }

  const shown = crop.shown;
  const result = shown ? asCropResult(shown.result) : null;
  const pending = crop.task && crop.task.state !== "done" ? crop.task : null;
  const aspect = (() => {
    const [l, t, r, b] = centreBox(image);
    return `${r - l} / ${b - t}`;
  })();

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Figure
          label="before"
          value={bytes(image.bytes)}
          src={result && shown ? pdfJobs.taskFileUrl(jobId, shown.id, result.before) : null}
          aspect={aspect}
        />
        <Figure
          label="after"
          value={
            result ? (
              <>
                {bytes(result.afterBytes)}{" "}
                <span className={result.afterBytes < image.bytes ? "text-indigo" : "text-meta"}>
                  {change(image.bytes, result.afterBytes)}
                </span>
              </>
            ) : (
              "—"
            )
          }
          src={result && shown ? pdfJobs.taskFileUrl(jobId, shown.id, result.after) : null}
          aspect={aspect}
          stale={crop.stale}
          // The PDF renderer can't decode JPEG XL, so the worker draws this from its own decode — say so, but only
          // once the picture on show is the one drawn under these settings. Under the picture, so both stay level.
          source={codec === "libjxl" && !crop.stale && result ? "decoded jpeg xl" : null}
        />
      </div>

      {crop.error ? (
        <p className="text-meta text-body font-sans normal-case">{crop.error}</p>
      ) : pending ? (
        <QueueNotice task={pending} />
      ) : crop.waiting === "busy" ? (
        <p className="text-meta text-body font-sans normal-case">
          The before/after is drawn once the worker is done with this file's current task.
        </p>
      ) : !shown ? (
        <p className="text-meta text-meta font-mono uppercase">drawing the before/after…</p>
      ) : (
        <p className="text-meta text-body font-sans normal-case">
          Sizes are for the whole image. The patch is shown at the same zoom on both sides.
        </p>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  src,
  aspect,
  stale,
  source,
}: {
  label: string;
  value: ReactNode;
  src: string | null;
  aspect: string;
  stale?: boolean;
  /** What the picture was drawn from, when it isn't the PDF itself. */
  source?: string | null;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-meta text-meta font-mono uppercase">{label}</span>
        <span className="text-ink text-label font-mono tabular-nums tracking-normal">{value}</span>
      </figcaption>
      <div className="border-wash bg-surface rounded-xs overflow-hidden border" style={{ aspectRatio: aspect }}>
        {src ? (
          <img
            src={src}
            alt={`${label}, a patch of the image`}
            draggable={false}
            className={cn(
              "size-full object-contain transition-opacity duration-200 [image-rendering:pixelated]",
              stale && "opacity-40",
            )}
          />
        ) : null}
      </div>
      {source ? <span className="text-meta text-meta font-mono uppercase">{source}</span> : null}
    </figure>
  );
}

/** The overview's longest side, in CSS pixels. */
const PLAN = 168;

/**
 * A plan of the image at its aspect ratio with the crop drawn on it. Press or
 * drag to move the patch; arrow keys move it a tenth at a time. `centre` puts
 * it back where the worker draws it by default.
 */
function Overview({ image, box, onBox }: { image: PdfImage; box: Box | null; onBox: (box: Box | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const scale = PLAN / Math.max(image.width, image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const [l, t, r, b] = box ?? centreBox(image);

  const place = (e: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    onBox(boxAround(image, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale));
  };
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const dx = { ArrowLeft: -1, ArrowRight: 1 }[e.key] ?? 0;
    const dy = { ArrowUp: -1, ArrowDown: 1 }[e.key] ?? 0;
    if (!dx && !dy) return;
    e.preventDefault();
    onBox(boxAround(image, (l + r) / 2 + (dx * image.width) / 10, (t + b) / 2 + (dy * image.height) / 10));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-meta text-meta font-mono uppercase">patch</span>
        {box ? <TextButton onClick={() => onBox(null)}>centre</TextButton> : null}
      </div>
      <div
        ref={ref}
        role="group"
        aria-label="where the patch is — press or drag to move it"
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          place(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) place(e);
        }}
        onKeyDown={nudge}
        className="border-hairline hover:border-edge focus-visible:outline-indigo rounded-xs relative cursor-crosshair touch-none border transition-colors duration-200 focus-visible:outline-1"
        style={{ width: w, height: h }}
      >
        <div
          aria-hidden
          className="border-indigo pointer-events-none absolute border"
          style={{ left: l * scale, top: t * scale, width: (r - l) * scale, height: (b - t) * scale }}
        />
      </div>
      <span className="text-meta text-label font-mono tabular-nums tracking-normal">
        {l},{t} → {r},{b}
      </span>
    </div>
  );
}
