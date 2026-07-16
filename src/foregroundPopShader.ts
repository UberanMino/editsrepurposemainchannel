/**
 * GLSL shaders for the foreground "pop" grade.
 *
 * Unlike the hue-based selective desaturation, the pixels that keep their
 * color here are decided by a precomputed person-segmentation mask
 * (see scripts/generate-mask.js -> public/mask.mp4), not by color. The
 * shader reads two videos in lockstep — the color frame and its matching
 * foreground matte — and renders two different grades of the same pixel,
 * blended by the (feathered) mask value:
 *   - foreground: boosted saturation + brightness, so the subject pops.
 *   - background: reduced saturation + brightness, but NOT fully desaturated.
 */

export const vertexShader = /* glsl */ `
  varying vec2 vUv;

  // Camera-independent full-screen quad, see SelectiveDesaturation's shader.ts.
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D uColorTexture;
  uniform sampler2D uMaskTexture;

  // --- Grade controls (all driven from props, see ForegroundPop.tsx) ---
  uniform float uForegroundSaturation; // multiplier on foreground saturation, >1 = more vivid
  uniform float uForegroundBrightness; // multiplier on foreground brightness (HSV value)
  uniform float uBackgroundSaturation; // multiplier on background saturation, <1 = muted (not 0!)
  uniform float uBackgroundBrightness; // multiplier on background brightness (HSV value)

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    float hue = abs(q.z + (q.w - q.y) / (6.0 * d + e));
    float sat = d / (q.x + e);
    float val = q.x;
    return vec3(hue, sat, val);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec3 rgb = texture2D(uColorTexture, vUv).rgb;
    // Mask video is grayscale (feathered 0..1 foreground probability) stored
    // in all three channels; red is as good as any.
    float mask = texture2D(uMaskTexture, vUv).r;

    vec3 hsv = rgb2hsv(rgb);

    vec3 fgHsv = vec3(
      hsv.x,
      clamp(hsv.y * uForegroundSaturation, 0.0, 1.0),
      clamp(hsv.z * uForegroundBrightness, 0.0, 1.0)
    );
    vec3 bgHsv = vec3(
      hsv.x,
      clamp(hsv.y * uBackgroundSaturation, 0.0, 1.0),
      clamp(hsv.z * uBackgroundBrightness, 0.0, 1.0)
    );

    vec3 fgRgb = hsv2rgb(fgHsv);
    vec3 bgRgb = hsv2rgb(bgHsv);

    vec3 outRgb = mix(bgRgb, fgRgb, mask);

    gl_FragColor = vec4(outRgb, 1.0);
  }
`;
