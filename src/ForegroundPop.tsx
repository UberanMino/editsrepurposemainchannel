import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import {
  AbsoluteFill,
  Video,
  getRemotionEnvironment,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  ThreeCanvas,
  useOffthreadVideoTexture,
  useVideoTexture,
} from "@remotion/three";
import { fragmentShader, vertexShader } from "./foregroundPopShader";

/**
 * Boosts saturation/brightness on the foreground subject (kept pixel-sharp)
 * and recolors the background toward a light, airy sky-blue palette — a
 * "flying through the sky" feel — plus a gentle liquify (animated UV warp)
 * so the background reads as a distinct, moving field behind the subject.
 *
 * The background's hue/saturation/brightness are each blended TOWARD A FIXED
 * TARGET (not multiplied by the source pixel's own values, see
 * foregroundPopShader.ts) so the effect's visible strength is consistent
 * across different clips — a previous multiplicative version looked barely
 * there on flat/dark footage and blown-out on already-vivid, brightly-lit
 * footage, because multiplying preserves whatever the source happened to be.
 * Blending toward a fixed target instead makes every clip converge on
 * roughly the same look at the same `backgroundColorizeStrength`.
 *
 * Uses a precomputed person-segmentation matte (public/mask*.mp4, generated
 * by scripts/generate-mask.js) instead of a color-based mask. See README.md
 * for how to regenerate it if you swap in a different source video.
 */
export type ForegroundPopProps = {
  src: string;
  maskSrc: string;
  /** Foreground saturation multiplier. 1 = unchanged, >1 = more vivid. */
  foregroundSaturation: number;
  /** Foreground brightness multiplier. 1 = unchanged, >1 = brighter. */
  foregroundBrightness: number;
  /** Center hue of the background's "sky" target, in degrees (~200-210 = cyan-blue). */
  backgroundHueDeg: number;
  /** How many degrees the sky hue gently drifts +/- around backgroundHueDeg over time. */
  skyDriftAmount: number;
  /** Speed of that drift, in radians/second — smaller is slower/calmer. */
  skyDriftSpeed: number;
  /** Target saturation the background is pulled toward. Keep this LOW-MODERATE (e.g. 0.25-0.4) for a "light" sky rather than a neon one. */
  backgroundTargetSaturation: number;
  /** Target brightness (HSV value) the background is pulled toward. High (e.g. 0.85-0.95) reads as bright/airy. */
  backgroundTargetBrightness: number;
  /** How strongly to pull the background's hue/saturation/brightness toward the sky target. 0 = leave the background untouched, 1 = fully replace it with the target look, regardless of the source footage. */
  backgroundColorizeStrength: number;
  /** Liquify warp displacement, in UV units. ~0.005-0.01 reads as a gentle drift. */
  liquifyAmount: number;
  /** Spatial frequency of the liquify ripples — lower = bigger, cloudier shapes. */
  liquifyScale: number;
  /** Animation speed multiplier for the liquify effect. */
  liquifySpeed: number;
};

/**
 * Sensible defaults: subject pops with a modest, consistent saturation/
 * brightness boost; background is pulled toward a light sky blue (moderate
 * saturation, high brightness — NOT neon) with a slow hue drift and a gentle
 * cloud-like liquify, for a "flying through the sky" feel that reads the
 * same way on every clip.
 */
export const defaultForegroundPopProps: Omit<
  ForegroundPopProps,
  "src" | "maskSrc"
> = {
  foregroundSaturation: 1.15,
  foregroundBrightness: 1.05,
  backgroundHueDeg: 205,
  skyDriftAmount: 12,
  skyDriftSpeed: 0.15,
  backgroundTargetSaturation: 0.35,
  backgroundTargetBrightness: 0.88,
  backgroundColorizeStrength: 0.75,
  liquifyAmount: 0.0072,
  liquifyScale: 5,
  liquifySpeed: 0.6,
};

