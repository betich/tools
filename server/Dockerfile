# Build context is the repository root — the server imports the shared package.
FROM oven/bun:1-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN bun install --frozen-lockfile --filter '@tools/server' --filter '@tools/shared'

FROM oven/bun:1-slim AS runtime
WORKDIR /app

# @napi-rs/canvas needs fontconfig, and a base font family so a doc that asks
# for something we cannot fetch still renders legible text.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY package.json bun.lock ./
COPY shared ./shared
COPY server ./server

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data

# Repo files arrive with the host's restrictive modes; hand them to the run user.
RUN mkdir -p /data && chown -R bun:bun /app /data
VOLUME ["/data"]
USER bun
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:8787/health || exit 1

CMD ["bun", "run", "server/src/index.ts"]
