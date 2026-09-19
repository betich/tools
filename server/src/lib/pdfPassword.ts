import { createCipheriv, createHash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";

/**
 * Checks a password against an encrypted PDF's standard security handler
 * without decrypting anything (#15). The API has no PDF tools of its own, and
 * `POST /jobs/:id/unlock` must answer "wrong password" at once — and count
 * the guess — rather than after a round trip through the worker's queue.
 *
 * Only the few objects the check needs are read: the trailer (for /Encrypt
 * and /ID) and the encryption dictionary. Both are found by searching the
 * file's tail and head, where writers put them, and the whole file only if
 * that fails. "unknown" means the file could not be read this way (a
 * public-key handler, a trailer we cannot find); the caller lets the worker
 * try instead, and a wrong password then shows up as the file still locked.
 *
 * Algorithms: ISO 32000-2 §7.6.4.3 — revisions 2–4 (RC4/MD5, user and owner
 * passwords), 5 (the AES-256 draft) and 6 (AES-256, hash algorithm 2.B).
 */

export type PasswordCheck = "ok" | "wrong" | "unknown";

// ── reading objects ────────────────────────────────────────────────────────

type Obj = number | boolean | null | Name | Ref | Buffer | Obj[] | Dict;
class Name {
  constructor(readonly name: string) {}
}
class Ref {
  constructor(
    readonly num: number,
    readonly gen: number,
  ) {}
}
class Dict {
  constructor(readonly entries: Map<string, Obj>) {}
  get(key: string): Obj | undefined {
    return this.entries.get(key);
  }
}

const WHITE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([...Buffer.from("()<>[]{}/%")]);
const regular = (c: number | undefined) => c !== undefined && !WHITE.has(c) && !DELIM.has(c);

/** A small PDF object parser: enough for a trailer and an encryption dictionary. */
class Lexer {
  constructor(
    private readonly b: Buffer,
    public pos: number,
  ) {}

  private skip(): void {
    for (;;) {
      const c = this.b[this.pos];
      if (c === undefined) return;
      if (WHITE.has(c)) this.pos++;
      else if (c === 0x25 /* % */) while (this.pos < this.b.length && this.b[this.pos] !== 0x0a && this.b[this.pos] !== 0x0d) this.pos++;
      else return;
    }
  }

  private word(): string {
    const start = this.pos;
    while (regular(this.b[this.pos])) this.pos++;
    return this.b.toString("latin1", start, this.pos);
  }

  value(depth = 0): Obj {
    if (depth > 32) throw new Error("too deep");
    this.skip();
    const c = this.b[this.pos];
    if (c === undefined) throw new Error("end of data");
    if (c === 0x2f /* / */) {
      this.pos++;
      return new Name(this.word().replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
    }
    if (c === 0x28 /* ( */) return this.literal();
    if (c === 0x3c /* < */) {
      if (this.b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        const entries = new Map<string, Obj>();
        for (;;) {
          this.skip();
          if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) {
            this.pos += 2;
            return new Dict(entries);
          }
          const key = this.value(depth + 1);
          if (!(key instanceof Name)) throw new Error("dictionary key is not a name");
          entries.set(key.name, this.value(depth + 1));
        }
      }
      return this.hex();
    }
    if (c === 0x5b /* [ */) {
      this.pos++;
      const items: Obj[] = [];
      for (;;) {
        this.skip();
        if (this.b[this.pos] === 0x5d) {
          this.pos++;
          return items;
        }
        items.push(this.value(depth + 1));
      }
    }
    const w = this.word();
    if (!w) throw new Error(`unexpected byte ${c}`);
    if (w === "true" || w === "false") return w === "true";
    if (w === "null") return null;
    const n = Number(w);
    if (Number.isNaN(n)) throw new Error(`unexpected token ${w}`);
    // `12 0 R` — look ahead without consuming unless it is a reference.
    if (/^\d+$/.test(w)) {
      const save = this.pos;
      this.skip();
      const gen = this.word();
      if (/^\d+$/.test(gen)) {
        this.skip();
        if (this.word() === "R") return new Ref(n, Number(gen));
      }
      this.pos = save;
    }
    return n;
  }

  private literal(): Buffer {
    const out: number[] = [];
    let depth = 0;
    this.pos++;
    for (;;) {
      const c = this.b[this.pos++];
      if (c === undefined) throw new Error("unterminated string");
      if (c === 0x29 /* ) */) {
        if (depth-- === 0) return Buffer.from(out);
        out.push(c);
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x5c /* \ */) {
        const e = this.b[this.pos++];
        if (e === undefined) throw new Error("unterminated string");
        const simple: Record<number, number> = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };
        if (e in simple) out.push(simple[e]!);
        else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30;
          for (let i = 0; i < 2 && this.b[this.pos]! >= 0x30 && this.b[this.pos]! <= 0x37; i++) v = v * 8 + this.b[this.pos++]! - 0x30;
          out.push(v & 0xff);
        } else if (e === 0x0d) {
          if (this.b[this.pos] === 0x0a) this.pos++; // line continuation
        } else if (e !== 0x0a) out.push(e);
      } else out.push(c);
    }
  }

  private hex(): Buffer {
    this.pos++;
    let digits = "";
    for (;;) {
      const c = this.b[this.pos++];
      if (c === undefined) throw new Error("unterminated hex string");
      if (c === 0x3e) break;
      if (!WHITE.has(c)) digits += String.fromCharCode(c);
    }
    if (!/^[0-9a-fA-F]*$/.test(digits)) throw new Error("bad hex string");
    return Buffer.from(digits.length % 2 ? `${digits}0` : digits, "hex");
  }
}

