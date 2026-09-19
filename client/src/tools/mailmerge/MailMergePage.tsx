import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { emptyData, newDoc, type MergeData, type MergeDoc, type MergeRow } from "@tools/shared";
import { Dropzone } from "@/components/Dropzone";
import { Shell } from "@/components/Shell";
import { FiDownload, FiLink, FiLock } from "react-icons/fi";
import { Button, Field, Input, NumberInput, Section, Segmented, TextButton } from "@/components/ui";
import { useHotkey } from "@/hooks/useHotkey";
import { useToast } from "@/hooks/useToast";
import { api, ApiError, assetUrl, type ShareState } from "@/lib/api";
import { cn } from "@/lib/cn";
import { download, loadImage, readAsDataUrl } from "@/lib/download";
import { CanvasStage } from "./CanvasStage";
import { ExportSheet } from "./ExportSheet";
import { DataPanel } from "./DataPanel";
import { LayersPanel } from "./Panels";
import { ReconcileDialog } from "./ReconcileDialog";
import { RowEditor } from "./RowEditor";
import { addRow, changeRow, record, reloadSheet, remapTokens, removeRow, rollback, severed } from "./rows";
import { ProjectsPanel } from "./ProjectsPanel";
import { Inspector } from "./Inspector";
import { ensureDocFonts, loadGoogleFont } from "./fonts";
import { PasswordGate } from "./ShareMenu";
import { ShareDialog } from "./ShareDialog";
import { forget, remember, unlockFor } from "./unlocks";
import { parseSheet, sampleData } from "./sheet";
import { useMerge } from "./useMerge";

const PRESETS: { label: string; width: number; height: number }[] = [
  { label: "square", width: 1080, height: 1080 },
  { label: "story", width: 1080, height: 1920 },
  { label: "landscape", width: 1200, height: 630 },
  { label: "a4", width: 2480, height: 3508 },
];

