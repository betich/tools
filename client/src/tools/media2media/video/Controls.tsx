import { Field, Prose, Section, Segmented, Select, Slider, TextButton, Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { audioCodecNote, silentReason, type Availability, type Capabilities } from "./probe";
import {
  ASPECTS,
  AUDIO_OUTPUTS,
  CODECS,
  CONTAINER_CODECS,
  FRAME_RATES,
  SPEEDS,
  centredCrop,
  framedSize,
  heightChoices,
  outputSize,
  rotatedSize,
  type Container,
  type Rotation,
  type SourceInfo,
  type VideoEdit,
} from "./settings";

type Props = {
  edit: VideoEdit;
  source: SourceInfo;
  caps: Capabilities | null;
  /** A discrete change: one undo step. */
  onSet: (next: VideoEdit) => void;
  /** A slider in motion: no step of its own (the snapshot came from `onGestureStart`). */
  onPreview: (next: VideoEdit) => void;
  onGestureStart: () => void;
  cropAspect: string;
  onCropAspect: (id: string) => void;
  disabled: boolean;
};

/**
 * The inspector: what to make, then what to change. Choices this browser
 * can't make are dimmed, never hidden, with the reason under them.
 */
export function OutputSection({ edit, source, caps, onSet, disabled }: Props) {
  const allowed = CONTAINER_CODECS[edit.container];
  const unavailable = (a: Availability | undefined) => (a && !a.ok ? a.reason : null);
  const codecReasons = allowed.map((c) => unavailable(caps?.codecs[c])).filter((r): r is string => !!r);
  const audioReasons = AUDIO_OUTPUTS.map((a) => unavailable(caps?.audioOutputs[a.id])).filter((r): r is string => !!r);

  const setContainer = (container: Container) => {
    const codecs = CONTAINER_CODECS[container];
    const codec = codecs.includes(edit.codec) ? edit.codec : (codecs.find((c) => caps?.codecs[c].ok) ?? codecs[0]!);
    onSet({ ...edit, container, codec });
  };

  const audioNote =
    edit.output === "video" && source.hasAudio && !edit.mute && caps
      ? caps.containerAudio[edit.container] === null
        ? silentReason(edit.container)
        : audioCodecNote(edit.container, caps.containerAudio[edit.container])
      : null;

  return (
    <Section title="output">
      <fieldset disabled={disabled} className="flex flex-col gap-5 disabled:opacity-35">
        <Segmented
          value={edit.output}
          onChange={(output) => onSet({ ...edit, output })}
          options={[
            { value: "video", label: "video" },
            { value: "audio", label: "audio only" },
          ]}
        />

        {edit.output === "video" ? (
          <>
            <Field label="container">
              <Segmented
                value={edit.container}
                onChange={setContainer}
                options={[
                  { value: "mp4", label: "mp4" },
                  { value: "webm", label: "webm" },
                ]}
              />
            </Field>
            <Choice
              label="codec"
              value={edit.codec}
              options={CODECS.filter((c) => allowed.includes(c.id)).map((c) => ({
                value: c.id,
                label: c.label,
                reason: unavailable(caps?.codecs[c.id]),
              }))}
              onChange={(codec) => onSet({ ...edit, codec })}
              notes={caps ? codecReasons : ["Checking what this browser can encode."]}
            />
            <Field label="quality">
              <Segmented
                value={edit.quality}
                onChange={(quality) => onSet({ ...edit, quality })}
                options={[
                  { value: "low", label: "small" },
                  { value: "medium", label: "balanced" },
                  { value: "high", label: "best" },
                ]}
              />
            </Field>
            {audioNote ? <Prose>{audioNote}</Prose> : null}
          </>
        ) : (
          <Choice
            label="format"
            value={edit.audioOutput}
            options={AUDIO_OUTPUTS.map((a) => ({
              value: a.id,
              label: a.label,
              reason: unavailable(caps?.audioOutputs[a.id]),
            }))}
            onChange={(audioOutput) => onSet({ ...edit, audioOutput })}
            notes={caps ? audioReasons : ["Checking what this browser can encode."]}
          />
        )}
      </fieldset>
    </Section>
  );
}

export function EditSection({
  edit,
  source,
  onSet,
  onPreview,
  onGestureStart,
  cropAspect,
  onCropAspect,
  disabled,
}: Props) {
  const video = edit.output === "video";
  const frame = rotatedSize(source, edit.rotate);
  const framed = framedSize(edit, source);
  const size = outputSize(edit, source);
  const speedIndex = Math.max(0, SPEEDS.indexOf(edit.speed as (typeof SPEEDS)[number]));

  const rotate = (rotation: Rotation) => {
    // A crop is in rotated pixels; turning the frame starts it again.
    onSet({ ...edit, rotate: rotation, crop: null });
    onCropAspect("none");
  };

  const pickAspect = (id: string) => {
    onCropAspect(id);
    if (id === "none") return onSet({ ...edit, crop: null });
    const ratio = ASPECTS.find((a) => a.id === id)?.ratio ?? null;
    const crop = ratio ? centredCrop(frame, ratio) : (edit.crop ?? { left: 0, top: 0, ...frame });
    onSet({ ...edit, crop });
  };

  return (
    <Section title="edit">
      <fieldset disabled={disabled} className="flex flex-col gap-5 disabled:opacity-35">
        {video && source.hasVideo ? (
          <>
            <Field label="rotate" changed={edit.rotate !== 0}>
              <Segmented
                value={String(edit.rotate)}
                onChange={(v) => rotate(Number(v) as Rotation)}
                options={[0, 90, 180, 270].map((r) => ({ value: String(r), label: `${r}°` }))}
              />
            </Field>

            <Field
              label="crop"
              changed={edit.crop !== null}
              hint={edit.crop ? "Drag the box on the picture; corners resize, arrow keys nudge." : undefined}
            >
              <Segmented
                value={edit.crop ? cropAspect : "none"}
                onChange={pickAspect}
                options={[{ value: "none", label: "none" }, ...ASPECTS.map((a) => ({ value: a.id, label: a.label }))]}
                className="flex-wrap gap-x-4 gap-y-2"
              />
            </Field>

            <Field label="size" changed={edit.height !== null}>
              <Select
                value={edit.height === null ? "" : String(edit.height)}
                onChange={(e) => onSet({ ...edit, height: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">
                  keep · {framed.width}×{framed.height}
                </option>
                {heightChoices(framed.height).map((h) => (
                  <option key={h} value={h}>
                    {h}p
                  </option>
                ))}
              </Select>
              {edit.height !== null ? (
                <span className="text-meta text-micro font-mono tabular-nums tracking-normal">
                  {size.width}×{size.height}
                </span>
              ) : null}
            </Field>

            <Field label="frame rate" changed={edit.fps !== null}>
              <Select
                value={edit.fps === null ? "" : String(edit.fps)}
                onChange={(e) => onSet({ ...edit, fps: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">keep{source.fps ? ` · ${Math.round(source.fps * 100) / 100} fps` : ""}</option>
                {FRAME_RATES.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : null}

        <Field
          label="speed"
          changed={edit.speed !== 1}
          hint={
            edit.speed !== 1 && source.hasAudio && !(video && edit.mute)
              ? "The sound speeds up with it, pitch and all. Mute it if that isn't wanted."
              : undefined
          }
        >
          <div className="flex items-center gap-3">
            <Slider
              min={0}
              max={SPEEDS.length - 1}
              step={1}
              value={speedIndex}
              onCommitStart={onGestureStart}
              onChange={(i) => onPreview({ ...edit, speed: SPEEDS[i] ?? 1 })}
            />
            <span className="text-indigo text-small w-12 shrink-0 text-right font-mono tabular-nums tracking-normal">
              {edit.speed}×
            </span>
          </div>
        </Field>

        {video && source.hasAudio ? (
          <Toggle checked={edit.mute} onChange={(mute) => onSet({ ...edit, mute })} label="mute" />
        ) : null}
      </fieldset>
    </Section>
  );
}

/** A row of choices where some may be dimmed, each with its reason as a tooltip and as prose beneath. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  notes,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; reason: string | null }[];
  onChange: (v: T) => void;
  notes: string[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-meta text-micro font-mono uppercase">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {options.map((o) => (
          <TextButton
            key={o.value}
            active={o.value === value}
            aria-pressed={o.value === value}
            disabled={!!o.reason}
            data-tip={o.reason ?? undefined}
            className={cn(o.reason && "tooltip")}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </TextButton>
        ))}
      </div>
      {notes.map((n) => (
        <Prose key={n}>{n}</Prose>
      ))}
    </div>
  );
}
