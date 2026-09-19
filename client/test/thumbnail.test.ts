import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { pdfPageCount, pdfPageThumb, pdfThumbnail } from "../src/tools/pdfmerge/thumbnail";

/**
 * The client side of the thumbnail lane's contract (#17, #37), against a fake
 * API: 200 is the answer, 202 and a busy 503 mean wait, anything else is none —
 * and for a count, says why and whether to ask again.
 * The page grid's tiles wait on one poller per batch, not one each.
 */

type Route = (path: string, hit: number) => Response;
let route: Route;
let hits: string[] = [];
const realFetch = globalThis.fetch;

const png = () =>
  new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
const wait = (s = 0.25) => Response.json({ retryAfter: s }, { status: 202 });
const refused = (status: number, body: object = { error: "no" }) => Response.json(body, { status });
const pathOf = (input: unknown) => new URL(String(input), "http://x").pathname;

beforeEach(() => {
  hits = [];
  globalThis.fetch = (async (input: unknown) => {
    const path = pathOf(input);
    hits.push(path);
    return route(path, hits.filter((h) => h === path).length);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

let n = 0;
const fresh = () => `up_${(++n).toString(16).padStart(16, "0")}`;
const signal = () => new AbortController().signal;

describe("pdfPageCount", () => {
  test("waits through 202s, then keeps the count", async () => {
    const id = fresh();
    route = (_p, hit) => (hit < 3 ? wait() : Response.json({ pages: 12 }));
    expect(await pdfPageCount(id, signal())).toEqual({ state: "counted", pages: 12 });
    expect(hits.length).toBe(3);
    expect(await pdfPageCount(id, signal())).toEqual({ state: "counted", pages: 12 });
    expect(hits.length).toBe(3);
  });

  test("a locked or broken PDF is refused, with the server's sentence as it was sent", async () => {
    route = () => refused(422, { error: "this PDF is password-protected" });
    expect(await pdfPageCount(fresh(), signal())).toEqual({ state: "refused", reason: "this PDF is password-protected" });
    route = () => refused(422, {});
    expect(await pdfPageCount(fresh(), signal())).toMatchObject({ state: "refused" });
  });

  test("an offline worker, a dropped connection or a bad answer is only for now, and is asked again", async () => {
    const id = fresh();
    route = () => refused(503, { error: "The PDF worker is offline — try again shortly." });
    expect(await pdfPageCount(id, signal())).toEqual({
      state: "unavailable",
      reason: "The PDF worker is offline — try again shortly.",
    });
    route = () => Response.json({ pages: 0 });
    expect(await pdfPageCount(id, signal())).toEqual({ state: "unavailable", reason: null });
    route = () => {
      throw new TypeError("network");
    };
    expect(await pdfPageCount(id, signal())).toEqual({ state: "unavailable", reason: null });
    route = () => Response.json({ pages: 4 });
    expect(await pdfPageCount(id, signal())).toEqual({ state: "counted", pages: 4 });
  });

  test("a busy 503 says to wait, and is waited for", async () => {
    route = (_p, hit) => (hit === 1 ? refused(503, { error: "busy", retryAfter: 0.25 }) : Response.json({ pages: 3 }));
    expect(await pdfPageCount(fresh(), signal())).toEqual({ state: "counted", pages: 3 });
  });
});

describe("pdfPageThumb", () => {
  test("asks for its own page and keeps it", async () => {
    const id = fresh();
    route = (p) => (p.endsWith("/pages/5.png") ? png() : refused(404));
    const href = await pdfPageThumb(id, 5, signal());
    expect(href).toStartWith("blob:");
    expect(await pdfPageThumb(id, 5, signal())).toBe(href);
    expect(hits).toEqual([`/api/pdf/uploads/${id}/pages/5.png`]);
  });

  test("tiles of one batch share one poller while it is drawn", async () => {
    const id = fresh();
    let drawn = false;
    route = (p, hit) => {
      if (p.endsWith("/pages/1.png") && hit >= 3) drawn = true;
      return drawn ? png() : wait();
    };
    const pages = Array.from({ length: 10 }, (_, i) => i + 1);
    const got = await Promise.all(pages.map((p) => pdfPageThumb(id, p, signal())));
    expect(got.every((h) => h?.startsWith("blob:"))).toBe(true);
    // One ask each, a couple of polls by one tile, then one more ask each for the rest.
    expect(hits.length).toBeLessThanOrEqual(10 + 3 + 9);
  });

  test("a page that could not be drawn is null", async () => {
    route = () => refused(422);
    expect(await pdfPageThumb(fresh(), 1, signal())).toBeNull();
  });

  test("an abandoned tile stops waiting", async () => {
    route = () => wait(1);
    const ctrl = new AbortController();
    const pending = pdfPageThumb(fresh(), 2, ctrl.signal);
    setTimeout(() => ctrl.abort(), 20);
    expect(await pending).toBeNull();
  });
});

describe("pdfThumbnail", () => {
  test("still polls the first-page route", async () => {
    const id = fresh();
    route = (_p, hit) => (hit === 1 ? wait() : png());
    expect(await pdfThumbnail(id, signal())).toStartWith("blob:");
    expect(hits.every((h) => h === `/api/pdf/uploads/${id}/thumbnail.png`)).toBe(true);
  });
});
