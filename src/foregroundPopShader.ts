/**
 * GLSL shaders for the foreground "pop" grade.
 *
 * The pixels that keep their original color are decided by a precomputed
 * person-segmentation mask (see scripts/generate-mask.js -> public/mask.mp4),
 * not by color. The shader reads two videos in lockstep — the color frame and
 * its matching foreground matte — and renders two different grades of the
 * same pixel, blended by the (feathered) mask value:
 *
 *   - foreground: boosted saturation + brightness, subject stays sharp.
 *   - background: recolored toward a per-frame complementary hue (computed
 *     ahead of time from the actual foreground color of that frame — see
 *     scripts/generate-mask.js's scene-colors.json output), ALSO boosted in
 *     saturation, and gently liquified (UV-warped) so it reads as a distinct,
 *     moving field behind the crisp subject rather than a flat backdrop.
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
  uniform float uBackgroundSaturation; // multiplier on background saturation, >1 = more vivid too
  uniform float uBackgroundBrightness; // multiplier on background brightness (HSV value)

  // Per-frame complementary hue (degrees) computed from the ACTUAL dominant
  // foreground color of this shot, and how strongly to pull the background's
  // own hue toward it (0 = leave background hue alone, 1 = fully replace it).
  uniform float uBackgroundTargetHue;
  uniform float uBackgroundColorizeStrength;

  // Liquify: a gentle animated UV warp applied only to the background sample,
  // so it reads as fluid/moving behind the crisp, undistorted subject.
  uniform float uTime;
  uniform float uLiquifyAmount; // warp displacement, in UV units (0..1 range)
  uniform float uLiquifyScale;  // spatial frequency of the ripples
  uniform float uLiquifySpeed;  // animation speed multiplier

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

  // Blends two hue angles (degrees) the short way around the color wheel by
  // averaging their unit vectors, so e.g. mixing 350deg and 20deg by 0.5
  // lands on 5deg, not 185deg.
  float mixHueDeg(float aDeg, float bDeg, float t) {
    float aRad = aDeg * 0.017453292; // pi / 180
    float bRad = bDeg * 0.017453292;
    vec2 va = vec2(cos(aRad), sin(aRad));
    vec2 vb = vec2(cos(bRad), sin(bRad));
    vec2 vm = mix(va, vb, clamp(t, 0.0, 1.0));
    float deg = atan(vm.y, vm.x) * 57.29577951; // 180 / pi
    return deg < 0.0 ? deg + 360.0 : deg;
  }

  // Two overlapping sine waves per axis: a cheap, seam-free "liquid" ripple.
  vec2 liquify(vec2 uv, float t) {
    vec2 o;
    o.x = sin(uv.y * uLiquifyScale + t * 1.3) * uLiquifyAmount
        + sin(uv.y * uLiquifyScale * 1.7 - t * 0.7) * uLiquifyAmount * 0.5;
    o.y = cos(uv.x * uLiquifyScale * 1.1 - t * 1.1) * uLiquifyAmount
        + cos(uv.x * uLiquifyScale * 2.3 + t * 0.9) * uLiquifyAmount * 0.5;
    return uv + o;
  }

  void main() {
    // Foreground stays pixel-sharp: sampled at the true, undistorted UV.
    vec3 rgbSharp = texture2D(uColorTexture, vUv).rgb;

    // Background is sampled through the liquify warp instead.
    vec2 liquidUv = liquify(vUv, uTime * uLiquifySpeed);
    vec3 rgbLiquid = texture2D(uColorTexture, liquidUv).rgb;

    // The matte itself is sampled at the true position, so the subject's
    // silhouette stays stable even though the background behind it ripples.
    float mask = texture2D(uMaskTexture, vUv).r;

    vec3 hsvFg = rgb2hsv(rgbSharp);
    vec3 fgHsv = vec3(
      hsvFg.x,
      clamp(hsvFg.y * uForegroundSaturation, 0.0, 1.0),
      clamp(hsvFg.z * uForegroundBrightness, 0.0, 1.0)
    );

    vec3 hsvBg = rgb2hsv(rgbLiquid);
    float bgHueDeg = mixHueDeg(hsvBg.x * 360.0, uBackgroundTargetHue, uBackgroundColorizeStrength);
    vec3 bgHsv = vec3(
      bgHueDeg / 360.0,
      clamp(hsvBg.y * uBackgroundSaturation, 0.0, 1.0),
      clamp(hsvBg.z * uBackgroundBrightness, 0.0, 1.0)
    );

    vec3 fgRgb = hsv2rgb(fgHsv);
    vec3 bgRgb = hsv2rgb(bgHsv);

    vec3 outRgb = mix(bgRgb, fgRgb, mask);

    gl_FragColor = vec4(outRgb, 1.0);
  }
`;
