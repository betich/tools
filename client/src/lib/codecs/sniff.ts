const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

/** True when the bytes open with an ISO-BMFF `ftyp` box naming a HEIF brand. MIME types lie; bytes don't. */
export function isHeif(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const b = new Uint8Array(buffer, 0, 12);
  const ascii = (from: number) => String.fromCharCode(b[from]!, b[from + 1]!, b[from + 2]!, b[from + 3]!);
  return ascii(4) === "ftyp" && HEIF_BRANDS.has(ascii(8));
}
