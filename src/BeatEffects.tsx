import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
} from "remotion";

export type BeatEffectType =
  | "horizontalStretch"
  | "verticalStretch"
  | "zoom"
  | "shake"
  | "glitchSlice"
  | "colorGlitch"
  | "warp";

export type BeatEvent = {
  frame: number;
  time: number;
  type: BeatEffectType;
  /** 0..1, how hard this hit was — scales how strong the effect snaps in. */
  intensity: number;
  /** How many frames the snap takes to ease back to baseline before the next hit. */
  decayFrames: number;
};

export type ClipCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type ClipCaption = {
  clipIndex: number;
  startFrame: number;
  endFrame: number;
  text: string;
  corner: ClipCorner;
  rotationDeg: number;
  fontSizePx: number;
};

export type BeatEffectsProps = {
  src: string;
  beats: BeatEvent[];
  clips: ClipCaption[];
};

const CAPTION_POP_FRAMES = 5;

const CORNER_STYLE: Record<ClipCorner, React.CSSProperties> = {
  "top-left": { top: "6%", left: "6%" },
  "top-right": { top: "6%", right: "6%", textAlign: "right" },
  "bottom-left": { bottom: "8%", left: "6%" },
  "bottom-right": { bottom: "8%", right: "6%", textAlign: "right" },
};

const findActiveClip = (
  frame: number,
  clips: ClipCaption[]
): ClipCaption | null => {
  for (const c of clips) {
    if (frame >= c.startFrame && frame < c.endFrame) return c;
  }
  return null;
};

// How far each effect type is allowed to push at intensity 1.
const MAX_H_STRETCH = 0.95; // scaleX up to ~1.95
const MAX_V_STRETCH = 0.65; // scaleY up to ~1.65
const MAX_ZOOM = 0.32;
const SHAKE_PX = 46;
const SHAKE_ROTATE_DEG = 7;
const WARP_SKEW_DEG = 16;

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// Deterministic per-frame "noise" in [-1, 1], seeded so it's stable across
// renders but reads as jittery rather than smooth.
const noise = (frame: number, seed: number) =>
  hash(frame * 1.7 + seed * 91.3) * 2 - 1;

/**
 * Finds the most recently triggered beat at or before `frame` and returns how
 * far into its decay window we are. Returns null once fully decayed so the
 * clip sits at rest between hits — every hit is a hard snap-in (envelope = 1
 * at frame 0 of the hit), never a fade-in, easing back out afterwards.
 */
const activeBeat = (
  frame: number,
  beats: BeatEvent[]
): { beat: BeatEvent; envelope: number } | null => {
  let candidate: BeatEvent | null = null;
  for (const b of beats) {
    if (b.frame > frame) break;
    candidate = b;
  }
  if (!candidate) return null;
  const t = frame - candidate.frame;
  if (t > candidate.decayFrames) return null;
  const progress = t / candidate.decayFrames;
  const envelope = candidate.intensity * Math.pow(1 - progress, 2);
  return { beat: candidate, envelope };
};

