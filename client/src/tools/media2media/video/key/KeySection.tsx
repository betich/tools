import { useEffect, useRef, useState } from "react";
import { ColorInput, Field, Prose, Section, Slider, TextButton, Toggle } from "@/components/ui";
import { download } from "@/lib/download";
import { bytes } from "@/lib/format";
import type { Capabilities } from "../probe";
import type { SourceInfo, VideoEdit } from "../settings";
import { canSaveToDisk, ExportCanceled, ExportError, MEMORY_LIMIT, pickDiskTarget, type ExportTarget } from "../target";
import { fileStem } from "../../names";
import { webglAvailable } from "./keyer";
import { ALPHA_PLAYBACK_NOTE, sequenceBlocker, sequenceZipName, withKey, type KeySettings } from "./settings";

type Props = {
  edit: VideoEdit;
  source: SourceInfo;
  caps: Capabilities | null;
  file: File;
  onSet: (next: VideoEdit) => void;
  onPreview: (next: VideoEdit) => void;
  onGestureStart: () => void;
  picking: boolean;
  onPicking: (on: boolean) => void;
  /** The WebM export is running. */
  disabled: boolean;
};

type Job =
  | { phase: "idle" }
  | { phase: "running"; frames: number; total: number | null; bytes: number; stop: () => void }
  | { phase: "done"; name: string; frames: number; fps: number; bytes: number; toDisk: boolean }
  | { phase: "failed"; message: string };

/**
 * The chroma key: pick the backdrop off the picture, widen or soften the
 * edge, pull the key's hue out of what stays. The preview shows the result
 * over the checkerboard, drawn by the same shader as the file.
 */
