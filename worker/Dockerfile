# Build context is the repository root — the worker imports the shared package.
#
# Debian trixie (the base of oven/bun:1-slim) packages almost the whole PDF
# toolchain at recent versions: MuPDF 1.25, qpdf 12, Ghostscript 10.05, libvips
# 8.16, libjxl 0.11, OpenJPEG 2.5, libheif 1.19. Only mozjpeg and libjxl's
# metric tools (ssimulacra2, butteraugli) are missing and are built here, in
# stages of their own so a code change never rebuilds them.
#
# This builds on the production Pi (4 cores, 8 GB shared with live services):
# compile parallelism is capped at 2, and libjxl is cloned without submodules
# and configured to build only what the two metric tools need. BuildKit runs
# independent stages concurrently, so with buildx build the two source stages
# one at a time (--target mozjpeg, then --target jxlmetrics) before the image.
# The Pi has no buildx; compose falls back to the classic builder, which is
# sequential already. Measured there: ~6 min cold, lowest MemAvailable 3.4 GB.

ARG MOZJPEG_VERSION=v4.1.5
# Matches the libjxl Debian ships, so the metrics score what cjxl encodes.
ARG LIBJXL_VERSION=v0.11.2

FROM oven/bun:1-slim AS toolbuild
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates pkg-config \
     libpng-dev zlib1g-dev libhwy-dev libbrotli-dev liblcms2-dev libjpeg-dev libgif-dev \
  && rm -rf /var/lib/apt/lists/*
ENV CMAKE_BUILD_PARALLEL_LEVEL=2

FROM toolbuild AS mozjpeg
ARG MOZJPEG_VERSION
RUN git clone --depth 1 --branch ${MOZJPEG_VERSION} https://github.com/mozilla/mozjpeg /src \
  && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DENABLE_SHARED=OFF -DPNG_SUPPORTED=ON \
     -DWITH_TURBOJPEG=OFF \
     -DCMAKE_INSTALL_PREFIX=/opt/mozjpeg \
  && cmake --build /build -j2 \
  && cmake --install /build

FROM toolbuild AS jxlmetrics
ARG LIBJXL_VERSION
# No submodules: highway, brotli and lcms2 come from Debian, and skcms, sjpeg,
# jpegli and the (large) test corpus are switched off.
RUN git clone --depth 1 --branch ${LIBJXL_VERSION} https://github.com/libjxl/libjxl /src \
  && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
     -DJPEGXL_ENABLE_DEVTOOLS=ON -DJPEGXL_ENABLE_TOOLS=ON -DJPEGXL_ENABLE_BENCHMARK=OFF \
     -DJPEGXL_ENABLE_EXAMPLES=OFF -DJPEGXL_ENABLE_MANPAGES=OFF -DJPEGXL_ENABLE_DOXYGEN=OFF \
     -DJPEGXL_ENABLE_JNI=OFF -DJPEGXL_ENABLE_SJPEG=OFF -DJPEGXL_ENABLE_OPENEXR=OFF \
     -DJPEGXL_ENABLE_PLUGINS=OFF -DJPEGXL_FORCE_SYSTEM_HWY=ON -DJPEGXL_FORCE_SYSTEM_BROTLI=ON \
     -DJPEGXL_FORCE_SYSTEM_LCMS2=ON -DJPEGXL_ENABLE_SKCMS=OFF -DJPEGXL_ENABLE_JPEGLI=OFF \
     -DJPEGXL_ENABLE_TRANSCODE_JPEG=OFF -DJPEGXL_ENABLE_VIEWERS=OFF -DJPEGXL_ENABLE_FUZZERS=OFF \
  && cmake --build /build -j2 --target ssimulacra2 butteraugli_main \
  && install -D /build/tools/ssimulacra2 /opt/jxl/bin/ssimulacra2 \
  && install -D /build/tools/butteraugli_main /opt/jxl/bin/butteraugli

FROM oven/bun:1-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY worker/package.json ./worker/
RUN bun install --frozen-lockfile --filter '@tools/worker' --filter '@tools/shared'

FROM oven/bun:1-slim AS runtime
WORKDIR /app

# The heif plugins are Recommends, so they are named: without them libheif
# (and vips through it) cannot decode HEIC or AVIF. The -dev-free runtime libs
# at the end are what the two source builds link against.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     mupdf-tools qpdf ghostscript libvips-tools libjxl-tools libopenjp2-tools \
     zopfli libdeflate-tools libheif-examples libheif-plugin-libde265 libheif-plugin-dav1d \
     util-linux ca-certificates curl \
     libpng16-16t64 libhwy1t64 libbrotli1 liblcms2-2 libjpeg62-turbo libgif7 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=mozjpeg /opt/mozjpeg /opt/mozjpeg
COPY --from=jxlmetrics /opt/jxl /opt/jxl
ARG LIBJXL_VERSION
# mozjpeg's cjpeg/jpegtran shadow nothing: libjpeg-turbo-progs is not installed.
# ssimulacra2 and butteraugli have no --version, so the tag they came from is written down.
RUN ln -s /opt/mozjpeg/bin/cjpeg /opt/mozjpeg/bin/jpegtran /opt/jxl/bin/ssimulacra2 /opt/jxl/bin/butteraugli /usr/local/bin/ \
  && echo "${LIBJXL_VERSION}" > /opt/jxl/VERSION

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY shared ./shared
COPY worker ./worker
# Bun links a workspace's own dependencies (pdf-lib) from worker/node_modules.
COPY --from=deps /app/worker/node_modules ./worker/node_modules

ENV NODE_ENV=production \
    WORKER_PORT=8788 \
    DATA_DIR=/data

RUN mkdir -p /data && chown -R bun:bun /app /data
VOLUME ["/data"]
USER bun
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:8788/health || exit 1

CMD ["bun", "run", "worker/src/index.ts"]
