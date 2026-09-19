import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropzone } from "@/components/Dropzone";
import { formatTime, Timeline, usePlayback } from "@/components/timeline";
import { Button, Prose, TextButton, Value } from "@/components/ui";
import { useHistory } from "@/hooks/useHistory";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useToast } from "@/hooks/useToast";
import { download } from "@/lib/download";
import { bytes } from "@/lib/format";
import { budgetFor, correctedBitrate, outcome, type Outcome } from "./video/budget";
import { EditSection, OutputSection } from "./video/Controls";
import type { ExportProgress } from "./video/export";
import { createKeyer } from "./video/key/keyer";
import { KeySection } from "./video/key/KeySection";
import { ALPHA_PLAYBACK_NOTE } from "./video/key/settings";
import { keyExportBlocker, useKey } from "./video/key/useKey";
import { Preview } from "./video/Preview";
import { decodeNote, exportBlocker, NO_WEBCODECS_DECODE, saveNote } from "./video/probe";
import {
  ASPECTS,
  CONTAINER_CODECS,
  MIME,
  defaultEdit,
  editSummary,
  extensionFor,
  outputDuration,
  outputName,
  outputSize,
  type Rect,
  type SourceInfo,
  type VideoEdit,
} from "./video/settings";
import { SendToGif } from "./video/SendToGif";
import { readSource, SourceError, VIDEO_ACCEPT, looksLikeVideo } from "./video/source";
import {
  canSaveToDisk,
  ExportCanceled,
  ExportError,
  MEMORY_LIMIT,
  pickDiskTarget,
  type ExportTarget,
} from "./video/target";
import { formatFps, formatRemaining } from "./video/timing";
import { TargetOutcome, TargetSizeSection } from "./video/TargetSize";
import { useCapabilities } from "./video/useCapabilities";
import { useFrames } from "./video/useFrames";
import { useVideoClock } from "./video/useVideoClock";

/** A finished export that aimed at a size (#29). */
type TargetDone = {
  outcome: Outcome;
  bitrateMode: "constant" | "variable" | null;
  /** The corrected bitrate for the one retry; null when on target or already retried. */
  retry: number | null;
};

type Loaded = { file: File; url: string; source: SourceInfo };
type Opened = { file: File; source: SourceInfo; seq: number };

type Job =
  | { phase: "idle" }
  | { phase: "running"; progress: ExportProgress | null; stop: () => void; toDisk: boolean }
  | { phase: "done"; name: string; bytes: number; notes: string[]; toDisk: boolean; target: TargetDone | null }
  | { phase: "failed"; message: string };

/**
 * The video tab: one file in, trimmed and edited on the shared timeline,
 * encoded in this browser with WebCodecs through Mediabunny. Nothing is
 * uploaded; the server is never asked.
 */
export function VideoTab() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const url = useObjectUrl(opened?.file);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  const open = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!looksLikeVideo(file)) {
      setProblem("That isn't a video file. MP4, MOV, WebM and MKV work.");
      return;
    }
    setReading(true);
    setProblem(null);
    try {
      const source = await readSource(file);
      setOpened((prev) => ({ file, source, seq: (prev?.seq ?? 0) + 1 }));
    } catch (e) {
      setProblem(
        e instanceof SourceError
          ? e.message
          : "This file couldn't be read. It may be damaged, or in a format this browser can't open.",
      );
    } finally {
      setReading(false);
    }
  }, []);

  if (!opened || !url) {
    return (
      <div className="flex flex-col gap-4">
        <Dropzone
          onFiles={open}
          accept={VIDEO_ACCEPT}
          multiple={false}
          cta="choose a video"
          label={reading ? "reading the file" : "or drop one here"}
          hint="mp4 · mov · webm · mkv — any size; it's read in pieces, never loaded whole"
          className="min-h-72"
        />
        {problem ? <p className="text-meta text-body font-sans normal-case">{problem}</p> : null}
      </div>
    );
  }

  return (
    <Editor
      key={opened.seq}
      loaded={{ file: opened.file, url, source: opened.source }}
      onReplace={open}
      problem={problem}
      onDone={(msg) => toast(msg)}
    />
  );
}