const WINDOW = 1024 * 1024;
const SCAN_CHUNK = 8 * 1024 * 1024;

async function readAt(fh: FileHandle, pos: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, pos);
  return buf.subarray(0, bytesRead);
}

/** The value after the last `key` in `b` (e.g. `/Encrypt`), skipping longer names like `/EncryptMetadata`. */
function lastKeyValue(b: Buffer, key: string): Obj | undefined {
  for (let at = b.lastIndexOf(key); at >= 0; at = at > 0 ? b.lastIndexOf(key, at - 1) : -1) {
    if (regular(b[at + key.length])) continue;
    try {
      return new Lexer(b, at + key.length).value();
    } catch {
      // a torn value at the edge of the window — try an earlier one
    }
  }
  return undefined;
}

/** The dictionary of object `num gen`, found in `b` (the last definition wins, as in an incremental update). */
function objectIn(b: Buffer, ref: Ref): Dict | undefined {
  const re = new RegExp(`(?:^|[^0-9])${ref.num}\\s+${ref.gen}\\s+obj\\b`, "g");
  const text = b.toString("latin1");
  let found: Dict | undefined;
  for (const m of text.matchAll(re)) {
    try {
      const v = new Lexer(b, m.index! + m[0].length).value();
      if (v instanceof Dict) found = v;
    } catch {
      // not the object after all
    }
  }
  return found;
}

type Security = { encrypt: Dict; id0: Buffer };

async function readSecurity(path: string): Promise<Security | "plain" | null> {
  const fh = await open(path, "r");
  try {
    const size = (await fh.stat()).size;
    const tail = await readAt(fh, Math.max(0, size - WINDOW), Math.min(size, WINDOW));
    const head = size > WINDOW ? await readAt(fh, 0, Math.min(WINDOW, size - WINDOW)) : Buffer.alloc(0);
    const windows = [tail, head];

    let encrypt: Obj | undefined;
    let ids: Obj | undefined;
    for (const w of windows) encrypt ??= lastKeyValue(w, "/Encrypt");
    for (const w of windows) ids ??= lastKeyValue(w, "/ID");
    if (encrypt === undefined) return "plain";
    const id0 = Array.isArray(ids) && Buffer.isBuffer(ids[0]) ? ids[0] : Buffer.alloc(0);

    if (encrypt instanceof Ref) {
      let dict: Dict | undefined;
      for (const w of windows) dict ??= objectIn(w, encrypt);
      // Not near either end: scan the whole file, overlapping chunks so an object cannot straddle a seam.
      for (let pos = 0; !dict && pos < size; pos += SCAN_CHUNK - 4096) {
        dict = objectIn(await readAt(fh, pos, SCAN_CHUNK), encrypt);
      }
      encrypt = dict;
    }
    return encrypt instanceof Dict ? { encrypt, id0 } : null;
  } finally {
    await fh.close();
  }
}

// ── the standard security handler ──────────────────────────────────────────

const PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");

const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();
const sha = (alg: string, ...parts: Buffer[]) => createHash(alg).update(Buffer.concat(parts)).digest();

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

/** Revisions 2–4 take the password in PDFDocEncoding; Latin-1 covers what people type there. */
function padded(password: string): Buffer {
  const bytes = Buffer.from([...password].map((ch) => ch.charCodeAt(0) & 0xff));
  return Buffer.concat([bytes.subarray(0, 32), PAD]).subarray(0, 32);
}

