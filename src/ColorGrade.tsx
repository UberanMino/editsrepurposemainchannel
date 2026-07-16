import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * A CSS-filter color grade: boosted saturation + contrast, with the hue
 * rotating continuously over the clip's duration.
 *
 * Why the foreground "pops": `saturate()` scales saturation multiplicatively,
 * so already-vivid pixels (a colorful subject) gain much more punch than
 * near-gray pixels (muted background), which stay close to gray however far
 * the hue is rotated. No masking is needed — it falls out of how the filter
 * math works on top of footage where the subject is the most saturated thing
 * in frame.
 */
export type ColorGradeProps = {
  src: string;
  /** Saturation multiplier. 1 = unchanged, >1 = more vivid. */
  saturation: number;
  /** Contrast multiplier. 1 = unchanged, >1 = punchier. */
  contrast: number;
  /** How many full 360° hue rotations happen over the whole clip. */
  rotationsPerClip: number;
};

export const defaultColorGradeProps: Omit<ColorGradeProps, "src"> = {
  saturation: 1.6,
  contrast: 1.15,
  rotationsPerClip: 1,
};

export const ColorGrade: React.FC<ColorGradeProps> = ({
  src,
  saturation,
  contrast,
  rotationsPerClip,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const hueRotateDeg =
    (frame / durationInFrames) * 360 * rotationsPerClip;

  const resolvedSrc = src.startsWith("http") ? src : staticFile(src);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <OffthreadVideo
        src={resolvedSrc}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: `saturate(${saturation}) contrast(${contrast}) hue-rotate(${hueRotateDeg}deg)`,
        }}
      />
    </AbsoluteFill>
  );
};
