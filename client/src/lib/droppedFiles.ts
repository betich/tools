/**
 * Every file in a drop, walking into dropped folders. `dataTransfer.files`
 * alone lists a folder as one empty file; the entry API sees inside it.
 * Each file found in a folder carries its path in `webkitRelativePath`
 * terms (`renders/frame-001.png`) so callers can sort by it.
 */
export async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(transfer.items)
    .map((item) => (item.kind === "file" ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0 || !entries.some((e) => e.isDirectory)) return Array.from(transfer.files);

  const out: File[] = [];
  await Promise.all(entries.map((entry) => walk(entry, out)));
  return out;
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    const path = entry.fullPath.replace(/^\//, "");
    // `webkitRelativePath` is read-only on File; a shadowing property is how a picked folder's files look too.
    Object.defineProperty(file, "webkitRelativePath", { value: path });
    out.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries hands back at most ~100 at a time; keep asking until it runs dry.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    await Promise.all(batch.map((e) => walk(e, out)));
  }
}
