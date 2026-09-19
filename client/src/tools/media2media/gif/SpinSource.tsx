import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dropzone } from "@/components/Dropzone";
import { formatTime } from "@/components/timeline";
import { Button, ColorInput, Section, Sections, Segmented, Slider, TextButton, Toggle } from "@/components/ui";
import { useCodecPool } from "@/hooks/useCodecPool";
import { useToast } from "@/hooks/useToast";
import { IMAGE_ACCEPT, isImageFile } from "@/lib/codecs";
import { cn } from "@/lib/cn";
import { normaliseHex } from "@/lib/color";
import { bytes } from "@/lib/format";
import { gifSession, useGifSession } from "./session";
import {
  defaultSpin,
  drawSpin,
  fitBack,
  frameCount,
  framesFromSpin,
  MAX_FRAMES,
  MAX_PADDING,
  MAX_SPIN_BYTES,
  MAX_SPIN_EDGE,
  scaledTo,
  scaleLayout,
  spinAngles,
  spinBytes,
  spinLayout,
  stepFor,
  type SpinBack,
  type SpinSettings,
} from "./sources/spin";

type Loaded = { bitmap: ImageBitmap; name: string };

/**
 * Kept across opening and closing the panel, like the GIF itself, so going
 * back to tweak a spin doesn't mean choosing the image again.
 */
const memory: { front: Loaded | null; back: Loaded | null; settings: SpinSettings; background: string | null } = {
  front: null,
  back: null,
  settings: defaultSpin(),
  background: null,
};

/** Longest edge of the live preview, in CSS pixels. */
const PREVIEW_EDGE = 360;

/**
 * The spin source: one image turned into the frames of a full turn, flat or
 * as a coin. The settings play live in the panel — drawn every frame by the
 * same painter the generator uses, at preview size, so a slider shows its
 * effect as it moves. Nothing reaches the GIF (or its undo history) until
 * the frames are made, which is one step.
 */
export function SpinSource({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { doc } = useGifSession();
  const [front, setFrontState] = useState(memory.front);
  const [back, setBackState] = useState(memory.back);
  const [s, setSettings] = useState(memory.settings);
  const [background, setBackgroundState] = useState(memory.background);
  const [making, setMaking] = useState<{ done: number; total: number } | null>(null);
  const running = useRef<AbortController | null>(null);
  const { decode, decoding } = useDecoder();

  const set = (patch: Partial<SpinSettings>) => setSettings((prev) => ({ ...prev, ...patch }));
  useEffect(() => {
    memory.settings = s;
  }, [s]);
  const setFront = (l: Loaded | null) => {
    if (memory.front && memory.front !== l && memory.front !== memory.back) memory.front.bitmap.close();
    memory.front = l;
    setFrontState(l);
  };
  const setBack = (l: Loaded | null) => {
    if (memory.back && memory.back !== l && memory.back !== memory.front) memory.back.bitmap.close();
    memory.back = l;
    setBackState(l);
  };
  const setBackground = (b: string | null) => {
    memory.background = b;
    setBackgroundState(b);
  };

  useEffect(() => () => running.current?.abort(), []);

  const count = frameCount(s);
  const layout = useMemo(() => (front ? spinLayout(front.bitmap, s) : null), [front, s]);
  const tooBig = layout ? spinBytes(layout, count) > MAX_SPIN_BYTES : false;

  const open = async (files: File[], which: "front" | "back") => {
    const file = files.find(isImageFile);
    if (!file) return toast("that isn't an image");
    const loaded = await decode(file);
    if (!loaded) return;
    if (which === "front") {
      // A first image comes in at its own size, up to the default; a changed one keeps the size chosen.
      if (!memory.front)
        set({ edge: Math.min(defaultSpin().edge, Math.max(loaded.bitmap.width, loaded.bitmap.height)) });
      setFront(loaded);
    } else {
      setBack(loaded);
      set({ back: "image" });
    }
  };

  const make = async (how: "replace" | "append" | "swap") => {
    if (!front) return;
    running.current?.abort();
    const ctrl = new AbortController();
    running.current = ctrl;
    setMaking({ done: 0, total: count });
    try {
      const frames = await framesFromSpin(front.bitmap, back?.bitmap ?? null, s, {
        signal: ctrl.signal,
        onProgress: (done, total) => {
          if (!ctrl.signal.aborted) setMaking({ done, total });
        },
      });
      gifSession.addFrames(frames, how, { background });
      toast(`${frames.length} frames made`);
      onClose();
    } catch (error) {
      if (!ctrl.signal.aborted) toast(error instanceof Error ? error.message : "could not make the frames");
    } finally {
      if (running.current === ctrl) {
        running.current = null;
        setMaking(null);
      }
    }
  };

  const stop = () => {
    running.current?.abort();
    running.current = null;
    setMaking(null);
  };

  const hasFrames = doc.frames.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-meta text-micro font-mono uppercase">spin one image</p>
        <TextButton onClick={onClose} disabled={!!making}>
          {hasFrames ? "back to the frames" : "use a folder instead"}
        </TextButton>
      </div>

      {!front ? (
        <Dropzone
          accept={IMAGE_ACCEPT}
          multiple={false}
          onFiles={(files) => void open(files, "front")}
          cta="choose an image"
          label={decoding ? "opening…" : "or drop one here"}
          hint="a logo on transparency spins best"
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-3">
            <SpinPreview front={front.bitmap} back={back?.bitmap ?? null} settings={s} background={background} />
            <p className="text-meta text-micro font-mono uppercase">
              <span className="tabular-nums">{count}</span> frames
              {" · "}
              <span className="tabular-nums">{formatTime(count * s.delay)}</span> a turn
              {layout ? (
                <>
                  {" · "}
                  <span className="tabular-nums tracking-normal">
                    {layout.width} × {layout.height}
                  </span>
                  {" · "}
                  <span className="tabular-nums tracking-normal">{bytes(spinBytes(layout, count))}</span>
                </>
              ) : null}
            </p>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
              {making ? (
                <Progress {...making} onStop={stop} />
              ) : hasFrames ? (
                <>
                  <Button disabled={tooBig} onClick={() => void make("swap")}>
                    replace the frames
                  </Button>
                  <Button variant="outline" disabled={tooBig} onClick={() => void make("append")}>
                    add after them
                  </Button>
                </>
              ) : (
                <Button disabled={tooBig} onClick={() => void make("replace")}>
                  make {count} frames
                </Button>
              )}
            </div>
            {tooBig ? (
              <p className="text-meta text-body max-w-prose">
                That many frames at this size is more than the page can hold. Use fewer frames or a smaller size.
              </p>
            ) : null}
          </div>

          <SpinSettingsPanel
            s={s}
            set={set}
            front={front}
            back={back}
            background={background}
            setBackground={setBackground}
            onFront={(files) => void open(files, "front")}
            onBack={(files) => void open(files, "back")}
            onClearBack={() => {
              setBack(null);
              if (s.back === "image") set({ back: "mirror" });
            }}
            busy={decoding || !!making}
          />
        </div>
      )}
    </div>
  );
}