export function MailMergePage() {
  const { slug } = useParams();
  const toast = useToast();
  const merge = useMerge();
  const [base, setBase] = useState<HTMLImageElement | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [shareProtected, setShareProtected] = useState(false);
  // A locked merge — from a share link or the shelf — waits here for its password.
  const [gate, setGate] = useState<{ error: string | null; target: GateTarget } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [namePattern, setNamePattern] = useState("merge-<name>");
  // Bumped whenever the shelf changes, so the projects list re-reads itself.
  const [shelf, setShelf] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Below md the three columns become one, and one screen shows one job.
  const [pane, setPane] = useState<Pane>("setup");
  const editor = useRef<HTMLDivElement>(null);
  // The row open in the popover, and what it currently says — drawn on the
  // stage before anything is committed.
  const [editing, setEditing] = useState<{ index: number | null; field?: string; anchor: HTMLElement } | null>(null);
  const [draft, setDraft] = useState<MergeRow | null>(null);
  const [reconciling, setReconciling] = useState(false);
  // Where the browser can hand back a file handle, reload re-reads the same
  // file without asking; elsewhere it opens the picker.
  const sheetHandle = useRef<FileHandle | null>(null);
  const [canReload, setCanReload] = useState(false);
  const sheetInput = useRef<HTMLInputElement>(null);

  // Switching panes on a phone should land you at the top of the new one, not
  // halfway down it because that is where the last pane was scrolled to.
  const showPane = useCallback((next: Pane) => {
    setPane(next);
    if (window.matchMedia("(min-width: 768px)").matches) return;
    editor.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const { doc, setDoc, replaceDoc, data, setData, selected, selectedId, setSelectedId } = merge;

  // ── loading ──────────────────────────────────────────────────────────────
  const hydrate = useCallback(
    async (incoming: MergeDoc) => {
      sheetHandle.current = null;
      setCanReload(false);
      setEditing(null);
      setDraft(null);
      await ensureDocFonts(incoming, []);
      if (incoming.base) {
        const src = incoming.base.src.startsWith("asset:") ? assetUrl(incoming.base.src) : incoming.base.src;
        setBase(await loadImage(src).catch(() => null));
      } else {
        setBase(null);
      }
      replaceDoc(incoming);
    },
    [replaceDoc],
  );

  const openShared = useCallback(
    async (shareSlugToOpen: string, password?: string) => {
      setBusy("opening shared merge");
      try {
        const project = await api.getShared(shareSlugToOpen, password);
        await hydrate(project.doc);
        setData(project.data);
        // The link opens the project itself: saving writes to the same
        // document everyone holding the link sees.
        setProjectId(project.id);
        if (password) remember(project.id, password);
        setShareSlug(project.share.slug);
        setShareProtected(project.share.protected);
        setSelectedId(project.doc.layers[0]?.id ?? null);
        setGate(null);
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 0;
        if (status === 401) setGate({ error: password ? "wrong password" : null, target: { kind: "share", slug: shareSlugToOpen } });
        else toast("that share link is not valid");
      } finally {
        setBusy(null);
      }
    },
    [hydrate, setData, setSelectedId, toast],
  );

  useEffect(() => {
    if (!slug) return;
    void openShared(slug);
  }, [slug, openShared]);

  // The default Roboto Mono face must be present before the first paint.
  useEffect(() => {
    void loadGoogleFont("Roboto Mono").catch(() => {});
  }, []);

  // ── base image ───────────────────────────────────────────────────────────
  const pickBase = useCallback(
    async (file: File) => {
      const dataUrl = await readAsDataUrl(file);
      const img = await loadImage(dataUrl).catch(() => null);
      if (!img) {
        toast("could not read that image");
        return;
      }
      setBase(img);
      // Match the canvas to the artwork the first time one is dropped in.
      setDoc((prev) => ({
        ...prev,
        canvas: prev.base ? prev.canvas : { ...prev.canvas, width: img.naturalWidth, height: img.naturalHeight },
        base: { src: dataUrl, fit: prev.base?.fit ?? "cover" },
      }));

      // Hand the bytes to the server as well so batch rendering has the artwork.
      try {
        const asset = await api.uploadAsset(file);
        setDoc((prev) => (prev.base ? { ...prev, base: { ...prev.base, src: asset.ref } } : prev));
      } catch {
        toast("image kept locally — server render will skip it");
      }
    },
    [setDoc, toast],
  );

  // ── export ───────────────────────────────────────────────────────────────
  const rows = data.rows;

  const exportAllServer = useCallback(async () => {
    if (rows.length === 0) return;
    setBusy(`rendering ${rows.length} on the server`);
    try {
      download(await api.renderBatch(doc, data, namePattern), `${doc.name || "merge"}.zip`);
      toast("rendered on the server");
    } catch (error) {
      toast(error instanceof Error ? error.message : "server render failed");
    } finally {
      setBusy(null);
    }
  }, [data, doc, namePattern, rows.length, toast]);

  // ── data ─────────────────────────────────────────────────────────────────
  /**
   * A sheet arriving. Into an empty merge it simply loads; over an existing
   * sheet it is a reload — a step on the timeline that keeps the old rows, so
   * it rolls back — and if the new columns no longer match the template's
   * tokens, the matching dialog opens on its own.
   */
  const loadSheet = useCallback(
    async (file: File) => {
      let parsed: MergeData;
      try {
        parsed = { ...(await parseSheet(file)), source: file.name };
      } catch {
        toast("could not read that sheet");
        return;
      }
      const reloading = data.fields.length > 0;
      setEditing(null);
      setDraft(null);
      setData((prev) => (prev.fields.length > 0 ? reloadSheet(prev, parsed) : { ...parsed, history: [] }));
      merge.setRowIndex((i) => Math.min(i, Math.max(0, parsed.rows.length - 1)));
      const lost = severed(merge.usedFields, parsed.fields);
      if (reloading && lost.length > 0) {
        setReconciling(true);
        toast(`${lost.length} ${lost.length === 1 ? "column no longer matches" : "columns no longer match"}`);
      } else toast(`${parsed.rows.length} rows ${reloading ? "reloaded" : "loaded"}`);
    },
    [data.fields.length, merge, setData, toast],
  );

  const pickSheet = useCallback(async () => {
    const picker = (window as PickerWindow).showOpenFilePicker;
    if (!picker) return sheetInput.current?.click();
    try {
      const [handle] = await picker({
        multiple: false,
        types: [
          {
            description: "Spreadsheets",
            accept: {
              "text/csv": [".csv"],
              "text/tab-separated-values": [".tsv"],
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
              "application/vnd.ms-excel": [".xls"],
            },
          },
        ],
      });
      if (!handle) return;
      sheetHandle.current = handle;
      setCanReload(true);
      await loadSheet(await handle.getFile());
    } catch (error) {
      if ((error as Error).name !== "AbortError") sheetInput.current?.click();
    }
  }, [loadSheet]);

  const reloadSheetFile = useCallback(async () => {
    const handle = sheetHandle.current;
    if (!handle) return void pickSheet();
    try {
      await loadSheet(await handle.getFile());
    } catch {
      // Moved, deleted, or the permission lapsed: ask for it again.
      sheetHandle.current = null;
      setCanReload(false);
      void pickSheet();
    }
  }, [loadSheet, pickSheet]);

  const openRow = useCallback(
    (index: number | null, anchor: HTMLElement, field?: string) => {
      setEditing({ index, field, anchor });
      setDraft(null);
      if (index !== null) merge.setRowIndex(index);
      merge.setShowValues(true);
    },
    [merge],
  );

  const closeRow = useCallback(() => {
    setEditing(null);
    setDraft(null);
  }, []);

  const applyRow = useCallback(
    (values: MergeRow) => {
      if (!editing) return;
      if (editing.index === null) {
        setData((prev) => addRow(prev, values));
        merge.setRowIndex(data.rows.length);
      } else {
        const index = editing.index;
        setData((prev) => changeRow(prev, index, values));
      }
      closeRow();
    },
    [closeRow, data.rows.length, editing, merge, setData],
  );

  const stepRow = useCallback(
    (values: MergeRow, direction: -1 | 1) => {
      if (!editing || editing.index === null) return;
      const index = editing.index;
      const n = data.rows.length;
      const next = (index + direction + n) % n;
      setData((prev) => changeRow(prev, index, values));
      setEditing({ ...editing, index: next });
      setDraft(null);
      merge.setRowIndex(next);
    },
    [data.rows.length, editing, merge, setData],
  );

  const deleteRow = useCallback(() => {
    if (!editing || editing.index === null) return;
    const index = editing.index;
    setData((prev) => removeRow(prev, index));
    merge.setRowIndex(Math.max(0, Math.min(index, data.rows.length - 2)));
    closeRow();
  }, [closeRow, data.rows.length, editing, merge, setData]);

  const rollBack = useCallback(
    (id: string) => {
      const result = rollback(doc, data, id);
      const undone = (data.history?.length ?? 0) - (result.data.history?.length ?? 0);
      if (result.doc !== doc) setDoc(result.doc);
      setData(result.data);
      merge.setRowIndex((i) => Math.min(i, Math.max(0, result.data.rows.length - 1)));
      closeRow();
      toast(`rolled back ${undone} ${undone === 1 ? "edit" : "edits"}`);
    },
    [closeRow, data, doc, merge, setData, setDoc, toast],
  );

  const matchColumns = useCallback(
    (map: Record<string, string>) => {
      setDoc((prev) => remapTokens(prev, map));
      setData((prev) => record(prev, { kind: "remap", map }, prev));
      setReconciling(false);
      const n = Object.keys(map).length;
      toast(`${n} ${n === 1 ? "column" : "columns"} matched`);
    },
    [setData, setDoc, toast],
  );

  // ── persistence ──────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    setBusy("saving");
    try {
      if (projectId) {
        await api.updateProject(projectId, doc.name, doc, data, unlockFor(projectId));
      } else {
        const created = await api.createProject(doc.name, doc, data);
        setProjectId(created.id);
      }
      setShelf((n) => n + 1);
      toast("saved");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (projectId) forget(projectId);
        toast("this merge is locked — reopen it with its password");
      } else toast("could not save — is the api running?");
    } finally {
      setBusy(null);
    }
  }, [data, doc, projectId, toast]);

  /**
   * Save the merge and mint or update its link. `undefined` leaves the lock as
   * it is, `""` opens the link to anyone, anything else locks it. Resolves to
   * the link, or `null` when the api said no.
   */
  const applyShare = useCallback(
    async (password: string | undefined): Promise<ShareState | null> => {
      setBusy("sharing");
      try {
        let id = projectId;
        const current = unlockFor(id);
        if (!id) {
          id = (await api.createProject(doc.name, doc, data)).id;
          setProjectId(id);
        } else {
          await api.updateProject(id, doc.name, doc, data, current);
        }
        const result = await api.share(id, password, current);
        // The new password is now the one this tab holds; an unlock forgets it.
        if (password !== undefined) remember(id, password);
        setShareSlug(result.slug);
        setShareProtected(result.protected);
        setShelf((n) => n + 1);
        if (password !== undefined) toast(result.protected ? "link locked" : "anyone with the link can edit");
        return result;
      } catch (error) {
        toast(
          error instanceof ApiError && error.status === 401
            ? "this merge is locked — reopen it with its password"
            : "could not share — is the api running?",
        );
        return null;
      } finally {
        setBusy(null);
      }
    },
    [data, doc, projectId, toast],
  );

  const openProject = useCallback(
    async (id: string, password?: string) => {
      setBusy("opening");
      const key = password ?? unlockFor(id);
      try {
        const project = await api.getProject(id, key);
        await hydrate(project.doc);
        setData(project.data);
        setSelectedId(project.doc.layers[0]?.id ?? null);
        setProjectId(project.id);
        if (key) remember(project.id, key);
        setShareSlug(project.share?.slug ?? null);
        setShareProtected(project.share?.protected ?? false);
        setGate(null);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          // A remembered password that no longer works is dropped, not retried.
          forget(id);
          setGate({ error: password ? "wrong password" : null, target: { kind: "project", id } });
        } else toast("could not open that project");
      } finally {
        setBusy(null);
      }
    },
    [hydrate, setData, setSelectedId, toast],
  );

  /**
   * A new merge is local until it has a reason not to be. Give it a password
   * and it is created and locked in the same gesture, so the link that goes
   * out is never briefly open.
   */
  const startNew = useCallback(
    async (name: string, password: string) => {
      const fresh = newDoc(name);
      await hydrate(fresh);
      setData(emptyData);
      setSelectedId(fresh.layers[0]?.id ?? null);
      setProjectId(null);
      setShareSlug(null);
      setShareProtected(false);
      setGate(null);
      if (!password) return;

      setBusy("creating a locked merge");
      try {
        const created = await api.createProject(name, fresh, emptyData);
        setProjectId(created.id);
        const link = await api.share(created.id, password);
        remember(created.id, password);
        setShareSlug(link.slug);
        setShareProtected(link.protected);
        setShelf((n) => n + 1);
        toast("created — the share link is locked");
      } catch {
        toast("created here — a locked link needs the api");
      } finally {
        setBusy(null);
      }
    },
    [hydrate, setData, setSelectedId, toast],
  );

  useHotkey("mod+z", (e) => {
    e.preventDefault();
    merge.undo();
  });
  useHotkey("mod+y", (e) => {
    e.preventDefault();
    merge.redo();
  });
  useHotkey("mod+s", (e) => {
    e.preventDefault();
    void save();
  });
  // The row editor owns the arrows while it is open.
  useHotkey("ArrowLeft", () => merge.step(-1), { enabled: !editing });
  useHotkey("ArrowRight", () => merge.step(1), { enabled: !editing });

  const canvasField = (key: "width" | "height") => (
    <Field label={key}>
      <NumberInput
        value={doc.canvas[key]}
        min={16}
        max={8000}
        onChange={(e) =>
          setDoc((prev) => ({ ...prev, canvas: { ...prev.canvas, [key]: Math.max(16, Number(e.target.value) || 16) } }))
        }
      />
    </Field>
  );

  return (
    <Shell width="workspace">
      {/*
       * The toolbar: what this is and which merge it is on the left, the three
       * things you do to a merge on the right. Export is the one solid button
       * in the room, because it is the reason the room exists.
       */}
      <header className="border-hairline-faint mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b pb-4 lg:mb-0 lg:shrink-0 lg:px-6 lg:py-2.5 xl:px-7">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-ink shrink-0 font-mono text-title font-bold uppercase">mail merge</h1>
          <span className="text-meta font-mono text-label" aria-hidden>
            /
          </span>
          <span className="text-label min-w-0 truncate font-mono text-label tracking-normal">{doc.name || "untitled"}</span>
          {shareSlug ? (
            <button
              type="button"
              onClick={() => setSharing(true)}
              className="text-meta hover:text-indigo flex shrink-0 cursor-pointer items-center gap-1.5 self-center font-mono text-meta uppercase transition-colors duration-200"
            >
              {shareProtected ? <FiLock className="size-3" aria-hidden /> : <FiLink className="size-3" aria-hidden />}
              {shareProtected ? "locked" : "shared"}
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-5">
          {busy ? (
            <span className="text-indigo font-mono text-meta uppercase" aria-live="polite">
              {busy}…
            </span>
          ) : null}
          <TextButton onClick={() => void save()} disabled={busy !== null}>
            save
          </TextButton>
          <TextButton onClick={() => setSharing(true)}>share</TextButton>
          <Button onClick={() => setExporting(true)}>
            <FiDownload className="size-3.5" aria-hidden />
            export
          </Button>
        </div>
      </header>

      {gate ? (
        <div className="lg:px-6 lg:pt-6 xl:px-7">
          <PasswordGate
            error={gate.error}
            onSubmit={(password) =>
              void (gate.target.kind === "share" ? openShared(gate.target.slug, password) : openProject(gate.target.id, password))
            }
            onCancel={gate.target.kind === "project" ? () => setGate(null) : undefined}
          />
        </div>
      ) : null}

      {/*
       * One column on a phone, the stage across the top of two columns on a
       * tablet, and from a laptop up a room: setup on the left, the poster in
       * the middle taking every pixel it can, the selected layer on the right.
       * The side panes scroll on their own; the poster never moves.
       */}
      <div
        ref={editor}
        className={cn(
          // A phone gets a plain column so the stage can stick to the top of it;
          // sticky inside a one-row grid has nowhere to travel.
          "flex scroll-mt-16 flex-col gap-6 md:grid md:grid-cols-2 md:items-start",
          "lg:min-h-0 lg:flex-1 lg:grid-cols-[248px_minmax(0,1fr)_272px] lg:items-stretch lg:gap-0",
          "xl:grid-cols-[296px_minmax(0,1fr)_320px]",
          "2xl:grid-cols-[320px_minmax(0,1fr)_344px]",
        )}
        // A share link has nothing to show until it is unlocked; a locked
        // project picked from the shelf leaves the current one in place.
        hidden={gate?.target.kind === "share"}
      >
        {/* left — the merge: projects, document, artwork, layers, data */}
        <div
          data-pane
          className={cn(
            "flex flex-col gap-8 md:order-2 lg:order-1",
            "lg:border-hairline-faint lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:px-6 lg:py-6 xl:px-7",
            pane === "setup" ? "flex" : "hidden md:flex",
          )}
        >
          <ProjectsPanel
            currentId={projectId}
            refreshKey={shelf}
            onOpen={(id) => void openProject(id)}
            onNew={(name, password) => void startNew(name, password)}
            onDeleted={(id) => {
              forget(id);
              setProjectId((current) => (current === id ? null : current));
            }}
          />

          <Section title="document">
            <Field label="name">
              <Input value={doc.name} onChange={(e) => setDoc((prev) => ({ ...prev, name: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              {canvasField("width")}
              {canvasField("height")}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {PRESETS.map((preset) => (
                <TextButton
                  key={preset.label}
                  active={doc.canvas.width === preset.width && doc.canvas.height === preset.height}
                  onClick={() =>
                    setDoc((prev) => ({
                      ...prev,
                      canvas: { ...prev.canvas, width: preset.width, height: preset.height },
                    }))
                  }
                >
                  {preset.label}
                </TextButton>
              ))}
            </div>
          </Section>

          <Section
            title="base image"
            aside={
              doc.base ? (
                <TextButton
                  onClick={() => {
                    setBase(null);
                    setDoc((prev) => ({ ...prev, base: null }));
                  }}
                >
                  remove
                </TextButton>
              ) : null
            }
          >
            {doc.base ? (
              <Segmented
                value={doc.base.fit}
                onChange={(fit) => setDoc((prev) => (prev.base ? { ...prev, base: { ...prev.base, fit } } : prev))}
                options={[
                  { value: "cover", label: "cover" },
                  { value: "contain", label: "contain" },
                  { value: "stretch", label: "stretch" },
                ]}
              />
            ) : (
              <Dropzone
                onFiles={(files) => files[0] && void pickBase(files[0])}
                accept="image/*"
                multiple={false}
                label="drop a base image"
                className="py-6"
              />
            )}
          </Section>

          <LayersPanel
            layers={doc.layers}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={merge.addLayer}
            onToggle={(id, visible) => merge.updateLayer(id, { visible })}
            onDuplicate={merge.duplicateLayer}
            onRemove={merge.removeLayer}
            onReorder={merge.reorderLayer}
          />

          <DataPanel
            data={data}
            usedFields={merge.usedFields}
            rowIndex={merge.rowIndex}
            showValues={merge.showValues}
            editing={editing ? (editing.index ?? "new") : null}
            canReload={canReload}
            onShowValues={merge.setShowValues}
            onStep={merge.step}
            onSelectRow={merge.setRowIndex}
            onPick={() => void pickSheet()}
            onReload={() => void reloadSheetFile()}
            onDropFile={(file) => {
              sheetHandle.current = null;
              setCanReload(false);
              void loadSheet(file);
            }}
            onSample={() => {
              sheetHandle.current = null;
              setCanReload(false);
              setData({ ...sampleData, history: [] });
            }}
            onClear={() => {
              sheetHandle.current = null;
              setCanReload(false);
              closeRow();
              setData(emptyData);
            }}
            onEdit={openRow}
            onRollback={rollBack}
            onReconcile={() => setReconciling(true)}
          />
          <input
            ref={sheetInput}
            type="file"
            accept=".csv,.tsv,.xlsx,.xls,text/csv"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              sheetHandle.current = null;
              setCanReload(false);
              void loadSheet(file);
            }}
          />
        </div>

        {/*
         * The stage, and nothing else. On a phone this wrapper dissolves
         * (`display: contents`) so the canvas becomes a child of the page
         * column and can stay pinned under the top bar while the panes scroll
         * beneath it. From a laptop up it is the whole middle of the room.
         */}
        <div className="contents md:order-1 md:col-span-2 md:flex md:min-w-0 md:flex-col lg:order-2 lg:col-span-1 lg:min-h-0 lg:p-6 xl:p-8">
          <div className="bg-paper/92 sticky top-12 z-30 order-first -mx-5 px-5 pb-3 backdrop-blur-xl sm:-mx-8 sm:px-8 md:static md:mx-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <CanvasStage
              doc={doc}
              row={editing && draft ? draft : merge.currentRow}
              base={base}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onPreview={merge.previewLayer}
              onSnapshot={merge.snapshot}
            />

            <PaneTabs value={pane} onChange={showPane} />
          </div>
        </div>

        {/* right — the selected layer */}
        <div
          className={cn(
            "md:order-3",
            "lg:border-hairline-faint lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:px-6 lg:py-6 xl:px-7",
            pane === "layer" ? "block" : "hidden md:block",
          )}
        >
          <Inspector
            layer={selected}
            fields={data.fields}
            canvas={doc.canvas}
            onChange={(patch) => selectedId && merge.updateLayer(selectedId, patch)}
            onPreview={(patch) => selectedId && merge.previewLayer(selectedId, patch)}
            onSnapshot={merge.snapshot}
          />
        </div>
      </div>

      {exporting ? (
        <ExportSheet
          doc={doc}
          data={data}
          base={base}
          namePattern={namePattern}
          onNamePattern={setNamePattern}
          serverBusy={busy !== null}
          onServerRender={() => void exportAllServer()}
          onClose={() => setExporting(false)}
        />
      ) : null}

      {editing && data.fields.length > 0 ? (
        <RowEditor
          key={editing.index ?? "new"}
          fields={data.fields}
          initial={
            editing.index === null
              ? Object.fromEntries(data.fields.map((f) => [f, ""]))
              : (data.rows[editing.index] ?? {})
          }
          index={editing.index}
          total={data.rows.length}
          focusField={editing.field}
          anchor={editing.anchor}
          onDraft={setDraft}
          onApply={applyRow}
          onStep={stepRow}
          onDelete={deleteRow}
          onClose={closeRow}
        />
      ) : null}

      {reconciling ? (
        <ReconcileDialog
          severed={severed(merge.usedFields, data.fields)}
          matched={merge.usedFields.length - severed(merge.usedFields, data.fields).length}
          fields={data.fields}
          sample={data.rows[0]}
          source={data.source}
          onApply={matchColumns}
          onClose={() => setReconciling(false)}
        />
      ) : null}

      {sharing ? (
        <ShareDialog
          name={doc.name}
          share={shareSlug ? { slug: shareSlug, protected: shareProtected } : null}
          busy={busy !== null}
          onApply={applyShare}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </Shell>
  );
}

/* ── the small-screen switcher ─────────────────────────────────────────────
   A phone cannot hold three columns, and scrolling past a whole settings
   column to reach the artwork is not an editor. The stage stays pinned under
   the top bar and these three cells swap what sits beneath it — the same
   arrangement, and the same language, as the rail across the floor of the
   screen. */

type Pane = "setup" | "layer";

/** The slice of the File System Access API this page uses; not in lib.dom yet. */
type FileHandle = { getFile: () => Promise<File> };
type PickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileHandle[]>;
};

type GateTarget = { kind: "share"; slug: string } | { kind: "project"; id: string };

const PANES: { value: Pane; label: string }[] = [
  { value: "setup", label: "set up" },
  { value: "layer", label: "layer" },
];

function PaneTabs({ value, onChange }: { value: Pane; onChange: (pane: Pane) => void }) {
  return (
    <nav className="border-wash mt-3 grid grid-cols-2 border-y md:hidden" aria-label="editor panes">
      {PANES.map((pane) => {
        const active = pane.value === value;
        return (
          <button
            key={pane.value}
            type="button"
            onClick={() => onChange(pane.value)}
            aria-pressed={active}
            className={cn(
              "text-meta relative cursor-pointer py-3.5 text-center font-mono uppercase transition-colors duration-200",
              active ? "text-ink bg-surface-high" : "text-meta",
            )}
          >
            {active ? <span className="bg-indigo absolute inset-x-0 top-0 h-px" aria-hidden /> : null}
            {pane.label}
          </button>
        );
      })}
    </nav>
  );
}
