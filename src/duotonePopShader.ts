/**
 * GLSL shaders for a flat "cutout" effect: the background becomes one solid
 * color (or the foreground can too), separated from the rest by the
 * segmentation matte's (already antialiased) edge — no shading, no gradient.
 *
 * The foreground can be either a flat constant color (a true "duotone") or
 * the ORIGINAL video, untouched — controlled by uUseOriginalForeground. When
 * using the original, the color video is sampled directly and passed through
 * as-is; when flat, uForegroundColor is used instead. Either way the
 * background is always the flat uBackgroundColor.
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
  uniform vec3 uForegroundColor; // 0..1 RGB, used when uUseOriginalForeground is 0
  uniform vec3 uBackgroundColor; // 0..1 RGB
  uniform float uUseOriginalForeground; // 0 = flat uForegroundColor, 1 = sample uColorTexture untouched

  void main() {
    vec3 rgb = texture2D(uColorTexture, vUv).rgb;
    float mask = texture2D(uMaskTexture, vUv).r;

    vec3 fgColor = mix(uForegroundColor, rgb, uUseOriginalForeground);
    vec3 outColor = mix(uBackgroundColor, fgColor, mask);

    gl_FragColor = vec4(outColor, 1.0);
  }
`;