/* ── Settings ───────────────────────────────────────────────────────────── */

function SpinSettingsPanel({
  s,
  set,
  front,
  back,
  background,
  setBackground,
  onFront,
  onBack,
  onClearBack,
  busy,
}: {
  s: SpinSettings;
  set: (patch: Partial<SpinSettings>) => void;
  front: Loaded;
  back: Loaded | null;
  background: string | null;
  setBackground: (b: string | null) => void;
  onFront: (files: File[]) => void;
  onBack: (files: File[]) => void;
  onClearBack: () => void;
  busy: boolean;
}) {
  const count = frameCount(s);
  const [colour, setColour] = useState(background ?? "#ffffff");

  return (
    <Sections>
      <Section
        title="image"
        aside={
          <Picker onFiles={onFront} disabled={busy}>
            change
          </Picker>
        }
      >
        <p className="text-small text-ink truncate font-mono tracking-normal" title={front.name}>
          {front.name}
        </p>
      </Section>

      <Section title="turn">
        <Group
          label="kind"
          hint={s.kind === "coin" ? "About the upright axis, with depth." : "In the picture's plane."}
        >
          <Segmented
            value={s.kind}
            onChange={(kind) => set({ kind })}
            options={[
              { value: "flat", label: "flat" },
              { value: "coin", label: "coin flip" },
            ]}
          />
        </Group>

        <Group label="direction">
          <Segmented
            value={s.direction === 1 ? "a" : "b"}
            onChange={(v) => set({ direction: v === "a" ? 1 : -1 })}
            options={
              s.kind === "flat"
                ? [
                    { value: "a", label: "clockwise" },
                    { value: "b", label: "anticlockwise" },
                  ]
                : [
                    { value: "a", label: "turns right" },
                    { value: "b", label: "turns left" },
                  ]
            }
          />
        </Group>

        <Group
          label="frames"
          hint={
            s.by === "step" && Math.abs(stepFor(count) - s.step) > 1e-9
              ? `Rounded to ${formatDegrees(stepFor(count))} so the turn closes without a seam.`
              : undefined
          }
        >
          <Segmented
            value={s.by}
            onChange={(by) => set(by === "step" ? { by, step: Math.round(stepFor(count) * 10) / 10 } : { by, count })}
            options={[
              { value: "count", label: "count" },
              { value: "step", label: "degrees each" },
            ]}
          />
          {s.by === "count" ? (
            <Readout value={`${count}`}>
              <Slider value={s.count} min={2} max={Math.min(120, MAX_FRAMES)} onChange={(n) => set({ count: n })} />
            </Readout>
          ) : (
            <Readout value={`${formatDegrees(s.step)} · ${count}`}>
              <Slider value={s.step} min={1} max={90} step={0.5} onChange={(step) => set({ step })} />
            </Readout>
          )}
        </Group>

        <Group label="delay">
          <Readout value={`${s.delay} ms`}>
            <Slider value={s.delay} min={20} max={500} step={10} onChange={(delay) => set({ delay })} />
          </Readout>
        </Group>

        <Group label="easing" hint={s.easing === "ease-in-out" ? "Slows as it comes round to the start." : undefined}>
          <Segmented
            value={s.easing}
            onChange={(easing) => set({ easing })}
            options={[
              { value: "linear", label: "steady" },
              { value: "ease-in-out", label: "ease in-out" },
            ]}
          />
        </Group>
      </Section>

      {s.kind === "coin" ? (
        <Section title="coin">
          <Group label="depth">
            <Readout value={`${Math.round(s.perspective * 100)}%`}>
              <Slider
                value={Math.round(s.perspective * 100)}
                min={0}
                max={100}
                onChange={(p) => set({ perspective: p / 100 })}
              />
            </Readout>
          </Group>
          <Group label="back" hint={backHint(s.back)}>
            <Segmented<SpinBack>
              value={s.back}
              onChange={(v) => set({ back: v })}
              options={[
                { value: "mirror", label: "mirrored" },
                { value: "same", label: "same" },
                { value: "image", label: "image" },
                { value: "none", label: "none" },
              ]}
            />
            {s.back === "image" ? (
              back ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-small text-ink truncate font-mono tracking-normal" title={back.name}>
                    {back.name}
                  </span>
                  <span className="flex shrink-0 gap-4">
                    <Picker onFiles={onBack} disabled={busy}>
                      change
                    </Picker>
                    <TextButton onClick={onClearBack} disabled={busy}>
                      remove
                    </TextButton>
                  </span>
                </div>
              ) : (
                <Picker onFiles={onBack} disabled={busy} className="self-start">
                  choose the back
                </Picker>
              )
            ) : null}
          </Group>
        </Section>
      ) : null}

      <Section title="canvas">
        <Group label="image size" hint="The image's longest edge.">
          <Readout value={`${s.edge} px`}>
            <Slider value={s.edge} min={16} max={MAX_SPIN_EDGE} step={8} onChange={(edge) => set({ edge })} />
          </Readout>
        </Group>
        <Group label="padding">
          <Toggle checked={s.room} onChange={(room) => set({ room })} label="room to turn" />
          {!s.room ? <Hint>The corners clip as they pass the edge.</Hint> : null}
          <Readout value={`${s.padding} px`}>
            <Slider
              value={s.padding}
              min={0}
              max={Math.min(MAX_PADDING, 256)}
              step={2}
              onChange={(padding) => set({ padding })}
            />
          </Readout>
        </Group>
        <Group label="background">
          <Segmented
            value={background ? "colour" : "transparent"}
            onChange={(v) => setBackground(v === "transparent" ? null : colour)}
            options={[
              { value: "transparent", label: "transparent" },
              { value: "colour", label: "colour" },
            ]}
          />
          {background ? (
            <ColorInput
              value={colour}
              onChange={(v) => {
                setColour(v);
                const hex = normaliseHex(v);
                if (hex) setBackground(hex);
              }}
            />
          ) : null}
        </Group>
      </Section>
    </Sections>
  );
}

