/**
 * GLSL shaders for selective desaturation.
 *
 * The fragment shader samples the video, converts every pixel to grayscale,
 * and then blends the ORIGINAL color back in only for pixels whose hue falls
 * inside a configurable range (with a soft feathered edge). A saturation and
 * brightness gate prevents near-gray / very dark pixels — whose hue is noisy
 * and unreliable — from being falsely "preserved".
 */

export const vertexShader = /* glsl */ `
  varying vec2 vUv;

  // Camera-independent full-screen quad: the geometry is a plane spanning
  // [-1..1] in x/y, so we output its position directly as clip-space
  // coordinates. This fills the whole frame regardless of the R3F camera.
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D uTexture;

  // --- Preserved-hue controls (all driven from props, see SelectiveDesaturation.tsx) ---
  uniform float uHueCenter;     // center of the preserved hue, in degrees [0..360]
  uniform float uHueRange;      // full width of the fully-preserved band, in degrees
  uniform float uHueSoftness;   // extra degrees of soft falloff on each side of the band
  uniform float uMinSaturation; // pixels below this saturation are treated as gray
  uniform float uSatSoftness;   // soft falloff width for the saturation gate
  uniform float uMinValue;      // pixels darker than this (HSV value) are treated as gray
  uniform float uValSoftness;   // soft falloff width for the brightness gate
  uniform float uDesaturateStrength; // 0 = no desaturation, 1 = full B&W outside the hue range

  // Rec. 709 luma weights for a perceptual grayscale.
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  // Standard RGB -> HSV. Returns hue in [0..1], sat [0..1], value [0..1].
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

  // Shortest circular distance between two hue angles expressed in degrees.
  float hueDistanceDeg(float a, float b) {
    float d = abs(a - b);
    return min(d, 360.0 - d);
  }

  void main() {
    vec4 texel = texture2D(uTexture, vUv);
    vec3 rgb = texel.rgb;

    vec3 hsv = rgb2hsv(rgb);
    float hueDeg = hsv.x * 360.0;
    float sat = hsv.y;
    float val = hsv.z;

    // How close is this pixel's hue to the preserved center?
    float dist = hueDistanceDeg(hueDeg, uHueCenter);
    float halfBand = uHueRange * 0.5;

    // 1.0 inside the band, feathering to 0.0 across uHueSoftness on each edge.
    float hueMask = 1.0 - smoothstep(halfBand, halfBand + uHueSoftness, dist);

    // Gate out unreliable pixels: too gray or too dark to have a trustworthy hue.
    float satMask = smoothstep(uMinSaturation, uMinSaturation + uSatSoftness, sat);
    float valMask = smoothstep(uMinValue, uMinValue + uValSoftness, val);

    float preserve = hueMask * satMask * valMask;

    // Grayscale version of the pixel.
    float luma = dot(rgb, LUMA);
    vec3 grayRgb = vec3(luma);

    // Desaturated base (full B&W when uDesaturateStrength == 1).
    vec3 desaturated = mix(rgb, grayRgb, uDesaturateStrength);

    // Preserve original color where the mask says so, otherwise use the desaturated base.
    vec3 outRgb = mix(desaturated, rgb, preserve);

    gl_FragColor = vec4(outRgb, texel.a);
  }
`;
