/**
 * GLSL shaders for a flat two-color "duotone" effect: the foreground subject
 * becomes one solid color, the background another — no shading, no gradient,
 * just the two colors separated by the segmentation matte's (already
 * antialiased) edge. Unlike ForegroundPop, this doesn't sample the color
 * video at all — the two colors are constants, so only the mask matters.
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

  uniform sampler2D uMaskTexture;
  uniform vec3 uForegroundColor; // 0..1 RGB
  uniform vec3 uBackgroundColor; // 0..1 RGB

  void main() {
    float mask = texture2D(uMaskTexture, vUv).r;
    vec3 outColor = mix(uBackgroundColor, uForegroundColor, mask);
    gl_FragColor = vec4(outColor, 1.0);
  }
`;
