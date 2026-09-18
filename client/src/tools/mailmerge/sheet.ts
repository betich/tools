import Papa from "papaparse";
import type { MergeData, MergeRow } from "@tools/shared";

/** Accepts csv, tsv and xlsx. The first row is always the header row. */
export async function parseSheet(file: File): Promise<MergeData> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseExcel(file);
  return parseDelimited(file);
}

function parseDelimited(file: File): Promise<MergeData> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const fields = (result.meta.fields ?? []).filter(Boolean);
        resolve(normalise(fields, result.data));
      },
      error: (error) => reject(new Error(error.message)),
    });
  });
}

async function parseExcel(file: File): Promise<MergeData> {
  // Loaded on demand — the xlsx reader is the heaviest thing on this page.
  const readXlsxFile = (await import("read-excel-file/browser")).default;
  // The library types a sheet as a tagged row collection; a plain matrix is all we need.
  const matrix = (await readXlsxFile(file)) as unknown as unknown[][];
  const [header = [], ...body] = matrix;
  const fields = header.map((cell) => String(cell ?? "").trim()).filter(Boolean);
  const rows = body.map((cells) => {
    const row: MergeRow = {};
    fields.forEach((field, i) => {
      row[field] = cells[i] == null ? "" : String(cells[i]);
    });
    return row;
  });
  return normalise(fields, rows);
}

function normalise(fields: string[], rows: MergeRow[]): MergeData {
  const clean = rows
    .map((row) => {
      const out: MergeRow = {};
      for (const field of fields) out[field] = String(row[field] ?? "").trim();
      return out;
    })
    .filter((row) => fields.some((f) => row[f]));
  return { fields, rows: clean };
}

/** A tiny starter sheet so the tool is usable before anyone has a file to hand. */
export const sampleData: MergeData = {
  fields: ["name", "role"],
  rows: [
    { name: "ada lovelace", role: "first programmer" },
    { name: "grace hopper", role: "compiler pioneer" },
    { name: "katherine johnson", role: "orbital mechanics" },
  ],
};