function backHint(back: SpinBack): string {
  switch (back) {
    case "mirror":
      return "The front, seen through from behind.";
    case "same":
      return "The front again, reading the right way.";
    case "image":
      return "A second image, fitted to the front's shape.";
    case "none":
      return "Nothing — the coin vanishes for the half turn it faces away.";
  }
}

const formatDegrees = (d: number) => `${Math.round(d * 100) / 100}°`;

/** A labelled row of controls; not a <label>, which would forward clicks to its first button. */
function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-meta text-micro font-mono uppercase">{label}</span>
      {children}
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="text-meta text-micro font-mono normal-case tracking-normal opacity-80">{children}</span>;
}

/** A slider with its value beside it, in tabular figures. */
function Readout({ value, children }: { value: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">{children}</div>
      <span className="text-small text-ink w-20 shrink-0 text-right font-mono tabular-nums tracking-normal">
        {value}
      </span>
    </div>
  );
}

function Picker({
  onFiles,
  disabled,
  className,
  children,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      <TextButton className={className} disabled={disabled} onClick={() => input.current?.click()}>
        {children}
      </TextButton>
    </>
  );
}

function Progress({ done, total, onStop }: { done: number; total: number; onStop: () => void }) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-label text-micro font-mono uppercase">
          drawing{" "}
          <span className="tabular-nums tracking-normal">
            {done} / {total}
          </span>
        </span>
        <TextButton onClick={onStop}>stop</TextButton>
      </div>
      <div
        role="progressbar"
        aria-label="drawing frames"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="bg-wash relative h-0.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-indigo absolute inset-y-0 left-0 transition-[width] duration-200"
          style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