export const BeatEffects: React.FC<BeatEffectsProps> = ({
  src,
  beats,
  clips,
}) => {
  const frame = useCurrentFrame();
  const resolvedSrc = src.startsWith("http") ? src : staticFile(src);

  const active = activeBeat(frame, beats);

  let scaleX = 1;
  let scaleY = 1;
  let translateX = 0;
  let translateY = 0;
  let rotate = 0;
  let skewX = 0;
  let skewY = 0;
  let filter = "saturate(1.15) contrast(1.05)";

  let glitchLayers: React.ReactNode = null;

  if (active) {
    const { beat, envelope } = active;
    const t = frame - beat.frame;

    switch (beat.type) {
      case "horizontalStretch": {
        scaleX = 1 + envelope * MAX_H_STRETCH;
        break;
      }
      case "verticalStretch": {
        scaleY = 1 + envelope * MAX_V_STRETCH;
        break;
      }
      case "zoom": {
        const s = 1 + envelope * MAX_ZOOM;
        scaleX = s;
        scaleY = s;
        break;
      }
      case "shake": {
        translateX = noise(t, beat.frame) * SHAKE_PX * envelope;
        translateY = noise(t, beat.frame + 1) * SHAKE_PX * 0.6 * envelope;
        rotate = noise(t, beat.frame + 2) * SHAKE_ROTATE_DEG * envelope;
        const s = 1 + envelope * 0.06;
        scaleX = s;
        scaleY = s;
        break;
      }
      case "warp": {
        skewX = noise(t, beat.frame) * WARP_SKEW_DEG * envelope;
        skewY = noise(t, beat.frame + 3) * WARP_SKEW_DEG * 0.4 * envelope;
        const s = 1 + envelope * 0.3;
        scaleX = s;
        scaleY = s;
        break;
      }
      case "colorGlitch": {
        const flicker = hash(frame * 3.1);
        const hue = noise(t, beat.frame) * 180 * envelope;
        const invertOn = envelope > 0.5 && flicker > 0.72 ? 1 : 0;
        filter = `saturate(${1 + envelope * 3.5}) contrast(${
          1 + envelope * 1.6
        }) hue-rotate(${hue}deg) invert(${invertOn})`;
        const s = 1 + envelope * 0.08;
        scaleX = s;
        scaleY = s;
        break;
      }
      case "glitchSlice": {
        const s = 1 + envelope * 0.1;
        scaleX = s;
        scaleY = s;
        const bandCount = 3;
        const layers = [];
        for (let i = 0; i < bandCount; i += 1) {
          const bandFlicker = hash(frame * 5.3 + i * 17.1);
          if (bandFlicker < 0.4) continue; // bands don't all glitch every frame
          const top = (i / bandCount) * 100;
          const bottom = 100 - ((i + 1) / bandCount) * 100;
          const offset = noise(t, beat.frame + i * 7) * 70 * envelope;
          layers.push(
            <OffthreadVideo
              key={i}
              src={resolvedSrc}
              style={{
                position: "absolute",
                width: "100%",
                height: "100%",
                objectFit: "cover",
                clipPath: `inset(${top}% 0% ${bottom}% 0%)`,
                transform: `translateX(${offset}px)`,
                mixBlendMode: i === 1 ? "screen" : "normal",
                filter:
                  i === 0
                    ? "saturate(4) hue-rotate(-40deg)"
                    : i === 2
                    ? "saturate(4) hue-rotate(150deg)"
                    : undefined,
                opacity: 0.85,
              }}
            />
          );
        }
        glitchLayers = layers;
        break;
      }
      default:
        break;
    }
  }

  const activeClip = findActiveClip(frame, clips);
  let captionNode: React.ReactNode = null;
  if (activeClip) {
    const t = frame - activeClip.startFrame;
    const popProgress = Math.min(1, t / CAPTION_POP_FRAMES);
    // hard pop-in (not a linear fade), same "abrupt attack" language as the
    // beat effects: snap most of the way in immediately, ease the last bit.
    const eased = 1 - Math.pow(1 - popProgress, 3);
    const opacity = t <= 0 ? 0 : Math.min(1, 0.4 + eased * 0.6) * 0.88;
    const scale = 0.85 + eased * 0.15;

    captionNode = (
      <div
        style={{
          position: "absolute",
          ...CORNER_STYLE[activeClip.corner],
          maxWidth: "42%",
          fontFamily: "'Courier New', Courier, monospace",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          lineHeight: 1.25,
          fontSize: activeClip.fontSizePx,
          color: "rgba(255,255,255,0.92)",
          textShadow:
            "0 0 6px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9), 1px 1px 0 rgba(0,0,0,0.6)",
          opacity,
          transform: `rotate(${activeClip.rotationDeg}deg) scale(${scale})`,
          transformOrigin:
            activeClip.corner === "top-left" ||
            activeClip.corner === "bottom-left"
              ? "left center"
              : "right center",
        }}
      >
        {activeClip.text}
      </div>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: "scaleX(-1)" }}>
        <OffthreadVideo
          src={resolvedSrc}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter,
            transform: `translate(${translateX}px, ${translateY}px) rotate(${rotate}deg) skew(${skewX}deg, ${skewY}deg) scale(${scaleX}, ${scaleY})`,
          }}
        />
        {glitchLayers}
      </AbsoluteFill>
      {captionNode}
    </AbsoluteFill>
  );
};