type Params = { r: number; o: Buffer; u: Buffer; p: number; n: number; id0: Buffer; encryptMetadata: boolean };

/** Algorithm 2: the file key from a (padded) user password. */
function fileKey(pw32: Buffer, k: Params): Buffer {
  const p = Buffer.alloc(4);
  p.writeInt32LE(k.p | 0);
  const extra = k.r >= 4 && !k.encryptMetadata ? [Buffer.from([0xff, 0xff, 0xff, 0xff])] : [];
  let h = md5(pw32, k.o.subarray(0, 32), p, k.id0, ...extra);
  if (k.r >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, k.n));
  return h.subarray(0, k.n);
}

/** Algorithms 4–6: whether `pw32` is the user password. */
function isUser(pw32: Buffer, k: Params): boolean {
  const key = fileKey(pw32, k);
  if (k.r === 2) return rc4(key, PAD).equals(k.u.subarray(0, 32));
  let x = rc4(key, md5(PAD, k.id0));
  for (let i = 1; i <= 19; i++) x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
  return x.equals(k.u.subarray(0, 16));
}

/** Algorithm 7: the owner password decrypts /O to the user password. */
function isOwner(password: string, k: Params): boolean {
  let h = md5(padded(password));
  if (k.r >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  const key = h.subarray(0, k.n);
  let user = k.o.subarray(0, 32);
  if (k.r === 2) user = rc4(key, user);
  else for (let i = 19; i >= 0; i--) user = rc4(Buffer.from(key.map((b) => b ^ i)), user);
  return isUser(user, k);
}

/** Algorithm 2.B (revision 6): SHA-256/384/512 rounds over AES-128-CBC. */
function hash6(pw: Buffer, salt: Buffer, udata: Buffer): Buffer {
  let k = sha("sha256", pw, salt, udata);
  for (let round = 0; ; ) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([pw, k, udata])));
    const cipher = createCipheriv("aes-128-cbc", k.subarray(0, 16), k.subarray(16, 32)).setAutoPadding(false);
    const e = Buffer.concat([cipher.update(k1), cipher.final()]);
    let mod = 0;
    for (let i = 0; i < 16; i++) mod += e[i]!;
    k = sha(["sha256", "sha384", "sha512"][mod % 3]!, e);
    round++;
    if (round >= 64 && e[e.length - 1]! <= round - 32) break;
  }
  return k.subarray(0, 32);
}

function check56(password: string, r: number, o: Buffer, u: Buffer): boolean {
  // SASLprep is skipped; NFKC covers the common case of composed vs decomposed accents.
  const pw = Buffer.from(password.normalize("NFKC"), "utf8").subarray(0, 127);
  const h = (salt: Buffer, udata: Buffer) => (r === 5 ? sha("sha256", pw, salt, udata) : hash6(pw, salt, udata));
  if (h(u.subarray(32, 40), Buffer.alloc(0)).equals(u.subarray(0, 32))) return true;
  return h(o.subarray(32, 40), u.subarray(0, 48)).equals(o.subarray(0, 32));
}

/** Whether `password` (user or owner) opens the PDF at `path`. */
export async function checkPdfPassword(path: string, password: string): Promise<PasswordCheck> {
  let sec: Awaited<ReturnType<typeof readSecurity>>;
  try {
    sec = await readSecurity(path);
  } catch {
    return "unknown";
  }
  if (!sec || sec === "plain") return "unknown";
  const d = sec.encrypt;
  const filter = d.get("Filter");
  const r = d.get("R");
  const o = d.get("O");
  const u = d.get("U");
  if (!(filter instanceof Name) || filter.name !== "Standard") return "unknown";
  if (typeof r !== "number" || !Buffer.isBuffer(o) || !Buffer.isBuffer(u)) return "unknown";

  if (r === 5 || r === 6) {
    if (o.length < 48 || u.length < 48) return "unknown";
    return check56(password, r, o, u) ? "ok" : "wrong";
  }
  if (r < 2 || r > 4 || o.length < 32 || u.length < 32) return "unknown";
  const v = d.get("V");
  const bits = d.get("Length");
  const p = d.get("P");
  const n = r === 2 ? 5 : typeof bits === "number" ? Math.min(16, Math.max(5, bits / 8)) : v === 4 ? 16 : 5;
  const k: Params = {
    r,
    o,
    u,
    p: typeof p === "number" ? p : 0,
    n,
    id0: sec.id0,
    encryptMetadata: d.get("EncryptMetadata") !== false,
  };
  return isUser(padded(password), k) || isOwner(password, k) ? "ok" : "wrong";
}
