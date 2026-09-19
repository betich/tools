/* The keyer's one shader. GLSL ES 1.0, so it runs on WebGL 1 and 2 alike.
   The fragment shader is `keyPixel` in settings.ts, line for line — change
   one, change the other (the tests pin `keyPixel`). */

export const VERTEX = `
attribute vec2 a_pos;
uniform float u_flip;
varying vec2 v_uv;
void main() {
  // Texture row 0 is the image's top. On screen that's clip y = +1; for a
  // readPixels (bottom row first) it's flipped so rows come out top first.
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - u_flip * a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const FRAGMENT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_frame;
uniform vec2 u_key;
uniform vec2 u_dir;
uniform float u_inner;
uniform float u_outer;
uniform float u_clean;
uniform float u_spill;

const float KR = 0.2126;
const float KB = 0.0722;
const float KG = 1.0 - KR - KB;
const float CB_SCALE = 2.0 * (1.0 - KB);
const float CR_SCALE = 2.0 * (1.0 - KR);

void main() {
  vec3 rgb = texture2D(u_frame, v_uv).rgb;
  float y = KR * rgb.r + KG * rgb.g + KB * rgb.b;
  vec2 c = vec2((rgb.b - y) / CB_SCALE, (rgb.r - y) / CR_SCALE);

  float d = distance(c, u_key);
  float alpha = smoothstep(u_inner, u_outer, d);

  float along = max(0.0, dot(c, u_dir));
  c -= along * max(u_spill, 1.0 - smoothstep(u_outer, u_clean, d)) * u_dir;

  float r = y + CR_SCALE * c.y;
  float b = y + CB_SCALE * c.x;
  float g = (y - KR * r - KB * b) / KG;
  gl_FragColor = vec4(clamp(vec3(r, g, b), 0.0, 1.0), alpha);
}
`;
