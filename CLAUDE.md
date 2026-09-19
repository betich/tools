# betich's tools — working notes

## Shape

Bun workspace: `shared/`, `client/`, `server/`. `@tools/shared` is consumed as TypeScript source, never built.

**`shared/src/render.ts` is load-bearing.** It is the single Canvas2D renderer used by the browser preview *and* the server's `@napi-rs/canvas` batch render, typed structurally (`Ctx2D`) so both satisfy it. Any change to text layout, fills, strokes, shadows, tracking or the `[[#RRGGBB]]…[[/]]` colour spans must keep both paths identical. Verify by rendering the same row in both and diffing.

## Rules that are easy to break

- **Undo snapshots happen on gesture start,** not per frame. Sliders take `onCommitStart`; the canvas stage snapshots on pointer-down. `previewLayer` writes through without history; `updateLayer` commits.
- **Letter spacing is applied by hand** in the renderer, not via `ctx.letterSpacing`, which is unevenly supported and would desync preview from export.
- **Filenames keep Unicode.** `fileNameFor` slugs on `\p{L}\p{N}\p{M}` — stripping to `[a-z0-9]` erases Thai entirely and every file becomes `row-001`.
- **Asset URLs must be absolute** (`assetUrl()` in `client/src/lib/api.ts`). Client and API are different origins in production.
- **The server is optional.** Every feature that needs it degrades with a message; nothing throws. `useServerStatus` drives the top-bar dot.
- **Every costly route carries a guard** from `server/src/lib/limits.ts`: a `rateLimit` hook, `withRenderSlot` for anything that draws, `diskHasRoom` before anything that writes, `docProblem` before a doc is rendered. Callers are keyed on `cf-connecting-ip`. Refusals are 413/429/503/507 with a sentence the client shows as-is (`refusal()` in `api.ts`). The renderer never fetches remote URLs.
- **Font faces used by a doc must be registered before rendering.** `prepareFonts` walks `font.source` *and* `font.fallbacks` — Thai text needs the fallback registered or it renders as boxes.

## Design

`DESIGN.md` is authoritative and is derived from the shipped result. The world follows track.betich.me. Two things break the look fastest: introducing a second hue (there is no status colour — disabled is opacity), and putting a shadow on something that is in the document flow. Chrome is uppercase with tracking; prose is sentence case in Inter; values the user typed drop to normal tracking.

## Infrastructure

- Client: Cloudflare Pages project `betich-tools` → `tools.betich.me`.
- API: Docker Compose + a dedicated `tools` tunnel → `tools-api.betich.me`.
- **Not** `api.tools.betich.me` — Cloudflare universal SSL covers only one subdomain level and the handshake fails.
- The tunnel container runs as root so the mounted credentials can stay `0600` on the host.
- `deploy/tunnel-credentials.json` is gitignored.

## Commands

```bash
bun run dev          # client :5173 + server :8787
bun run typecheck    # all packages
docker compose up -d --build
```