export function KeySection({
  edit,
  source,
  caps,
  file,
  onSet,
  onPreview,
  onGestureStart,
  picking,
  onPicking,
  disabled,
}: Props) {
  const key = edit.key;
  const [job, setJob] = useState<Job>({ phase: "idle" });
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);

  if (!source.hasVideo || edit.output !== "video") return null;

  const setKey = (next: Partial<KeySettings>, kind: "commit" | "preview" = "commit") =>
    (kind === "commit" ? onSet : onPreview)({ ...edit, key: { ...key, ...next } });

  // Transparency only survives in WebM with VP9: switch to it in the same step.
  const toggle = (enabled: boolean) => onSet(withKey(edit, enabled));

  const seqBlocker = sequenceBlocker({ webgl: webglAvailable(), videoDecoder: caps ? caps.videoDecoder : null });
  const busy = job.phase === "running";

  const makeSequence = async () => {
    if (seqBlocker || busy || disabled) return;
    const name = sequenceZipName(file.name);
    let target: ExportTarget = { kind: "memory", limit: MEMORY_LIMIT };
    if (canSaveToDisk()) {
      const picked = await pickDiskTarget(name, "application/zip");
      if (picked === "canceled") return;
      if (picked) target = picked;
    }
    const ctrl = new AbortController();
    running.current = ctrl;
    setJob({ phase: "running", frames: 0, total: null, bytes: 0, stop: () => ctrl.abort() });
    try {
      // Mediabunny and the zipper load on the first sequence, not with the tab.
      const { exportPngSequence } = await import("./sequence");
      const result = await exportPngSequence({
        file,
        stem: fileStem(file.name, "frame"),
        edit,
        source,
        target,
        signal: ctrl.signal,
        onProgress: (p) =>
          setJob((j) =>
            j.phase === "running"
              ? {
                  ...j,
                  frames: p.frames,
                  total: p.fraction > 0 ? Math.round(p.frames / p.fraction) : null,
                  bytes: p.bytes,
                }
              : j,
          ),
      });
      if (result.blob) download(result.blob, name);
      setJob({
        phase: "done",
        name,
        frames: result.frames,
        fps: result.fps,
        bytes: result.bytes,
        toDisk: target.kind === "stream",
      });
    } catch (e) {
      if (e instanceof ExportCanceled || ctrl.signal.aborted) setJob({ phase: "idle" });
      else
        setJob({
          phase: "failed",
          message: e instanceof ExportError ? e.message : "The frames stopped for a reason this browser didn't give.",
        });
    } finally {
      running.current = null;
    }
  };

  return (
    <Section title="key">
      <fieldset disabled={disabled} className="flex flex-col gap-5 disabled:opacity-35">
        <Toggle checked={key.enabled} onChange={toggle} label="chroma key" />

        {key.enabled ? (
          <>
            <Field
              label="key colour"
              changed
              hint={picking ? "Click the backdrop in the picture." : undefined}
              action={
                <TextButton active={picking} aria-pressed={picking} onClick={() => onPicking(!picking)}>
                  pick
                </TextButton>
              }
            >
              {/*
                Each pick is its own undo step: opening the native picker (by
                pointer or keyboard) or starting to type snapshots, and the
                picks within preview. A snapshot only turns into a step once
                something changes, so the extra ones cost nothing.
              */}
              <div
                onFocusCapture={onGestureStart}
                onPointerDownCapture={onGestureStart}
                onKeyDownCapture={(e) => {
                  if (e.key === "Enter" || e.key === " ") onGestureStart();
                }}
              >
                <ColorInput value={key.color} onChange={(color) => setKey({ color }, "preview")} />
              </div>
            </Field>

            <KeySlider
              label="tolerance"
              value={key.tolerance}
              onGestureStart={onGestureStart}
              onChange={(tolerance) => setKey({ tolerance }, "preview")}
            />
            <KeySlider
              label="softness"
              value={key.softness}
              onGestureStart={onGestureStart}
              onChange={(softness) => setKey({ softness }, "preview")}
            />
            <KeySlider
              label="spill"
              value={key.spill}
              onGestureStart={onGestureStart}
              onChange={(spill) => setKey({ spill }, "preview")}
            />

            <Prose>{ALPHA_PLAYBACK_NOTE}</Prose>
          </>
        ) : null}
      </fieldset>

      {key.enabled || busy ? (
        <div className="border-hairline-faint flex flex-col gap-2 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-meta text-meta font-mono uppercase">png sequence</span>
            {busy ? (
              <TextButton onClick={job.stop}>stop</TextButton>
            ) : (
              <TextButton onClick={makeSequence} disabled={!!seqBlocker || disabled}>
                make zip
              </TextButton>
            )}
          </div>
          {job.phase === "running" ? (
            <p className="text-meta text-meta font-mono uppercase" aria-live="polite">
              frames{" "}
              <span className="text-ink tabular-nums tracking-normal">
                {job.frames}
                {job.total ? ` / ${job.total}` : ""}
              </span>{" "}
              · <span className="text-ink tabular-nums tracking-normal">{bytes(job.bytes)}</span>
            </p>
          ) : null}
          {job.phase === "done" ? (
            <Prose>
              {job.frames} frames, {bytes(job.bytes)} — {job.toDisk ? "saved" : "downloaded"} as {job.name}. Import them
              at {Math.round(job.fps * 100) / 100} fps.
            </Prose>
          ) : null}
          {job.phase === "failed" ? <Prose>{job.message}</Prose> : null}
          {seqBlocker ? (
            <Prose>{seqBlocker}</Prose>
          ) : job.phase === "idle" ? (
            <Prose>Transparent PNGs, one per frame, for editing software that won't take the WebM.</Prose>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function KeySlider({
  label,
  value,
  onChange,
  onGestureStart,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onGestureStart: () => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <Slider min={0} max={100} step={1} value={value} onCommitStart={onGestureStart} onChange={onChange} />
        <span className="text-indigo text-label w-12 shrink-0 text-right font-mono tabular-nums tracking-normal">{value}</span>
      </div>
    </Field>
  );
}