const ShaderPlane: React.FC<{
  colorTexture: THREE.Texture;
  maskTexture: THREE.Texture;
  backgroundTargetHueDeg: number;
  time: number;
  params: Omit<ForegroundPopProps, "src" | "maskSrc">;
}> = ({ colorTexture, maskTexture, backgroundTargetHueDeg, time, params }) => {
  const advance = useThree((state) => state.advance);
  const { isRendering } = getRemotionEnvironment();

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uColorTexture: { value: null as THREE.Texture | null },
          uMaskTexture: { value: null as THREE.Texture | null },
          uForegroundSaturation: { value: 1 },
          uForegroundBrightness: { value: 1 },
          uBackgroundTargetHue: { value: 0 },
          uBackgroundTargetSaturation: { value: 0 },
          uBackgroundTargetBrightness: { value: 0 },
          uBackgroundColorizeStrength: { value: 0 },
          uTime: { value: 0 },
          uLiquifyAmount: { value: 0 },
          uLiquifyScale: { value: 1 },
          uLiquifySpeed: { value: 1 },
        },
      }),
    [],
  );

  material.uniforms.uColorTexture.value = colorTexture;
  material.uniforms.uMaskTexture.value = maskTexture;
  material.uniforms.uForegroundSaturation.value = params.foregroundSaturation;
  material.uniforms.uForegroundBrightness.value = params.foregroundBrightness;
  material.uniforms.uBackgroundTargetHue.value = backgroundTargetHueDeg;
  material.uniforms.uBackgroundTargetSaturation.value =
    params.backgroundTargetSaturation;
  material.uniforms.uBackgroundTargetBrightness.value =
    params.backgroundTargetBrightness;
  material.uniforms.uBackgroundColorizeStrength.value =
    params.backgroundColorizeStrength;
  material.uniforms.uTime.value = time;
  material.uniforms.uLiquifyAmount.value = params.liquifyAmount;
  material.uniforms.uLiquifyScale.value = params.liquifyScale;
  material.uniforms.uLiquifySpeed.value = params.liquifySpeed;

  // See SelectiveDesaturation.tsx for why this manual advance is necessary:
  // <ThreeCanvas> draws once per frame change, but the async video textures
  // resolve after that draw during rendering, so we force a second draw.
  useLayoutEffect(() => {
    if (isRendering) {
      advance(performance.now());
    }
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
};

const RenderScene: React.FC<{
  src: string;
  maskSrc: string;
  backgroundTargetHueDeg: number;
  time: number;
  params: Omit<ForegroundPopProps, "src" | "maskSrc">;
}> = ({ src, maskSrc, backgroundTargetHueDeg, time, params }) => {
  const colorTexture = useOffthreadVideoTexture({ src });
  const maskTexture = useOffthreadVideoTexture({ src: maskSrc });
  if (!colorTexture || !maskTexture) {
    return null;
  }
  return (
    <ShaderPlane
      colorTexture={colorTexture}
      maskTexture={maskTexture}
      backgroundTargetHueDeg={backgroundTargetHueDeg}
      time={time}
      params={params}
    />
  );
};

const PreviewScene: React.FC<{
  src: string;
  maskSrc: string;
  width: number;
  height: number;
  backgroundTargetHueDeg: number;
  time: number;
  params: Omit<ForegroundPopProps, "src" | "maskSrc">;
}> = ({ src, maskSrc, width, height, backgroundTargetHueDeg, time, params }) => {
  const colorRef = useRef<HTMLVideoElement>(null);
  const maskRef = useRef<HTMLVideoElement>(null);
  const colorTexture = useVideoTexture(colorRef);
  const maskTexture = useVideoTexture(maskRef);
  return (
    <>
      <Video
        ref={colorRef}
        src={src}
        muted
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
      <Video
        ref={maskRef}
        src={maskSrc}
        muted
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
      {colorTexture && maskTexture ? (
        <ThreeCanvas width={width} height={height}>
          <ShaderPlane
            colorTexture={colorTexture}
            maskTexture={maskTexture}
            backgroundTargetHueDeg={backgroundTargetHueDeg}
            time={time}
            params={params}
          />
        </ThreeCanvas>
      ) : null}
    </>
  );
};

export const ForegroundPop: React.FC<ForegroundPopProps> = ({
  src,
  maskSrc,
  ...params
}) => {
  const { width, height, fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const resolvedSrc = src.startsWith("http") ? src : staticFile(src);
  const resolvedMaskSrc = maskSrc.startsWith("http")
    ? maskSrc
    : staticFile(maskSrc);
  const isRendering = getRemotionEnvironment().isRendering;

  const time = frame / fps;
  // Gentle, fully deterministic hue drift around the base sky color — same
  // formula for every clip, so it adds life without reintroducing the
  // per-scene inconsistency that per-frame content analysis had.
  const drift =
    Math.sin(time * params.skyDriftSpeed) * params.skyDriftAmount;
  const backgroundTargetHueDeg =
    ((params.backgroundHueDeg + drift) % 360 + 360) % 360;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {isRendering ? (
        <ThreeCanvas width={width} height={height}>
          <RenderScene
            src={resolvedSrc}
            maskSrc={resolvedMaskSrc}
            backgroundTargetHueDeg={backgroundTargetHueDeg}
            time={time}
            params={params}
          />
        </ThreeCanvas>
      ) : (
        <PreviewScene
          src={resolvedSrc}
          maskSrc={resolvedMaskSrc}
          width={width}
          height={height}
          backgroundTargetHueDeg={backgroundTargetHueDeg}
          time={time}
          params={params}
        />
      )}
    </AbsoluteFill>
  );
};