/* ── Decoding ───────────────────────────────────────────────────────────── */

/** Opens one image on the shared codec pool (HEIC too), upright and with its alpha. */
function useDecoder() {
  const toast = useToast();
  const pool = useCodecPool(1);
  const [decoding, setDecoding] = useState(false);

  const decode = useCallback(
    async (file: File): Promise<Loaded | null> => {
      setDecoding(true);
      try {
        const { image } = await pool().decode(file);
        return { bitmap: await createImageBitmap(image, { premultiplyAlpha: "none" }), name: file.name };
      } catch {
        toast(`${file.name} would not open`);
        return null;
      } finally {
        setDecoding(false);
      }
    },
    [toast, pool],
  );

  return { decode, decoding };
}

/* ── Preview ────────────────────────────────────────────────────────────── */

/**
 * The turn, playing at its real delays. Sources are scaled down once per
 * image and every frame is drawn fresh by `drawSpin` at preview size, so a
 * change to any setting shows on the next animation frame — nothing is
 * generated until the frames are made.
 */
function SpinPreview({
  front,
  back,
  settings,
  background,
}: {
  front: ImageBitmap;
  back: ImageBitmap | null;
  settings: SpinSettings;
  background: string | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [sources, setSources] = useState<{ front: ImageBitmap; back: ImageBitmap | null } | null>(null);
  const [playing, setPlaying] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [still, setStill] = useState(0);
  // The clock outlives each redraw, so dragging a slider doesn't restart the turn.
  const epoch = useRef(performance.now());

  // Scaled-down copies for the preview: fixed size per image, independent of the settings.
  useEffect(() => {
    let live = true;
    const made: ImageBitmap[] = [];
    void (async () => {
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const k = Math.min(1, (PREVIEW_EDGE * dpr) / Math.max(front.width, front.height));
      const box = { width: front.width * k, height: front.height * k };
      const f = await scaledTo(front, box);
      made.push(f);
      let b: ImageBitmap | null = null;
      if (back) {
        const fitted = await fitBack(back, { width: f.width, height: f.height });
        made.push(fitted);
        b = fitted;
      }
      if (live) setSources({ front: f, back: b });
      else for (const m of made) m.close();
    })();
    return () => {
      live = false;
      setSources(null);
      for (const m of made) m.close();
    };
  }, [front, back]);

  const angles = useMemo(() => spinAngles(frameCount(settings), settings.easing, settings.direction), [settings]);
  const layout = useMemo(() => {
    const full = spinLayout(front, settings);
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    return scaleLayout(full, Math.min(1, (PREVIEW_EDGE * dpr) / Math.max(full.width, full.height)));
  }, [front, settings]);
  const backMode = settings.back === "image" && !back ? "mirror" : settings.back;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !sources) return;
    canvas.width = layout.width;
    canvas.height = layout.height;
    const draw = (i: number) => drawSpin(ctx, sources, layout, angles[i % angles.length]!, backMode);
    if (!playing) {
      draw(still);
      return;
    }
    let raf = 0;
    let shown = -1;
    const tick = (now: number) => {
      const i = Math.floor((now - epoch.current) / settings.delay) % angles.length;
      if (i !== shown) {
        shown = i;
        draw(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sources, layout, angles, backMode, playing, still, settings.delay]);

  return (
    <div className="flex flex-col gap-3">
      <div className="border-wash rounded-card flex min-h-[240px] items-center justify-center overflow-hidden border p-4 sm:p-6">
        <canvas
          ref={ref}
          role="img"
          aria-label="spin preview"
          className={cn("block max-h-[56vh] max-w-full", background ? null : "checkers")}
          style={{
            aspectRatio: `${layout.width} / ${layout.height}`,
            width: `min(100%, ${PREVIEW_EDGE}px)`,
            backgroundColor: background ?? undefined,
          }}
        />
      </div>
      <div className="flex items-center gap-4">
        <TextButton onClick={() => setPlaying((p) => !p)}>{playing ? "pause" : "play"}</TextButton>
        {!playing ? (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Slider value={still % angles.length} min={0} max={angles.length - 1} onChange={setStill} />
            <span className="text-small text-ink w-20 shrink-0 text-right font-mono tabular-nums tracking-normal">
              {formatDegrees((((angles[still % angles.length] ?? 0) % 360) + 360) % 360)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