function Editor({
  loaded,
  onReplace,
  problem,
  onDone,
}: {
  loaded: Loaded;
  onReplace: (files: File[]) => void;
  problem: string | null;
  onDone: (message: string) => void;
}) {
  const { file, url, source } = loaded;
  const history = useHistory<VideoEdit>(() => ({
    ...defaultEdit(source),
    output: source.hasVideo ? "video" : "audio",
  }));
  const edit = history.value;
  const key = useKey(edit, (next) => history.set(next(history.value)));
  const [cropAspect, setCropAspect] = useState("none");
  const [job, setJob] = useState<Job>({ phase: "idle" });
  const busy = job.phase === "running";

  const size = edit.output === "video" && source.hasVideo ? outputSize(edit, source) : null;
  const caps = useCapabilities(size);

  // On the first answer, don't leave the default on a codec this browser can't make.
  const picked = useRef(false);
  useEffect(() => {
    if (!caps || picked.current) return;
    picked.current = true;
    if (!caps.codecs[edit.codec].ok) {
      const container = (["mp4", "webm"] as const).find((c) => CONTAINER_CODECS[c].some((k) => caps.codecs[k].ok));
      const codec = container ? CONTAINER_CODECS[container].find((k) => caps.codecs[k].ok) : undefined;
      if (container && codec) history.reset({ ...edit, container, codec });
    }
  }, [caps, edit, history]);

  // The clock: the <video> element's own while it can play the file, a wall clock over decoded stills when not.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [unplayable, setUnplayable] = useState(false);
  const clock = useVideoClock(unplayable ? null : videoEl, {
    duration: source.duration,
    trim: edit.trim,
    speed: edit.speed,
    muted: edit.output === "video" && edit.mute,
  });
  const wall = usePlayback({ duration: source.duration, range: { start: edit.trim.in, end: edit.trim.out } });
  const playback = unplayable ? wall : clock;

  const frames = useFrames(source.hasVideo ? file : null);
  const still = useStill(unplayable && source.hasVideo, playback.time, source, frames.frame);

  const onUnplayable = useCallback(() => {
    setUnplayable(true);
    videoEl?.pause();
  }, [videoEl]);

  const setCrop = useCallback(
    (crop: Rect, kind: "commit" | "preview") => history.change({ ...history.value, crop }, kind),
    [history],
  );

  const [targetBytes, setTargetBytes] = useState<number | null>(null);
  const budget = budgetFor(edit, source, caps?.containerAudio ?? null, targetBytes);
  const blocker =
    keyExportBlocker(edit, caps, key.alpha) ??
    exportBlocker(edit, source, caps) ??
    (budget && !budget.ok ? budget.reason : null);
  const summary = editSummary(edit, source);
  const name = outputName(file.name, edit);
  const notes = [
    caps && !caps.videoDecoder && edit.output === "video" ? NO_WEBCODECS_DECODE : null,
    decodeNote(source),
    unplayable && source.hasVideo
      ? "This browser can't play this file itself, so the preview shows still frames without sound. The export is unaffected."
      : null,
  ].filter((n): n is string => !!n);

  /** `retryBitrate`: the one corrected pass after a target overshoot. */
  const run = async (retryBitrate?: number) => {
    if (blocker || busy) return;
    playback.setPlaying(false);
    const mime = MIME[extensionFor(edit)] ?? "application/octet-stream";
    let target: ExportTarget = { kind: "memory", limit: MEMORY_LIMIT };
    if (canSaveToDisk()) {
      const picked = await pickDiskTarget(name, mime);
      if (picked === "canceled") return;
      if (picked) target = picked;
    }
    const controller = new AbortController();
    const toDisk = target.kind === "stream";
    setJob({ phase: "running", progress: null, stop: () => controller.abort(), toDisk });
    const aim = budget?.ok ? { ...budget, videoBitrate: retryBitrate ?? budget.videoBitrate } : null;
    // Its own GL context, so the preview can repaint while the export draws.
    const keyer = edit.output === "video" && edit.key.enabled ? createKeyer() : null;
    try {
      // Mediabunny and the pipeline load on the first export, not with the tab.
      const { exportVideo } = await import("./video/export");
      const result = await exportVideo({
        file,
        edit,
        source,
        target,
        videoBitrate: aim?.videoBitrate,
        audio: aim?.audio,
        frameHook: keyer?.hookFor(edit.key),
        signal: controller.signal,
        onProgress: (progress) => setJob((j) => (j.phase === "running" ? { ...j, progress } : j)),
      });
      if (result.blob) download(result.blob, name);
      const targetDone: TargetDone | null =
        aim && targetBytes !== null
          ? {
              outcome: outcome(targetBytes, result.bytes),
              bitrateMode: result.bitrateMode,
              retry:
                retryBitrate === undefined
                  ? correctedBitrate(aim, outputDuration(edit), targetBytes, result.bytes)
                  : null,
            }
          : null;
      const notes = keyer ? [...result.notes, ALPHA_PLAYBACK_NOTE] : result.notes;
      setJob({ phase: "done", name, bytes: result.bytes, notes, toDisk, target: targetDone });
      onDone(toDisk ? `${name} saved` : `${name} downloaded`);
    } catch (e) {
      if (e instanceof ExportCanceled) setJob({ phase: "idle" });
      else
        setJob({
          phase: "failed",
          message: e instanceof ExportError ? e.message : "The export stopped for a reason this browser didn't give.",
        });
    } finally {
      keyer?.dispose();
    }
  };

  const aspect = source.width && source.height ? source.width / source.height : 16 / 9;
  const frameStep = source.fps ? 1000 / source.fps : 1000 / 30;
  const aspectRatio = ASPECTS.find((a) => a.id === cropAspect)?.ratio ?? null;

  const controls = {
    edit,
    source,
    caps,
    onSet: history.set,
    onPreview: history.preview,
    onGestureStart: history.snapshot,
    cropAspect,
    onCropAspect: setCropAspect,
    disabled: busy,
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-12">
      <aside className="flex flex-col gap-8">
        <OutputSection {...controls} />
        {edit.output === "video" && source.hasVideo ? (
          <TargetSizeSection
            edit={edit}
            source={source}
            fileBytes={file.size}
            value={targetBytes}
            budget={budget}
            onChange={setTargetBytes}
            onHeight={(height) => history.set({ ...edit, height })}
            disabled={busy}
          />
        ) : null}
        <EditSection {...controls} />
        <KeySection {...controls} file={file} picking={key.picking} onPicking={key.setPicking} />
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        <FileBar file={file} source={source} onReplace={onReplace} disabled={busy} />
        {problem ? <p className="text-meta text-body font-sans normal-case">{problem}</p> : null}

        <Preview
          source={source}
          edit={edit}
          src={url}
          time={playback.time}
          still={still}
          onVideo={setVideoEl}
          onUnplayable={onUnplayable}
          cropAspect={aspectRatio}
          onCrop={setCrop}
          onGestureStart={history.snapshot}
          frameHook={key.frameHook}
          onPick={key.onPick}
        />

        <Timeline
          mode="clip"
          duration={source.duration}
          trim={edit.trim}
          onTrimChange={(trim, kind) => history.change({ ...history.value, trim }, kind)}
          onGestureStart={history.snapshot}
          onUndo={history.undo}
          onRedo={history.redo}
          time={playback.time}
          onTimeChange={playback.setTime}
          playing={playback.playing}
          onPlayingChange={playback.setPlaying}
          loop={playback.loop}
          onLoopChange={playback.setLoop}
          thumbnails={frames.thumbnails}
          frameStep={frameStep}
          aspect={aspect}
          hotkeys={!busy}
        />

        {notes.map((n) => (
          <p key={n} className="text-meta text-body font-sans normal-case leading-snug">
            {n}
          </p>
        ))}

        <ExportRow
          name={name}
          summary={summary}
          length={outputDuration(edit)}
          size={size}
          job={job}
          blocker={blocker}
          saveToDisk={caps?.saveToDisk ?? canSaveToDisk()}
          onExport={() => void run()}
          onRetry={(bitrate) => void run(bitrate)}
        />

        <SendToGif
          file={file}
          source={source}
          edit={edit}
          frameHook={key.frameHook}
          disabled={busy}
          onStart={() => playback.setPlaying(false)}
        />
      </div>
    </div>
  );
}

