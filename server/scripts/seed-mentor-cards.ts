/**
 * Seeds the hAMP9 "MENTOR" card collection.
 *
 * Geometry is measured, not guessed: `A.png` is the empty plate and
 * `A (1).png` is a filled example, so differencing the two gives the exact ink
 * box of every text layer in the original artwork. The boxes below are centred
 * on those measurements — nickname 1176, intania 1675, role 2068 (the gold
 * pill's own centre), name 2336 — on a 2242×3171 canvas.
 *
 *   bun run scripts/seed-mentor-cards.ts [--api http://localhost:8787] [--password champeng]
 */
import { basename } from "node:path";
import type { FallbackFont, FontSpec, MergeData, MergeDoc, MergeRow, TextLayer } from "@tools/shared";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? (process.argv[i + 1] ?? fallback) : fallback;
};

const API = arg("api", "http://localhost:8787").replace(/\/$/, "");
const PASSWORD = arg("password", "champeng");
const CSV = arg("csv", "/home/betich/code/tools/.orca/drops/Mentor info - Sheet5 (1).csv");
/** Given, the run updates that project in place so its share link survives. */
const PROJECT = arg("project", "");
const IMAGE = arg("image", "/home/betich/code/tools/.orca/drops/A.png");

const CANVAS = { width: 2242, height: 3171 };
const PILL = { x: 198, y: 1971, w: 1842, h: 195 };

const GOLD = "#FFE19B";
const PILL_INK = "#790000";
const WHITE = "#FFFFFF";

/** Inter carries the Latin; Noto Sans Thai carries everything Inter cannot draw. */
const thai = (weight: number): FallbackFont[] => [
  { family: "Noto Sans Thai", source: { kind: "google", family: "Noto Sans Thai", variant: String(weight) } },
];

const inter = (weight: number, size: number, lineHeight: number): FontSpec => ({
  family: "Inter",
  weight,
  italic: true,
  size,
  lineHeight,
  letterSpacing: 0,
  source: { kind: "google", family: "Inter", variant: `${weight}italic` },
  fallbacks: thai(weight),
});

/**
 * Centring uses advance widths, but a steeply italic face puts its ink to the
 * right of them — about a tenth of the font size. These nudges were measured
 * against the reference export rather than reasoned about, and they scale with
 * the type size, which is why the 600px nickname needs a large one and the
 * 96px name barely any.
 */
const centred = (width: number, inkNudge = 0) => Math.round((CANVAS.width - width) / 2 + inkNudge);

type LayerSpec = Partial<TextLayer> & Pick<TextLayer, "id" | "name" | "text" | "y" | "height" | "font"> & { inkNudge?: number };

function layer(partial: LayerSpec): TextLayer {
  const width = partial.width ?? 1600;
  const { inkNudge = 0, ...rest } = partial as Partial<TextLayer> & { inkNudge?: number };
  return {
    kind: "text",
    x: centred(width, inkNudge),
    width,
    rotation: 0,
    align: "center",
    vAlign: "middle",
    opacity: 1,
    visible: true,
    locked: false,
    fill: { type: "solid", color: WHITE },
    stroke: null,
    shadow: null,
    autoFit: { enabled: true, minSize: 32 },
    uppercase: false,
    ...rest,
  } as TextLayer;
}

const doc: MergeDoc = {
  version: 1,
  name: "hamp9 mentor cards",
  canvas: { ...CANVAS, background: "#0A0002" },
  base: { src: "", fit: "cover" }, // filled in once the artwork is uploaded
  layers: [
    layer({
      id: "nickname",
      name: "nickname",
      text: "<nickname>",
      y: 769, // ink centres on 1176
      height: 1080,
      inkNudge: -78,
      width: 1700,
      font: inter(900, 600, 1.8),
      shadow: { color: "rgba(0,0,0,0.45)", blur: 40, offsetX: 0, offsetY: 12 },
      autoFit: { enabled: true, minSize: 180 },
    }),
    layer({
      id: "intania",
      name: "intania",
      // The department code is the one gold word on the line.
      text: "<intania_class> [[" + GOLD + "]]<intania_dept>[[/]]",
      y: 1546, // ink centres on 1675
      height: 266,
      width: 1800,
      font: inter(900, 148, 1.8),
      autoFit: { enabled: true, minSize: 70 },
    }),
    layer({
      id: "role",
      name: "role (in pill)",
      text: "<role>",
      y: PILL.y,
      height: PILL.h,
      width: PILL.w - 260,
      font: inter(700, 96, 1.0),
      fill: { type: "solid", color: PILL_INK },
      autoFit: { enabled: true, minSize: 30 },
    }),
    layer({
      id: "company",
      name: "company",
      text: "<company>",
      y: 2266, // ink centres on 2336
      height: 140,
      inkNudge: -10,
      width: 1900,
      font: inter(700, 96, 1.1),
      autoFit: { enabled: true, minSize: 40 },
    }),
  ],
};

// ── data ────────────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function buildData(csv: string): MergeData {
  const [header = [], ...body] = parseCsv(csv);
  const at = (cells: string[], name: string) => {
    const i = header.findIndex((h) => h.trim() === name);
    return i === -1 ? "" : (cells[i] ?? "").trim();
  };

  const rows: MergeRow[] = body.map((cells) => {
    const intania = at(cells, "Intania ภาค").replace(/\s+/g, " ").trim();
    const parts = intania.split(" ");
    // "Intania 90 NANO" → class "Intania 90", department "NANO".
    const dept = parts.length > 1 ? parts[parts.length - 1]! : "";
    const intaniaClass = parts.length > 1 ? parts.slice(0, -1).join(" ") : intania;

    return {
      no: at(cells, "No"),
      nickname: at(cells, "ชื่อเล่น (TH)"),
      name: at(cells, "ชื่อ-นามสกุล (TH)"),
      intania,
      intania_class: intaniaClass,
      intania_dept: dept,
      role: at(cells, "ตำแหน่งงานปัจจุบัน (ENG)"),
      company: at(cells, "บริษัทปัจจุบัน (ENG)"),
    };
  });

  return {
    fields: ["no", "nickname", "name", "intania", "intania_class", "intania_dept", "role", "company"],
    rows,
  };
}

// ── run ─────────────────────────────────────────────────────────────────────

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

const data = buildData(await Bun.file(CSV).text());
console.log(`  rows        ->  ${data.rows.length}`);

const form = new FormData();
form.append("file", new File([await Bun.file(IMAGE).arrayBuffer()], basename(IMAGE), { type: "image/png" }));
const asset = await json<{ ref: string }>(await fetch(`${API}/api/assets`, { method: "POST", body: form }), "asset upload");
doc.base = { src: asset.ref, fit: "cover" };
console.log(`  artwork     ->  ${asset.ref}`);

const project = await json<{ id: string }>(
  await fetch(`${API}/api/projects${PROJECT ? `/${PROJECT}` : ""}`, {
    method: PROJECT ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: doc.name, doc, data }),
  }),
  PROJECT ? "project update" : "project create",
);
console.log(`  project     ->  ${project.id}${PROJECT ? "  (updated in place)" : ""}`);

const share = await json<{ slug: string; protected: boolean }>(
  await fetch(`${API}/api/projects/${project.id}/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Updating an existing collection leaves whatever lock it already has.
    body: JSON.stringify(PROJECT ? {} : { password: PASSWORD }),
  }),
  "share",
);
console.log(`  share       ->  /mail-merge/s/${share.slug}${share.protected ? "  (locked)" : ""}`);
