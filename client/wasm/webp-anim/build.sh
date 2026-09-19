#!/usr/bin/env bash
# Builds client/src/vendor/webp-anim/webp_anim.{js,wasm}: libwebp's
# WebPAnimEncoder behind the thin C API in webp_anim.c, as an ES-module wasm.
#
#   BUILD_DIR=/somewhere/big client/wasm/webp-anim/build.sh
#
# Everything it downloads (emsdk, its toolchain, libwebp, the emscripten
# cache) lives under BUILD_DIR, which can be deleted afterwards. JOBS sets
# how many compilers run at once (default 2).
set -euo pipefail

LIBWEBP_TAG=v1.6.0
LIBWEBP_COMMIT=4fa21912338357f89e4fd51cf2368325b59e9bd9
EMSDK_VERSION=6.0.9

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$HERE/../.." && pwd)/src/vendor/webp-anim"
BUILD_DIR="${BUILD_DIR:-$HERE/.build}"
JOBS="${JOBS:-2}"

mkdir -p "$BUILD_DIR/tmp" "$BUILD_DIR/cache" "$BUILD_DIR/obj" "$OUT"
BUILD_DIR="$(cd "$BUILD_DIR" && pwd)"
export TMPDIR="$BUILD_DIR/tmp" XDG_CACHE_HOME="$BUILD_DIR/cache"

# ── toolchain ────────────────────────────────────────────────────────────────
if [ ! -d "$BUILD_DIR/emsdk" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$BUILD_DIR/emsdk"
fi
"$BUILD_DIR/emsdk/emsdk" install "$EMSDK_VERSION"
"$BUILD_DIR/emsdk/emsdk" activate "$EMSDK_VERSION" >/dev/null
# shellcheck disable=SC1091
EMSDK_QUIET=1 source "$BUILD_DIR/emsdk/emsdk_env.sh"
# After emsdk_env, which would point it back into the toolchain.
export EM_CACHE="$BUILD_DIR/cache/emscripten"

# ── libwebp ──────────────────────────────────────────────────────────────────
SRC="$BUILD_DIR/libwebp"
if [ ! -d "$SRC" ]; then
  git clone --depth 1 --branch "$LIBWEBP_TAG" https://chromium.googlesource.com/webm/libwebp "$SRC"
fi
if [ "$(git -C "$SRC" rev-parse HEAD)" != "$LIBWEBP_COMMIT" ]; then
  echo "libwebp $LIBWEBP_TAG is not at $LIBWEBP_COMMIT — refusing to build." >&2
  exit 1
fi

# The encoder, the muxer (WebPAnimEncoder lives there), sharpyuv, and the
# decoder, which the anim encoder uses to compare candidate sub-frames.
# SIMD as libwebp's own CMake does it for Emscripten: SSE2/SSE4.1 intrinsics on wasm simd128.
CFLAGS=(-O3 -flto -msimd128 -msse4.1 -DEMSCRIPTEN -DNDEBUG -I"$SRC" -I"$SRC/src")

export SRC BUILD_DIR
export CFLAGS_STR="${CFLAGS[*]}"

mapfile -t SOURCES < <(ls "$SRC"/src/{enc,dec,dsp,utils,mux}/*.c "$SRC"/sharpyuv/*.c)
mapfile -t OBJECTS < <(printf '%s\n' "${SOURCES[@]}" | xargs -P "$JOBS" -I{} bash -c '
  set -e; src="$1"; obj="$BUILD_DIR/obj/$(echo "${src#"$SRC"/}" | tr / _).o"
  [ "$obj" -nt "$src" ] || emcc $CFLAGS_STR -c "$src" -o "$obj"
  echo "$obj"' _ {})

# ── link ─────────────────────────────────────────────────────────────────────
EXPORTS='["_malloc","_free","_webp_anim_new","_webp_anim_add","_webp_anim_finish","_webp_anim_output","_webp_anim_error","_webp_anim_delete"]'
emcc "${CFLAGS[@]}" "$HERE/webp_anim.c" "${OBJECTS[@]}" \
  -o "$OUT/webp_anim.js" \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=webpAnim \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=4GB \
  -s FILESYSTEM=0 -s DYNAMIC_EXECUTION=0 \
  -s EXPORTED_FUNCTIONS="$EXPORTS" \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","UTF8ToString"]' \
  -s INCOMING_MODULE_JS_API='["wasmBinary","locateFile"]'

{
  echo "libwebp $LIBWEBP_TAG ($LIBWEBP_COMMIT)"
  echo "emsdk $EMSDK_VERSION"
  echo "built by client/wasm/webp-anim/build.sh"
} >"$OUT/VERSION"
ls -l "$OUT"
