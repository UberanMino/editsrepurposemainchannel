import React from "react";
import { Composition } from "remotion";
import {
  SelectiveDesaturation,
  defaultSelectiveDesaturationProps,
} from "./SelectiveDesaturation";
import { ColorGrade, defaultColorGradeProps } from "./ColorGrade";

// Source video lives in public/ and is referenced via staticFile() inside the
// component. The 4K portrait source is sampled down into this 1080x1920 output.
const VIDEO_SRC = "input.mp4";
const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
const DURATION_IN_FRAMES = 216; // ~7.2s at 30fps

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SelectiveDesaturation"
        component={SelectiveDesaturation}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{
          src: VIDEO_SRC,
          ...defaultSelectiveDesaturationProps,
        }}
      />
      <Composition
        id="ColorGrade"
        component={ColorGrade}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{
          src: VIDEO_SRC,
          ...defaultColorGradeProps,
        }}
      />
    </>
  );
};
