# Build context is the repository root — the worker imports the shared package.
#
# Debian trixie (the base of oven/bun:1-slim) packages almost the whole PDF
# toolchain at recent versions: MuPDF 1.25, qpdf 12, Ghostscript 10.05, libvips
# 8.16, libjxl 0.11, OpenJPEG 2.5, libheif 1.19. Only mozjpeg and libjxl's
# metric tools (ssimulacra2, butteraugli) are missing and are built here, in
# stages of their own so a code change never rebuilds them.

ARG MOZJPEG_VERSION=v4.1.5
# Matches the libjxl Debian ships, so the metrics score what cjxl encodes.
ARG LIBJXL_VERSION=v0.11.2

FROM oven/bun:1-slim AS toolbuild
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates pkg-config \
     libpng-dev zlib1g-dev libhwy-dev libbrotli-dev liblcms2-dev libjpeg-dev libgif-dev \
  && rm -rf /var/lib/apt/lists/*

FROM toolbuild AS mozjpeg
ARG MOZJPEG_VERSION
RUN git clone --depth 1 --branch ${MOZJPEG_VERSION} https://github.com/mozilla/mozjpeg /src \
  && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DENABLE_SHARED=OFF -DPNG_SUPPORTED=ON \
     -DCMAKE_INSTALL_PREFIX=/opt/mozjpeg \
  && cmake --build /build -j3 \
  && cmake --install /build

FROM toolbuild AS jxlmetrics
ARG LIBJXL_VERSION
RUN git clone --depth 1 --branch ${LIBJXL_VERSION} --recurse-submodules --shallow-submodules \
     https://github.com/libjxl/libjxl /src \
  && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
     -DJPEGXL_ENABLE_DEVTOOLS=ON -DJPEGXL_ENABLE_TOOLS=ON -DJPEGXL_ENABLE_BENCHMARK=OFF \
     -DJPEGXL_ENABLE_EXAMPLES=OFF -DJPEGXL_ENABLE_MANPAGES=OFF -DJPEGXL_ENABLE_DOXYGEN=OFF \
     -DJPEGXL_ENABLE_JNI=OFF -DJPEGXL_ENABLE_SJPEG=OFF -DJPEGXL_ENABLE_OPENEXR=OFF \
     -DJPEGXL_ENABLE_PLUGINS=OFF -DJPEGXL_FORCE_SYSTEM_HWY=ON -DJPEGXL_FORCE_SYSTEM_BROTLI=ON \
     -DJPEGXL_FORCE_SYSTEM_LCMS2=ON \
  && cmake --build /build -j3 --target ssimulacra2 butteraugli_main \
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
# mozjpeg's cjpeg/jpegtran shadow nothing: libjpeg-turbo-progs is not installed.
RUN ln -s /opt/mozjpeg/bin/cjpeg /opt/mozjpeg/bin/jpegtran /opt/jxl/bin/ssimulacra2 /opt/jxl/bin/butteraugli /usr/local/bin/

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY shared ./shared
COPY worker ./worker

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
