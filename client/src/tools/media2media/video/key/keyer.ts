/* ───────────────────────────────────────────────────────────────────────────
   The keyer: one WebGL shader, handed out as a `FrameHook`. The preview, the
   WebM export and the PNG sequence all draw through the same program with
   the same uniforms, so what the checkerboard shows is what the file holds.

   Usage (any tab):
     const keyer = createKeyer();          // one GL context; dispose() it
     const hook = keyer.hookFor(settings); // a FrameHook for those settings

   What the hook returns depends on `info.purpose`:
   - "preview": the keyer's canvas (reused by the next call; draw it now).
   - "export":  a new RGBA `VideoFrame` read back from the GPU, straight
     alpha, stamped at `info.time`. The caller owns it and must close it —
     the export does, by wrapping it in a VideoSample. Read-back pixels,
     not a canvas, because a VideoFrame made from a GPU canvas may carry no
     pixel format, and Mediabunny's alpha splitter needs one.
   ─────────────────────────────────────────────────────────────────────────── */

import type { FrameHook, FrameInfo } from "../frameHook";
import { keyUniforms, type KeySettings, type KeyUniforms } from "./settings";
import { FRAGMENT, VERTEX } from "./shader";

export type Keyer = {
  /** A frame hook for these settings. Hooks from one keyer share its context; call one at a time. */
  hookFor: (settings: KeySettings) => FrameHook;
  /** Key one frame and read it back: straight RGBA, top row first, `width × height × 4` bytes. */
  pixels: (frame: CanvasImageSource, width: number, height: number, settings: KeySettings) => Uint8Array;
  dispose: () => void;
};

export class KeyerError extends Error {}

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

const CONTEXT: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: false,
  preserveDrawingBuffer: true,
  antialias: false,
  depth: false,
  stencil: false,
};

function makeCanvas(): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(1, 1);
  return document.createElement("canvas");
}

function getGL(canvas: AnyCanvas): GL | null {
  const c = canvas as HTMLCanvasElement;
  return (
    (c.getContext("webgl2", CONTEXT) as WebGL2RenderingContext | null) ??
    (c.getContext("webgl", CONTEXT) as WebGLRenderingContext | null)
  );
}

let webglAnswer: boolean | null = null;
/** Whether this browser can run the keyer at all. Asked once. */
export function webglAvailable(): boolean {
  if (webglAnswer !== null) return webglAnswer;
  try {
    const c = makeCanvas();
    const gl = getGL(c);
    webglAnswer = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglAnswer = false;
  }
  return webglAnswer;
}

export function createKeyer(): Keyer {
  let canvas: AnyCanvas | null = null;
  let state: ReturnType<typeof setup> | null = null;

  const ready = () => {
    if (state && !state.gl.isContextLost()) return state;
    canvas = makeCanvas();
    const gl = getGL(canvas);
    if (!gl) throw new KeyerError("This browser can't run WebGL, which the key needs to draw.");
    state = setup(gl);
    return state;
  };

  const draw = (frame: CanvasImageSource, width: number, height: number, settings: KeySettings, flip: boolean) => {
    const s = ready();
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (canvas!.width !== w) canvas!.width = w;
    if (canvas!.height !== h) canvas!.height = h;
    render(s, frame, w, h, keyUniforms(settings), flip);
    return { s, w, h };
  };

  const pixels: Keyer["pixels"] = (frame, width, height, settings) => {
    const { s, w, h } = draw(frame, width, height, settings, true);
    const out = new Uint8Array(w * h * 4);
    s.gl.readPixels(0, 0, w, h, s.gl.RGBA, s.gl.UNSIGNED_BYTE, out);
    return out;
  };

  const hookFor = (settings: KeySettings): FrameHook => {
    // Snapshot: a hook keeps meaning the settings it was made for.
    const fixed = { ...settings };
    return (frame: CanvasImageSource, info: FrameInfo) => {
      if (info.purpose === "preview") {
        draw(frame, info.width, info.height, fixed, false);
        return canvas as CanvasImageSource;
      }
      const w = Math.max(1, Math.round(info.width));
      const h = Math.max(1, Math.round(info.height));
      const data = pixels(frame, w, h, fixed);
      return new VideoFrame(data, {
        format: "RGBA",
        codedWidth: w,
        codedHeight: h,
        timestamp: Math.round(info.time * 1e6),
      });
    };
  };

  return {
    hookFor,
    pixels,
    dispose: () => {
      if (state && !state.gl.isContextLost()) {
        state.gl.deleteTexture(state.texture);
        state.gl.deleteBuffer(state.buffer);
        state.gl.deleteProgram(state.program);
        state.gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
      state = null;
      canvas = null;
    },
  };
}

function compile(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new KeyerError("The key's shader couldn't be created.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new KeyerError(`The key's shader didn't compile: ${log ?? "no reason given"}`);
  }
  return shader;
}

function setup(gl: GL) {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!program) throw new KeyerError("The key's shader couldn't be created.");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new KeyerError(`The key's shader didn't link: ${gl.getProgramInfoLog(program) ?? "no reason given"}`);
  }
  gl.useProgram(program);

  // One triangle strip over the whole canvas.
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // The frame and the canvas are the same size: NEAREST samples each pixel exactly.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  gl.disable(gl.BLEND);

  const at = (name: string) => gl.getUniformLocation(program, name);
  return {
    gl,
    program,
    buffer,
    texture,
    u: {
      frame: at("u_frame"),
      flip: at("u_flip"),
      key: at("u_key"),
      dir: at("u_dir"),
      inner: at("u_inner"),
      outer: at("u_outer"),
      clean: at("u_clean"),
      spill: at("u_spill"),
    },
  };
}

function render(
  s: ReturnType<typeof setup>,
  frame: CanvasImageSource,
  w: number,
  h: number,
  u: KeyUniforms,
  flip: boolean,
) {
  const { gl } = s;
  gl.viewport(0, 0, w, h);
  gl.bindTexture(gl.TEXTURE_2D, s.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as TexImageSource);
  gl.uniform1i(s.u.frame, 0);
  gl.uniform1f(s.u.flip, flip ? -1 : 1);
  gl.uniform2f(s.u.key, u.key[0], u.key[1]);
  gl.uniform2f(s.u.dir, u.dir[0], u.dir[1]);
  gl.uniform1f(s.u.inner, u.inner);
  gl.uniform1f(s.u.outer, u.outer);
  gl.uniform1f(s.u.clean, u.clean);
  gl.uniform1f(s.u.spill, u.spill);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
