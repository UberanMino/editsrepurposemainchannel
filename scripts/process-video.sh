#!/usr/bin/env bash
# Runs one input video through the full beat-synced edit pipeline:
# mirror + beat-triggered zoom/stretch/glitch effects (intensity randomized
# per video, within [1.3x, 1.7x] of the tuned baseline) and, on every other
# video (tracked in src/data/pipeline-state.json), 2-3 sporadic surreal
# captions pulled from the shared, rotating text bank.
#
# Usage:
#   scripts/process-video.sh <input-video> [project-name]
#
# If project-name is omitted it's derived from the input filename. Output
# lands at out/<project-name>.mp4.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

INPUT_VIDEO="${1:?Usage: scripts/process-video.sh <input-video> [project-name]}"
PROJECT_NAME="${2:-$(basename "$INPUT_VIDEO" | sed 's/\.[^.]*$//')}"

BROWSER_EXECUTABLE="${REMOTION_BROWSER_EXECUTABLE:-/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell}"

SRC_FILENAME="${PROJECT_NAME}.mp4"
PUBLIC_PATH="public/${SRC_FILENAME}"
mkdir -p public "out" "src/data/props" /tmp/pipeline-work

echo "== [$PROJECT_NAME] copying source into public/ =="
cp "$INPUT_VIDEO" "$PUBLIC_PATH"

ANALYSIS_JSON="/tmp/pipeline-work/${PROJECT_NAME}-analysis.json"
echo "== [$PROJECT_NAME] analyzing beats + cuts (intensity randomized within [1.3, 1.7]) =="
python3 scripts/analyze_video.py "$PUBLIC_PATH" "$ANALYSIS_JSON"

STATE_PATH="src/data/pipeline-state.json"
PREV_HAD_CAPTIONS=$(jq -r '.lastHadCaptions' "$STATE_PATH")
if [ "$PREV_HAD_CAPTIONS" = "true" ]; then
  WANT_CAPTIONS=false
else
  WANT_CAPTIONS=true
fi

PROPS_JSON="src/data/props/${PROJECT_NAME}.json"

if [ "$WANT_CAPTIONS" = "true" ]; then
  CLIP_COUNT=$(jq '.cuts | length' "$ANALYSIS_JSON")
  CAPTION_COUNT=$(( (RANDOM % 2) + 2 )) # 2 or 3
  CLIP_TEXTS_JSON="/tmp/pipeline-work/${PROJECT_NAME}-clip-texts.json"
  echo "== [$PROJECT_NAME] captions ON this round: sprinkling $CAPTION_COUNT across $CLIP_COUNT clips =="
  node scripts/pick-clip-texts.js "$CLIP_COUNT" "$CAPTION_COUNT" "$PROJECT_NAME" "$CLIP_TEXTS_JSON"
  node scripts/build-props.js "$ANALYSIS_JSON" "$SRC_FILENAME" "$PROPS_JSON" "$CLIP_TEXTS_JSON"
else
  echo "== [$PROJECT_NAME] captions OFF this round (alternates every other video) =="
  node scripts/build-props.js "$ANALYSIS_JSON" "$SRC_FILENAME" "$PROPS_JSON"
fi

# persist alternation state
node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('$STATE_PATH', 'utf8'));
state.videosProcessed += 1;
state.lastProjectName = '$PROJECT_NAME';
state.lastHadCaptions = $WANT_CAPTIONS;
fs.writeFileSync('$STATE_PATH', JSON.stringify(state, null, 2) + '\n');
"

OUT_VIDEO="out/${PROJECT_NAME}.mp4"
echo "== [$PROJECT_NAME] rendering =="
npx remotion render BeatEffects "$OUT_VIDEO" \
  --props="$PROPS_JSON" \
  --browser-executable="$BROWSER_EXECUTABLE" \
  --concurrency=4

echo "== [$PROJECT_NAME] done: $OUT_VIDEO =="
