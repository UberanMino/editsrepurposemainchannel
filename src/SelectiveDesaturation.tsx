import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import {
  AbsoluteFill,
  Video,
  getRemotionEnvironment,
  staticFile,
  useVideoConfig,
} from "remotion";
import {
  ThreeCanvas,
  useOffthreadVideoTexture,
  useVideoTexture,
} from "@remotion/three";
import { fragmentShader, vertexShader } from "./shader";

/**
 * Everything about which colors survive the desaturation lives here.
 * Hues are in DEGREES on the standard color wheel:
 *   0/360 = red, 30 = orange, 60 = yellow, 120 = green,
 *   180 = cyan, 240 = blue, 300 = magenta, 330 = pink.
 *
 * To preserve a different color, change `hueCenter`. To widen/narrow the
 * band of colors that survive, change `hueRange` / `hueSoftness`.
 */
export type SelectiveDesaturationProps = {
  src: string;
  /** Center of the hue you want to keep, in degrees [0..360]. */
  hueCenter: number;
  /** Full width of the fully-preserved hue band, in degrees. */
  hueRange: number;
  /** Extra degrees of soft falloff on each side of the band (feathered edge). */
  hueSoftness: number;
  /** Pixels below this saturation [0..1] are treated as gray (ignored). */
  minSaturation: number;
  /** Soft falloff width for the saturation gate. */
  satSoftness: number;
  /** Pixels darker than this brightness [0..1] are treated as gray (ignored). */
  minValue: number;
  /** Soft falloff width for the brightness gate. */
  valSoftness: number;
  /** 0 = keep original colors everywhere, 1 = full black & white outside the hue band. */
  desaturateStrength: number;
};

/** Sensible defaults tuned to preserve red / pink tones. */
export const defaultSelectiveDesaturationProps: Omit<
  SelectiveDesaturationProps,
  "src"
> = {
  hueCenter: 345, // red-pink
  hueRange: 40,
  hueSoftness: 20,
  minSaturation: 0.18,
  satSoftness: 0.12,
  minValue: 0.08,
  valSoftness: 0.1,
  desaturateStrength: 1,
};

const ShaderPlane: React.FC<{
  texture: THREE.Texture;
  params: Omit<SelectiveDesaturationProps, "src">;
}> = ({ texture, params }) => {
  const advance = useThree((state) => state.advance);
  const { isRendering } = getRemotionEnvironment();

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTexture: { value: null as THREE.Texture | null },
          uHueCenter: { value: 0 },
          uHueRange: { value: 0 },
          uHueSoftness: { value: 0 },
          uMinSaturation: { value: 0 },
          uSatSoftness: { value: 0 },
          uMinValue: { value: 0 },
          uValSoftness: { value: 0 },
          uDesaturateStrength: { value: 1 },
        },
      }),
    [],
  );

  material.uniforms.uTexture.value = texture;
  material.uniforms.uHueCenter.value = params.hueCenter;
  material.uniforms.uHueRange.value = params.hueRange;
  material.uniforms.uHueSoftness.value = params.hueSoftness;
  material.uniforms.uMinSaturation.value = params.minSaturation;
  material.uniforms.uSatSoftness.value = params.satSoftness;
  material.uniforms.uMinValue.value = params.minValue;
  material.uniforms.uValSoftness.value = params.valSoftness;
  material.uniforms.uDesaturateStrength.value = params.desaturateStrength;

  // During rendering Remotion's <ThreeCanvas> runs with frameloop="never" and
  // only advances (draws) the scene when the frame number changes. The video
  // texture, however, arrives asynchronously *after* that draw, so we must
  // manually advance again once the texture / uniforms are in place — otherwise
  // the captured frame shows the pre-texture (black) scene. In preview the
  // canvas already renders every animation frame, so this is rendering-only.
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

/**
 * During rendering we use the frame-perfect off-thread video texture.
 * During Studio preview `useOffthreadVideoTexture` is unavailable, so we fall
 * back to `useVideoTexture` reading from a hidden <Video>. `isRendering` is
 * constant for the component's lifetime, so the conditional hook is safe.
 */
const RenderScene: React.FC<{
  src: string;
  params: Omit<SelectiveDesaturationProps, "src">;
}> = ({ src, params }) => {
  const texture = useOffthreadVideoTexture({ src });
  if (!texture) {
    return null;
  }
  return <ShaderPlane texture={texture} params={params} />;
};

const PreviewScene: React.FC<{
  src: string;
  width: number;
  height: number;
  params: Omit<SelectiveDesaturationProps, "src">;
}> = ({ src, width, height, params }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const texture = useVideoTexture(videoRef);
  return (
    <>
      <Video
        ref={videoRef}
        src={src}
        muted
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
      {texture ? (
        <ThreeCanvas width={width} height={height}>
          <ShaderPlane texture={texture} params={params} />
        </ThreeCanvas>
      ) : null}
    </>
  );
};

export const SelectiveDesaturation: React.FC<SelectiveDesaturationProps> = ({
  src,
  ...params
}) => {
  const { width, height } = useVideoConfig();
  const resolvedSrc = src.startsWith("http") ? src : staticFile(src);
  const isRendering = getRemotionEnvironment().isRendering;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {isRendering ? (
        <ThreeCanvas width={width} height={height}>
          <RenderScene src={resolvedSrc} params={params} />
        </ThreeCanvas>
      ) : (
        <PreviewScene src={resolvedSrc} width={width} height={height} params={params} />
      )}
    </AbsoluteFill>
  );
};
