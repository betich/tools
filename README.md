# betich's tools

A small workshop kept in public — **https://tools.betich.me**

Two tools so far, both of which do their real work in the browser:

- **squoosh** — compress and convert images. The webp, avif, jpeg and png encoders run as wasm in a worker pool; nothing is uploaded.
- **mail merge** — a base image, text layers, and a spreadsheet. One image comes out per row, with Google Fonts or an uploaded face, gradients, strokes, drop shadows and inline colour spans.

The server is optional. It adds saving, share links, a font catalogue and batch rendering; with it down, both tools still work and the status dot in the top bar says so.

## Layout

```
shared/    the document model, the merge engine, and the canvas renderer
client/    react + vite + tailwind v4, deployed to cloudflare pages
server/    bun + elysia + sqlite, behind a cloudflare tunnel
```

`shared/src/render.ts` is the heart of it: one Canvas2D renderer, typed structurally so the identical code runs against the browser's `CanvasRenderingContext2D` and the server's `@napi-rs/canvas`. The preview and the exported file cannot drift, because they are produced by the same function.

## Running it

```bash
bun install
bun run dev            # client on :5173, server on :8787
```

The client proxies `/api` to the server in dev. In production they are separate origins and talk over CORS.

```bash
bun run typecheck      # all three packages
bun run build          # client bundle
```

## Deploying

**Client** → Cloudflare Pages, project `betich-tools`, custom domain `tools.betich.me`.

```bash
cd client && bun run deploy
```

`client/.env.production` points the bundle at the API. Note that Cloudflare's universal SSL only covers one level of subdomain, which is why the API is `tools-api.betich.me` and not `api.tools.betich.me`.

**Server** → Docker Compose on the box, reached through its own Cloudflare Tunnel.

```bash
cp .env.example .env
docker compose up -d --build
```

The tunnel is dedicated to this stack (`deploy/tunnel.yml` + `deploy/tunnel-credentials.json`, created once with `cloudflared tunnel create tools`) so restarting it never disturbs anything else sharing the machine. SQLite, uploaded assets and cached font files live in the `tools-data` volume.

`GOOGLE_FONTS_API_KEY` is optional: without it the font picker falls back to a curated list, and the server still resolves any family it is asked for through the keyless CSS2 endpoint.

## API

| route | |
| --- | --- |
| `GET /api/health` | liveness, plus the project count |
| `GET /api/tools` | the tool registry the launchpad reads |
| `GET /api/fonts` | Google Fonts catalogue, cached |
| `GET /api/fonts/:family/:variant` | TTF proxy |
| `POST /api/assets` | upload a base image or a font face |
| `GET|POST|PUT|DELETE /api/projects[/:id]` | saved merges |
| `POST /api/projects/:id/share` | mint or lock a share link |
| `GET /api/share/:slug` | open a shared merge (`x-share-password` if locked) |
| `POST /api/render` | render one row to PNG |
| `POST /api/render/batch` | render every row, returns a ZIP |

Interactive docs at `/api/docs`.

## Seeding a collection

`server/scripts/seed-mentor-cards.ts` builds a real merge end to end — parsing a CSV, deriving fields, uploading the artwork, creating the project and locking a share link. It is worth reading as the worked example of the document model.

```bash
bun run scripts/seed-mentor-cards.ts --api https://tools-api.betich.me --password <password>
```

## Design

See [DESIGN.md](DESIGN.md). The visual world follows [track.betich.me](https://track.betich.me): a near-black indigo ground, lavender ink at four alpha steps, uppercase tracked Roboto Mono, hairlines instead of shadows, and one bloom of light.

---

made with <3 by [betich.me](https://betich.me)
