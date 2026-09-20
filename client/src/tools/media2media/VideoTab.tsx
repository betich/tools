import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropzone } from "@/components/Dropzone";
import { formatTime, Timeline, usePlayback } from "@/components/timeline";
import { FiCheck, FiFilm, FiRotateCw, FiSquare } from "react-icons/fi";
import { Button, Prose, Stat, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useHistory } from "@/hooks/useHistory";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useToast } from "@/hooks/useToast";
import { download } from "@/lib/download";
import { bytes, delta } from "@/lib/format";
import { Bench, FlowArrow, Machine, Panel, Pipe, RunFill } from "./bench";
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
      <Bench className={WIDE}>
        <Panel title="in" label="the video to convert" count={reading ? "reading…" : "nothing yet"}>
          <Dropzone
            onFiles={open}
            accept={VIDEO_ACCEPT}
            multiple={false}
            cta="choose a video"
            label={reading ? "reading the file" : "or drop one anywhere in here"}
            hint="mp4 · mov · webm · mkv — any size; it's read in pieces, never loaded whole"
            className="min-h-80 flex-1 gap-4"
          />
          {problem ? <Prose>{problem}</Prose> : null}
        </Panel>
        <Machine label="export">
          <p className="text-label text-micro font-sans">
            Trim, crop, speed and format appear here once a video is in. Nothing is uploaded — it's all made in this
            browser.
          </p>
          <Pipe live={false} statusId="export-status" status="add a video first">
            <Button size="lg" disabled>
              export
            </Button>
          </Pipe>
        </Machine>
        <Panel title="out" label="the exported file" count="nothing yet">
          <div className="flex min-h-80 flex-1 flex-col items-center justify-center gap-3 text-center">
            <FiFilm className="text-edge size-6" aria-hidden />
            <p className="text-label text-body max-w-[30ch] font-sans">
              The exported file lands here — or goes on to the GIF tab as frames.
            </p>
          </div>
        </Panel>
      </Bench>
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

  const running = job.phase === "running";
  const fraction = running ? (job.progress?.fraction ?? 0) : 0;
  const ext = extensionFor(edit);
  const saveToDisk = caps?.saveToDisk ?? canSaveToDisk();

  let cta: React.ReactNode;
  if (running) {
    cta = (
      <Button
        size="lg"
        variant="outline"
        onClick={job.stop}
        className="border-signal text-ink hover:text-ink relative overflow-hidden"
        aria-describedby="export-status"
      >
        <RunFill share={fraction} />
        <span className="relative flex items-center gap-3">
          <FiSquare className="size-3.5" aria-hidden /> stop
          <span className="tabular-nums tracking-normal">{Math.round(fraction * 100)}%</span>
        </span>
      </Button>
    );
  } else if (job.phase === "done") {
    cta = (
      <Button size="lg" variant="outline" onClick={() => void run()} disabled={!!blocker}>
        <FiRotateCw className="size-4" aria-hidden /> export again
      </Button>
    );
  } else {
    cta = (
      <Button
        size="lg"
        onClick={() => void run()}
        disabled={!!blocker}
        className="group"
        aria-describedby="export-status"
      >
        export {ext}
        <FlowArrow className="transition-transform duration-200 group-hover:translate-x-1 max-lg:group-hover:translate-x-0 max-lg:group-hover:translate-y-0.5" />
      </Button>
    );
  }

  return (
    <Bench className={WIDE}>
      <Panel
        title="in"
        label="the video to convert"
        count={sourceFacts(file, source).join(" · ")}
        aside={<ReplaceButton onReplace={onReplace} disabled={busy} />}
      >
        <span className="text-ink text-small -mt-1 truncate font-mono tracking-normal" title={file.name}>
          {file.name}
        </span>
        {problem ? <Prose>{problem}</Prose> : null}

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
          <Prose key={n}>{n}</Prose>
        ))}

        <div className="border-hairline-faint grid gap-8 border-t pt-6 xl:grid-cols-2">
          <EditSection {...controls} />
          <KeySection {...controls} file={file} picking={key.picking} onPicking={key.setPicking} />
        </div>
      </Panel>

      <Machine label="export">
        <OutputSection {...controls} />
        <Pipe live={running} statusId="export-status" status={ctaStatus(job, saveToDisk)}>
          {cta}
        </Pipe>
        {!running && blocker ? <Prose>{blocker}</Prose> : null}
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
      </Machine>

      <OutPanel
        name={name}
        summary={summary}
        length={outputDuration(edit)}
        size={size}
        sourceBytes={file.size}
        job={job}
        saveToDisk={saveToDisk}
        onRetry={(bitrate) => void run(bitrate)}
      >
        <SendToGif
          file={file}
          source={source}
          edit={edit}
          frameHook={key.frameHook}
          disabled={busy}
          onStart={() => playback.setPlaying(false)}
        />
      </OutPanel>
    </Bench>
  );
}

