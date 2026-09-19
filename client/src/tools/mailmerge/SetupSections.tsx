import { useRef, useState } from "react";
import { FiImage, FiMaximize, FiRefreshCw, FiRepeat } from "react-icons/fi";
import type { BaseImage, MergeDoc } from "@tools/shared";
import { Dropzone } from "@/components/Dropzone";
import { Button, Field, IconButton, Input, NumberInput, Section, Segmented, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { SizeMenu } from "./SizeMenu";

type Canvas = MergeDoc["canvas"];

/**
 * The document: its name, and its size — picked from the frame list the way
 * Figma offers it, or typed. The swap turns portrait into landscape without
 * retyping two numbers.
 */
export function DocumentSection({
  name,
  canvas,
  onName,
  onCanvas,
}: {
  name: string;
  canvas: Canvas;
  onName: (name: string) => void;
  onCanvas: (patch: Partial<Canvas>) => void;
}) {
  const dim = (key: "width" | "height") => (
    <NumberInput
      aria-label={key}
      value={canvas[key]}
      min={16}
      max={8000}
      onChange={(e) => onCanvas({ [key]: Math.max(16, Number(e.target.value) || 16) })}
      className="pl-7"
    />
  );

  return (
    <Section title="document">
      <Field label="name">
        <Input value={name} onChange={(e) => onName(e.target.value)} />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-meta font-mono text-meta uppercase">size</span>
        <SizeMenu width={canvas.width} height={canvas.height} onPick={onCanvas} />
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="text-meta pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-meta">W</span>
            {dim("width")}
          </label>
          <label className="relative min-w-0 flex-1">
            <span className="text-meta pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-meta">H</span>
            {dim("height")}
          </label>
          <IconButton
            label="swap width and height"
            data-tip-pos="top-right"
            circle
            disabled={canvas.width === canvas.height}
            onClick={() => onCanvas({ width: canvas.height, height: canvas.width })}
            className="shrink-0"
          >
            <FiRepeat className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </Section>
  );
}

/**
 * The artwork under the layers. Empty, it is a drop target with a real button;
 * set, it is the picture itself, with replace beside it and the whole card
 * taking a drop — a new version of the artwork should never mean removing the
 * old one first.
 */
export function BaseImageSection({
  base,
  image,
  canvas,
  onFile,
  onRemove,
  onFit,
  onMatch,
}: {
  base: BaseImage | null;
  image: HTMLImageElement | null;
  canvas: Canvas;
  onFile: (file: File) => void;
  onRemove: () => void;
  onFit: (fit: BaseImage["fit"]) => void;
  onMatch: (size: { width: number; height: number }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const natural = image ? { width: image.naturalWidth, height: image.naturalHeight } : null;
  const mismatched = natural && (natural.width !== canvas.width || natural.height !== canvas.height);

  if (!base) {
    return (
      <Section title="base image">
        <Dropzone
          onFiles={(files) => files[0] && onFile(files[0])}
          accept="image/*"
          multiple={false}
          cta={
            <>
              <FiImage className="size-3.5" aria-hidden />
              choose an image
            </>
          }
          label="or drop one here"
          hint="the first image sets the document size"
          className="gap-3 py-7"
        />
      </Section>
    );
  }

  return (
    <Section
      title="base image"
      aside={
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          <FiRefreshCw className="size-3" aria-hidden />
          replace
        </Button>
      }
    >
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="replace the base image"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />

      {/* the artwork itself, which also takes a drop */}
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className={cn(
          "group checkers relative flex h-44 w-full cursor-pointer items-center justify-center overflow-hidden rounded-card border transition-colors duration-200",
          over ? "border-indigo border-dashed" : "border-wash hover:border-edge",
        )}
        aria-label="replace the base image"
      >
        {image ? <img src={image.src} alt="" className="max-h-full max-w-full object-contain" /> : null}
        <span
          className={cn(
            "bg-paper/80 text-ink absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 py-1.5 font-mono text-meta uppercase backdrop-blur-sm transition-opacity duration-200",
            over ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        >
          {over ? "drop to replace" : "click or drop to replace"}
        </span>
      </button>

      <div className="flex items-center justify-between gap-3">
        <span className="text-meta font-mono text-meta uppercase tabular-nums">
          {natural ? `${natural.width}×${natural.height}` : "loading…"}
        </span>
        <TextButton onClick={onRemove}>remove</TextButton>
      </div>

      <Field label="fit">
        <Segmented
          value={base.fit}
          onChange={onFit}
          options={[
            { value: "cover", label: "cover" },
            { value: "contain", label: "contain" },
            { value: "stretch", label: "stretch" },
          ]}
        />
      </Field>

      {mismatched && natural ? (
        <TextButton onClick={() => onMatch(natural)} className="flex w-fit items-center gap-1.5">
          <FiMaximize className="size-3" aria-hidden />
          size document to image
        </TextButton>
      ) : null}
    </Section>
  );
}
