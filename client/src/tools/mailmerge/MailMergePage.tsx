import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { emptyData, newDoc, type MergeDoc } from "@tools/shared";
import { Dropzone } from "@/components/Dropzone";
import { PageHead, Shell } from "@/components/Shell";
import { Empty, Field, Input, NumberInput, Section, Segmented, TextButton } from "@/components/ui";
import { useHotkey } from "@/hooks/useHotkey";
import { useToast } from "@/hooks/useToast";
import { api, ApiError, assetUrl } from "@/lib/api";
import { download, loadImage, readAsDataUrl } from "@/lib/download";
import { pad } from "@/lib/format";
import { CanvasStage } from "./CanvasStage";
import { ExportSheet } from "./ExportSheet";
import { DataPanel, LayersPanel } from "./Panels";
import { ProjectsPanel } from "./ProjectsPanel";
import { Inspector } from "./Inspector";
import { loadGoogleFont } from "./fonts";
import { PasswordGate, ShareMenu } from "./ShareMenu";
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
  const [readOnly, setReadOnly] = useState(false);
  const [gate, setGate] = useState<{ error: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [namePattern, setNamePattern] = useState("merge-<name>");
  // Bumped whenever the shelf changes, so the projects list re-reads itself.
  const [shelf, setShelf] = useState(0);
  const [exporting, setExporting] = useState(false);

  const { doc, setDoc, replaceDoc, data, setData, selected, selectedId, setSelectedId } = merge;

  // ── loading ──────────────────────────────────────────────────────────────
  const hydrate = useCallback(
    async (incoming: MergeDoc) => {
      for (const layer of incoming.layers) {
        if (layer.font.source.kind === "google") {
          await loadGoogleFont(layer.font.source.family, [String(layer.font.weight), "400", "700"]).catch(() => {});
        }
      }
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
        setReadOnly(true);
        setShareSlug(shareSlugToOpen);
        setShareProtected(project.protected);
        setSelectedId(project.doc.layers[0]?.id ?? null);
        setGate(null);
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 0;
        if (status === 401) setGate({ error: password ? "wrong password" : null });
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
    void loadGoogleFont("Roboto Mono", ["400", "700"]).catch(() => {});
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

  // ── persistence ──────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    setBusy("saving");
    try {
      if (projectId) {
        await api.updateProject(projectId, doc.name, doc, data);
      } else {
        const created = await api.createProject(doc.name, doc, data);
        setProjectId(created.id);
      }
      setShelf((n) => n + 1);
      toast("saved");
    } catch {
      toast("could not save — is the api running?");
    } finally {
      setBusy(null);
    }
  }, [data, doc, projectId, toast]);

  const share = useCallback(
    async (password: string) => {
      setBusy("sharing");
      try {
        let id = projectId;
        if (!id) {
          id = (await api.createProject(doc.name, doc, data)).id;
          setProjectId(id);
        } else {
          await api.updateProject(id, doc.name, doc, data);
        }
        setShelf((n) => n + 1);
        const result = await api.share(id, password);
        setShareSlug(result.slug);
        setShareProtected(result.protected);
        const url = `${location.origin}/mail-merge/s/${result.slug}`;
        await navigator.clipboard.writeText(url).catch(() => {});
        toast(result.protected ? "locked share link copied" : "share link copied");
      } catch {
        toast("could not create a share link");
      } finally {
        setBusy(null);
      }
    },
    [data, doc, projectId, toast],
  );

  const openProject = useCallback(
    async (id: string) => {
      setBusy("opening");
      try {
        const project = await api.getProject(id);
        await hydrate(project.doc);
        setData(project.data);
        setSelectedId(project.doc.layers[0]?.id ?? null);
        setProjectId(project.id);
        // A share link belongs to the project, not to this session; the share
        // menu mints or recovers it on demand.
        setShareSlug(null);
        setShareProtected(false);
        setReadOnly(false);
      } catch {
        toast("could not open that project");
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
      setReadOnly(false);
      if (!password) return;

      setBusy("creating a locked merge");
      try {
        const created = await api.createProject(name, fresh, emptyData);
        setProjectId(created.id);
        const link = await api.share(created.id, password);
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
  useHotkey("ArrowLeft", () => merge.step(-1));
  useHotkey("ArrowRight", () => merge.step(1));

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
    <Shell width="wide">
      <PageHead
        title="mail merge"
        note={
          readOnly
            ? "Read-only — you are looking at a shared merge."
            : "A base image, text layers, and a spreadsheet. One image comes out per row."
        }
        actions={
          <>
            <TextButton onClick={() => setExporting(true)}>export</TextButton>
            <TextButton onClick={() => void save()} disabled={readOnly}>
              save
            </TextButton>
            <ShareMenu disabled={readOnly} currentSlug={shareSlug} isProtected={shareProtected} onShare={share} />
          </>
        }
      />

      {busy ? <p className="text-indigo text-meta mb-5 font-mono uppercase">{busy}…</p> : null}

      {gate ? (
        <PasswordGate error={gate.error} onSubmit={(password) => slug && void openShared(slug, password)} />
      ) : null}
      {shareSlug ? (
        <p className="text-meta text-meta mb-5 font-mono uppercase">
          shared at /mail-merge/s/{shareSlug}
          {shareProtected ? " · locked" : ""}
        </p>
      ) : null}

      <div className="grid items-start gap-8 xl:grid-cols-[280px_minmax(0,1fr)_300px] xl:gap-10" hidden={gate !== null}>
        {/* left — document, layers, data */}
        <div className="flex flex-col gap-6 xl:order-1">
          {/* A share link is somebody else's document; the shelf is not theirs to browse. */}
          {readOnly ? null : (
            <ProjectsPanel
              currentId={projectId}
              refreshKey={shelf}
              onOpen={(id) => void openProject(id)}
              onNew={(name, password) => void startNew(name, password)}
              onDeleted={(id) => setProjectId((current) => (current === id ? null : current))}
            />
          )}

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
            onShowValues={merge.setShowValues}
            onStep={merge.step}
            onSample={() => setData(sampleData)}
            onClear={() => setData({ fields: [], rows: [] })}
            onFile={(file) =>
              void parseSheet(file)
                .then((parsed) => {
                  setData(parsed);
                  toast(`${parsed.rows.length} rows loaded`);
                })
                .catch(() => toast("could not read that sheet"))
            }
          />
        </div>

        {/* centre — the stage */}
        <div className="flex min-w-0 flex-col gap-4 xl:order-2">
          <CanvasStage
            doc={doc}
            row={merge.currentRow}
            base={base}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPreview={merge.previewLayer}
            onSnapshot={merge.snapshot}
          />

          <Section
            title="output"
            aside={
              <span className="text-meta text-meta font-mono uppercase">
                {rows.length > 0 ? `${pad(rows.length)} rows` : "no data"}
              </span>
            }
          >
            <Field label="file name" hint="tokens work here too">
              <Input value={namePattern} onChange={(e) => setNamePattern(e.target.value)} spellCheck={false} />
            </Field>
            <div className="flex flex-wrap items-center gap-4">
              <TextButton onClick={() => setExporting(true)} disabled={busy !== null}>
                choose and export
              </TextButton>
              <TextButton onClick={() => void exportAllServer()} disabled={rows.length === 0 || busy !== null}>
                render all on server
              </TextButton>
            </div>
            {rows.length === 0 ? <Empty>load a sheet to render a set</Empty> : null}
          </Section>
        </div>

        {/* right — inspector */}
        <div className="xl:order-3">
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
          onClose={() => setExporting(false)}
        />
      ) : null}
    </Shell>
  );
}