/** The source is the picture you work on, so it takes twice the output's width. */
const WIDE = "lg:grid-cols-[minmax(0,1.7fr)_15rem_minmax(0,1fr)] xl:grid-cols-[minmax(0,2fr)_17rem_minmax(0,1fr)]";

function ctaStatus(job: Job, saveToDisk: boolean): string {
  if (job.phase === "running") {
    const p = job.progress;
    return [
      p?.fps ? `${formatFps(p.fps)} fps` : "starting",
      p?.remaining != null ? `${formatRemaining(p.remaining)} left` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (job.phase === "done") return job.toDisk ? "saved · change anything and go again" : "downloaded";
  return saveToDisk ? "you pick where it's saved" : "downloads when it's done";
}

function sourceFacts(file: File, source: SourceInfo): string[] {
  return [
    bytes(file.size),
    formatTime(source.duration),
    source.hasVideo ? `${source.width}×${source.height}` : null,
    source.fps ? `${Math.round(source.fps * 100) / 100} fps` : null,
    [source.videoCodec, source.audioCodec].filter(Boolean).join(" + ") || null,
  ].filter((f): f is string => !!f);
}

function ReplaceButton({ onReplace, disabled }: { onReplace: (files: File[]) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <TextButton onClick={() => input.current?.click()} disabled={disabled}>
        replace
      </TextButton>
      <input
        ref={input}
        type="file"
        accept={VIDEO_ACCEPT}
        className="sr-only"
        aria-label="replace the video"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files) onReplace([...e.target.files]);
          e.target.value = "";
        }}
      />
    </>
  );
}

/**
 * What comes out: the file this export will make, how the run is going,
 * and what landed. Its second way out — the same clip as GIF frames — sits
 * under a hairline at the foot.
 */
function OutPanel({
  name,
  summary,
  length,
  size,
  sourceBytes,
  job,
  saveToDisk,
  onRetry,
  children,
}: {
  name: string;
  summary: string[];
  length: number;
  size: { width: number; height: number } | null;
  sourceBytes: number;
  job: Job;
  saveToDisk: boolean;
  onRetry: (bitrate: number) => void;
  children: React.ReactNode;
}) {
  const progress = job.phase === "running" ? job.progress : null;
  const state =
    job.phase === "running"
      ? `encoding · ${Math.round((progress?.fraction ?? 0) * 100)}%`
      : job.phase === "done"
        ? job.toDisk
          ? "saved"
          : "downloaded"
        : job.phase === "failed"
          ? "stopped"
          : "ready to make";

  return (
    <Panel title="out" label="the exported file" count={state}>
      <div className="flex flex-col gap-1">
        <span className="text-ink text-small truncate font-mono tracking-normal" title={name}>
          {name}
        </span>
        <span className="text-meta text-micro font-mono tabular-nums tracking-normal">
          {[formatTime(length), size ? `${size.width}×${size.height}` : null, ...summary].filter(Boolean).join(" · ")}
        </span>
      </div>

      {job.phase === "running" ? (
        <div className="grid grid-cols-2 gap-4" aria-live="polite">
          <Stat label="done" value={`${Math.round((progress?.fraction ?? 0) * 100)}%`} accent />
          <Stat label="speed" value={`${formatFps(progress?.fps ?? null)} fps`} />
          <Stat label="left" value={formatRemaining(progress?.remaining ?? null)} />
          <Stat label={job.toDisk ? "written" : "held"} value={bytes(progress?.bytes ?? 0)} />
        </div>
      ) : null}

      {job.phase === "done" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-meta text-micro flex items-center gap-2 font-mono uppercase">
                <FiCheck className="text-indigo size-3.5" aria-hidden />
                {job.toDisk ? "saved" : "downloaded"}
              </span>
              <span className="text-label text-small font-mono tabular-nums tracking-normal">
                {bytes(sourceBytes)} → <span className="text-ink">{bytes(job.bytes)}</span>
              </span>
            </div>
            <span
              className={cn(
                "text-display font-mono font-bold tabular-nums",
                job.bytes < sourceBytes ? "text-indigo" : "text-ink",
              )}
            >
              {delta(sourceBytes, job.bytes)}
            </span>
          </div>
          {job.target ? <TargetOutcome {...job.target} onRetry={onRetry} /> : null}
          {job.notes.map((n) => (
            <Prose key={n}>{n}</Prose>
          ))}
        </div>
      ) : null}

      {job.phase === "failed" ? <Prose>{job.message}</Prose> : null}
      {job.phase === "idle" ? <Prose>{saveNote(saveToDisk, MEMORY_LIMIT)}</Prose> : null}

      {children}
    </Panel>
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
