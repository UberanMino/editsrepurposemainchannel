# Video Color Effects (Remotion)

Two [Remotion](https://www.remotion.dev/) compositions built on the same
source clip (`public/input.mp4`):

- **`SelectiveDesaturation`** — a GLSL shader (via `@remotion/three`) that
  turns the video black & white except for a configurable hue range.
- **`ColorGrade`** — a plain CSS-filter grade: boosted saturation + contrast,
  with the hue rotating continuously over the clip.

## `SelectiveDesaturation`

Think "one red rose in a grayscale scene", applied to video. Implemented as a
**GLSL fragment shader** running on
[`@remotion/three`](https://www.remotion.dev/docs/three), fed frame-accurately
by [`useOffthreadVideoTexture()`](https://www.remotion.dev/docs/use-offthread-video-texture).
For every pixel the shader:

1. converts the color to grayscale (Rec. 709 luma), and
2. blends the **original** color back in only when the pixel's hue falls inside
   the preserved band — with a soft, feathered edge and gates that ignore
   near-gray / very dark pixels whose hue is unreliable.

### The variable you adjust

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

### Implementation note

During rendering, `<ThreeCanvas>` runs with `frameloop="never"` and only draws
the scene when the frame number changes. The off-thread video texture, however,
resolves **asynchronously** after that draw, so `ShaderPlane` calls
`useThree().advance()` once the texture is in place to force a redraw before
Remotion captures the frame. Without this the shader would sample an empty
texture and render black.

## `ColorGrade`

A CSS `filter` color grade applied directly to `<OffthreadVideo>` — no
Three.js needed. Defined in [`src/ColorGrade.tsx`](src/ColorGrade.tsx):

```ts
export const defaultColorGradeProps = {
  saturation: 1.6,       // saturate() multiplier — 1 = unchanged
  contrast: 1.15,        // contrast() multiplier — 1 = unchanged
  rotationsPerClip: 1,   // full 360° hue-rotate() cycles over the clip
};
```

The hue angle is computed from `useCurrentFrame()` each frame:

```ts
const hueRotateDeg = (frame / durationInFrames) * 360 * rotationsPerClip;
```

**Why the foreground pops without any masking:** `saturate()` scales
saturation *multiplicatively*. A pixel that's already vivid (the colorful
subject) gets pushed much further than a near-gray pixel (sky, pavement,
muted background), which stays close to gray no matter how far the hue is
rotated. So as long as the subject is the most saturated thing in the shot to
begin with — true of most foreground-subject footage — boosting saturation
uniformly makes it pop *relative to* the background for free.

- **Rotate faster/slower?** Change `rotationsPerClip` (0.5 = half a rotation
  over the whole clip, 2 = two full spins).
- **More/less vivid?** Change `saturation`.
- **Punchier shadows/highlights?** Change `contrast`.

## Run it

```bash
npm install

# Interactive studio (tweak props live)
npm run dev

# Render either composition
npx remotion render SelectiveDesaturation out/desaturation.mp4
npx remotion render ColorGrade out/colorgrade.mp4
```

The source clip is `public/input.mp4` and both compositions are `1080x1920`
(vertical), 30fps — change these in [`src/Root.tsx`](src/Root.tsx).

### Rendering in a restricted/sandboxed environment

Remotion normally downloads its own headless Chromium. If outbound access to
`remotion.media` is blocked, point Remotion at an existing
`chrome-headless-shell` binary:

```bash
npx remotion render ColorGrade out/colorgrade.mp4 \
  --browser-executable=/path/to/chrome-headless-shell
```

Note: the `<Video>` tag requires the browser itself to decode H.264, which a
stock headless-shell build may not support — both compositions here use
`<OffthreadVideo>` / `useOffthreadVideoTexture()`, which decode frames via
Remotion's bundled FFmpeg instead and work regardless of browser codec
support.
