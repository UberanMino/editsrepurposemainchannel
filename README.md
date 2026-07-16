# Selective Desaturation (Remotion + Three.js)

A [Remotion](https://www.remotion.dev/) composition that turns a video black &
white **except** for a configurable range of hues, which keep their original
color. Think "one red rose in a grayscale scene", applied to video.

The effect is implemented as a **GLSL fragment shader** running on
[`@remotion/three`](https://www.remotion.dev/docs/three), fed frame-accurately
by [`useOffthreadVideoTexture()`](https://www.remotion.dev/docs/use-offthread-video-texture).
For every pixel the shader:

1. converts the color to grayscale (Rec. 709 luma), and
2. blends the **original** color back in only when the pixel's hue falls inside
   the preserved band — with a soft, feathered edge and gates that ignore
   near-gray / very dark pixels whose hue is unreliable.

## The variable you adjust

Everything lives in `defaultSelectiveDesaturationProps` in
[`src/SelectiveDesaturation.tsx`](src/SelectiveDesaturation.tsx). Hues are in
**degrees** on the color wheel:

| Hue | 0/360 | 30 | 60 | 120 | 180 | 240 | 300 | 330 |
|-----|-------|----|----|-----|-----|-----|-----|-----|
| Color | red | orange | yellow | green | cyan | blue | magenta | pink |

```ts
export const defaultSelectiveDesaturationProps = {
  hueCenter: 345,        // <-- the color you keep (345 = red/pink)
  hueRange: 40,          // full width of the fully-preserved band, in degrees
  hueSoftness: 20,       // feathered falloff on each side, in degrees
  minSaturation: 0.18,   // pixels below this saturation are treated as gray
  satSoftness: 0.12,
  minValue: 0.08,        // pixels darker than this are treated as gray
  valSoftness: 0.1,
  desaturateStrength: 1, // 1 = full B&W outside the band, 0 = keep all color
};
```

- **Keep a different color?** Change `hueCenter` (e.g. `120` for green, `240`
  for blue).
- **Preserve a wider/narrower range?** Change `hueRange` and `hueSoftness`.
- **Too much noise surviving in dull areas?** Raise `minSaturation`.

You can also override any of these per-render from the Remotion Studio props
panel or via `--props`.

## Run it

```bash
npm install

# Interactive studio (tweak the hue band live)
npm run dev

# Render to out/video.mp4
npm run build
```

The source clip is `public/input.mp4` and the composition is `1080x1920`
(vertical), 30fps — change these in [`src/Root.tsx`](src/Root.tsx).

### Rendering in a restricted/sandboxed environment

Remotion normally downloads its own headless Chromium. If outbound access to
`remotion.media` is blocked, point Remotion at an existing
`chrome-headless-shell` binary:

```bash
npx remotion render SelectiveDesaturation out/video.mp4 \
  --browser-executable=/path/to/chrome-headless-shell
```

## How it works (implementation note)

During rendering, `<ThreeCanvas>` runs with `frameloop="never"` and only draws
the scene when the frame number changes. The off-thread video texture, however,
resolves **asynchronously** after that draw, so `ShaderPlane` calls
`useThree().advance()` once the texture is in place to force a redraw before
Remotion captures the frame. Without this the shader would sample an empty
texture and render black.
