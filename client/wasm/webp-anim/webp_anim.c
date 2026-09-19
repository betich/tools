/* A thin C API over libwebp's WebPAnimEncoder, for the GIF tab's animated
   WebP export. JS drives it one frame at a time:

     enc = webp_anim_new(w, h, loop, lossless, quality, method)
     webp_anim_add(enc, rgba, timestamp_ms)      once per frame
     size = webp_anim_finish(enc, end_ms)        end_ms = when the last frame stops showing
     bytes = HEAPU8.subarray(webp_anim_output(enc), + size)
     webp_anim_delete(enc)

   Errors come back as 0 / negative; webp_anim_error(enc) says why. */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten/emscripten.h>

#include "webp/encode.h"
#include "webp/mux.h"

typedef struct {
  WebPAnimEncoder* enc;
  WebPConfig config;
  WebPData out;
  int width;
  int height;
  int last_ts;
  int frames;
  const char* error;
} Anim;

EMSCRIPTEN_KEEPALIVE
Anim* webp_anim_new(int width, int height, int loop_count, int lossless, float quality, int method) {
  if (width <= 0 || height <= 0 || width > WEBP_MAX_DIMENSION || height > WEBP_MAX_DIMENSION) return NULL;
  Anim* a = (Anim*)calloc(1, sizeof(Anim));
  if (a == NULL) return NULL;
  a->width = width;
  a->height = height;
  a->last_ts = -1;
  WebPDataInit(&a->out);

  WebPAnimEncoderOptions opts;
  if (!WebPAnimEncoderOptionsInit(&opts)) goto fail;
  opts.anim_params.loop_count = loop_count < 0 ? 0 : loop_count; /* 0 = forever */
  opts.anim_params.bgcolor = 0x00000000;                          /* transparent */
  opts.allow_mixed = 0;
  opts.minimize_size = 0;

  if (!WebPConfigInit(&a->config)) goto fail;
  a->config.lossless = lossless ? 1 : 0;
  a->config.quality = quality < 0 ? 0 : quality > 100 ? 100 : quality;
  a->config.method = method < 0 ? 0 : method > 6 ? 6 : method;
  /* Keep RGB under see-through pixels free to change: smaller files, same picture. */
  a->config.exact = 0;
  if (!WebPValidateConfig(&a->config)) goto fail;

  a->enc = WebPAnimEncoderNew(width, height, &opts);
  if (a->enc == NULL) goto fail;
  return a;

fail:
  free(a);
  return NULL;
}

/* Adds one frame of straight RGBA (width * height * 4 bytes), shown from `timestamp_ms`. */
EMSCRIPTEN_KEEPALIVE
int webp_anim_add(Anim* a, const uint8_t* rgba, int timestamp_ms) {
  if (a == NULL || a->enc == NULL) return 0;
  if (timestamp_ms <= a->last_ts) {
    a->error = "Frame timestamps must increase.";
    return 0;
  }
  WebPPicture pic;
  if (!WebPPictureInit(&pic)) return 0;
  pic.use_argb = 1;
  pic.width = a->width;
  pic.height = a->height;
  int ok = WebPPictureImportRGBA(&pic, rgba, a->width * 4);
  if (ok) ok = WebPAnimEncoderAdd(a->enc, &pic, timestamp_ms, &a->config);
  if (!ok) a->error = WebPAnimEncoderGetError(a->enc);
  WebPPictureFree(&pic);
  if (ok) {
    a->last_ts = timestamp_ms;
    a->frames++;
  }
  return ok;
}

/* Closes the animation at `end_ms` (which gives the last frame its own
   duration, not an average) and assembles the file. Returns its size, or 0. */
EMSCRIPTEN_KEEPALIVE
int webp_anim_finish(Anim* a, int end_ms) {
  if (a == NULL || a->enc == NULL || a->frames == 0) return 0;
  if (end_ms <= a->last_ts) {
    a->error = "The animation must end after its last frame starts.";
    return 0;
  }
  if (!WebPAnimEncoderAdd(a->enc, NULL, end_ms, NULL) || !WebPAnimEncoderAssemble(a->enc, &a->out)) {
    a->error = WebPAnimEncoderGetError(a->enc);
    return 0;
  }
  return (int)a->out.size;
}

EMSCRIPTEN_KEEPALIVE
const uint8_t* webp_anim_output(Anim* a) { return a == NULL ? NULL : a->out.bytes; }

EMSCRIPTEN_KEEPALIVE
const char* webp_anim_error(Anim* a) {
  if (a == NULL) return "The encoder could not be created.";
  return a->error != NULL ? a->error : "";
}

EMSCRIPTEN_KEEPALIVE
void webp_anim_delete(Anim* a) {
  if (a == NULL) return;
  WebPDataClear(&a->out);
  if (a->enc != NULL) WebPAnimEncoderDelete(a->enc);
  free(a);
}
