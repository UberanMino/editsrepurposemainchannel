/**
 * Merges analyze_video.py's output (cuts + beats) with an optional
 * pick-clip-texts.js caption assignment into the final Remotion props JSON
 * for the BeatEffects composition: { src, beats, clips }.
 *
 * Captions are stretched to a minimum on-screen duration (default 2s)
 * regardless of how short the clip they start on is, since a caption tied
 * strictly to a fast cut can flash by unreadably. The stretch is capped so
 * it never runs past the start of the next caption or the end of the video.
 *
 * Usage:
 *   node scripts/build-props.js <analysis.json> <srcFilename> <out-props.json> [clip-texts.json]
 */
const fs = require("fs");

const MIN_CAPTION_FRAMES = 60; // ~2s at 30fps

const [, , analysisPath, srcFilename, outPath, clipTextsPath] = process.argv;

if (!analysisPath || !srcFilename || !outPath) {
  console.error(
    "Usage: node scripts/build-props.js <analysis.json> <srcFilename> <out-props.json> [clip-texts.json]"
  );
  process.exit(1);
}

const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
const { cuts, totalFrames, beats } = analysis;
const clipStarts = cuts;
const clipEnds = cuts.slice(1).concat([totalFrames]);

let clips = [];
if (clipTextsPath && fs.existsSync(clipTextsPath)) {
  const captions = JSON.parse(fs.readFileSync(clipTextsPath, "utf8"));
  captions.sort((a, b) => a.clipIndex - b.clipIndex);

  clips = captions.map((cap, i) => {
    const startFrame = clipStarts[cap.clipIndex];
    const cutEnd = clipEnds[cap.clipIndex];
    const nextStart =
      i + 1 < captions.length ? clipStarts[captions[i + 1].clipIndex] : totalFrames;
    const desiredEnd = startFrame + MIN_CAPTION_FRAMES;
    const endFrame = Math.min(Math.max(cutEnd, desiredEnd), totalFrames, nextStart);

    return {
      clipIndex: cap.clipIndex,
      startFrame,
      endFrame,
      text: cap.text,
      corner: cap.corner,
      rotationDeg: cap.rotationDeg,
      fontSizePx: cap.fontSizePx,
    };
  });
}

const props = {
  src: srcFilename,
  totalFrames,
  beats,
  clips,
};

fs.writeFileSync(outPath, JSON.stringify(props, null, 2) + "\n");
console.log(
  `Wrote ${outPath}: ${beats.length} beats, ${clips.length} caption(s), ${totalFrames} frames`
);