function FileBar({
  file,
  source,
  onReplace,
  disabled,
}: {
  file: File;
  source: SourceInfo;
  onReplace: (files: File[]) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const facts = [
    bytes(file.size),
    formatTime(source.duration),
    source.hasVideo ? `${source.width}×${source.height}` : null,
    source.fps ? `${Math.round(source.fps * 100) / 100} fps` : null,
    [source.videoCodec, source.audioCodec].filter(Boolean).join(" + ") || null,
  ].filter(Boolean);

  return (
    <div className="border-hairline-faint flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b pb-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-ink text-label truncate font-mono tracking-normal" title={file.name}>
          {file.name}
        </span>
        <span className="text-meta text-meta font-mono tabular-nums tracking-normal">{facts.join(" · ")}</span>
      </div>
      <TextButton onClick={() => input.current?.click()} disabled={disabled}>
        replace
      </TextButton>
      <input
        ref={input}
        type="file"
        accept={VIDEO_ACCEPT}
        className="sr-only"
        aria-label="replace the video"
        onChange={(e) => {
          if (e.target.files) onReplace([...e.target.files]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ExportRow({
  name,
  summary,
  length,
  size,
  job,
  blocker,
  saveToDisk,
  onExport,
  onRetry,
}: {
  name: string;
  summary: string[];
  length: number;
  size: { width: number; height: number } | null;
  job: Job;
  blocker: string | null;
  saveToDisk: boolean;
  onExport: () => void;
  onRetry: (bitrate: number) => void;
}) {
  const running = job.phase === "running";
  const progress = running ? job.progress : null;
  const fraction = progress?.fraction ?? 0;

  return (
    <section className="border-hairline-faint flex flex-col gap-4 border-t pt-6" aria-label="export">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-ink text-label truncate font-mono tracking-normal" title={name}>
            {name}
          </span>
          <span className="text-meta text-meta font-mono tabular-nums tracking-normal">
            {[formatTime(length), size ? `${size.width}×${size.height}` : null, ...summary].filter(Boolean).join(" · ")}
          </span>
        </div>
        {running ? (
          <TextButton onClick={job.stop}>stop</TextButton>
        ) : (
          <Button onClick={onExport} disabled={!!blocker}>
            export
          </Button>
        )}
      </div>

      {running ? (
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label={`export ${name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraction * 100)}
            className="bg-wash relative h-0.5 w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-indigo absolute inset-y-0 left-0 transition-[width] duration-200"
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
          <div className="text-meta text-meta flex flex-wrap gap-x-5 gap-y-1 font-mono uppercase" aria-live="polite">
            <span>
              done <Value>{Math.round(fraction * 100)}%</Value>
            </span>
            <span>
              fps <Value>{formatFps(progress?.fps ?? null)}</Value>
            </span>
            <span>
              left <Value>{formatRemaining(progress?.remaining ?? null)}</Value>
            </span>
            <span>
              {job.toDisk ? "written" : "held"} <Value>{bytes(progress?.bytes ?? 0)}</Value>
            </span>
          </div>
        </div>
      ) : null}

      {job.phase === "done" ? (
        <div className="flex flex-col gap-1">
          <p className="text-meta text-meta font-mono uppercase">
            {job.toDisk ? "saved" : "downloaded"} <Value accent>{bytes(job.bytes)}</Value>
          </p>
          {job.target ? <TargetOutcome {...job.target} onRetry={onRetry} /> : null}
          {job.notes.map((n) => (
            <Prose key={n}>{n}</Prose>
          ))}
        </div>
      ) : null}
      {job.phase === "failed" ? <Prose>{job.message}</Prose> : null}
      {!running && blocker ? <Prose>{blocker}</Prose> : null}
      {!running && !blocker && job.phase !== "done" ? <Prose>{saveNote(saveToDisk, MEMORY_LIMIT)}</Prose> : null}
    </section>
  );
}

/**
 * A decoded frame at the playhead for browsers that can't play the file:
 * one request in flight at a time, and when it lands, the next is for
 * wherever the playhead is by then — so playback shows as many frames as
 * the decoder keeps up with, and a scrub ends on the right one.
 */
function useStill(
  enabled: boolean,
  time: number,
  source: SourceInfo,
  frame: (ms: number, size: { width: number; height: number }, signal?: AbortSignal) => Promise<ImageBitmap | null>,
): ImageBitmap | null {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const want = useRef(time);
  want.current = time;
  const inFlight = useRef(false);
  const session = useRef<AbortController | null>(null);
  const box = useMemo(() => {
    const k = Math.min(1, 960 / Math.max(source.width, source.height, 1));
    return { width: Math.round(source.width * k), height: Math.round(source.height * k) };
  }, [source.width, source.height]);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    session.current = ctrl;
    return () => {
      ctrl.abort();
      session.current = null;
      inFlight.current = false;
    };
  }, [enabled, frame, box]);

  useEffect(() => {
    const ctrl = session.current;
    if (!ctrl || inFlight.current) return;
    inFlight.current = true;
    const go = (asked: number): void => {
      void frame(asked, box, ctrl.signal).then((b) => {
        if (ctrl.signal.aborted) {
          b?.close();
          return;
        }
        if (b) setBitmap(b);
        if (want.current !== asked) go(want.current);
        else inFlight.current = false;
      });
    };
    go(want.current);
  }, [enabled, time, box, frame]);

  // The previous picture is closed once the next one is on screen.
  useEffect(() => () => bitmap?.close(), [bitmap]);
  return enabled ? bitmap : null;
}
