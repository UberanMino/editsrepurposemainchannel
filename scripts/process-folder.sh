#!/usr/bin/env bash
# Batch entry point: runs every video in a folder through
# scripts/process-video.sh (mirror + beat-synced effects at a randomized
# [1.4x, 1.6x] intensity, captions alternating every other video) and drops
# each finished file into an output folder under its original name.
#
# Usage:
#   scripts/process-folder.sh <input-folder> <output-folder> [intensity-multiplier]
#
# intensity-multiplier is optional and applies to every video in this run
# if given; omit it to let each video draw its own random value from
# [1.4, 1.6] independently (the usual mode — "vary slightly video to video").
#
# Skips a file if a same-named output already exists in the output folder,
# so re-running after adding new files to the input folder won't redo
# earlier ones.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

INPUT_DIR="${1:?Usage: scripts/process-folder.sh <input-folder> <output-folder> [intensity-multiplier]}"
OUTPUT_DIR="${2:?Usage: scripts/process-folder.sh <input-folder> <output-folder> [intensity-multiplier]}"
INTENSITY_MULTIPLIER="${3:-}"

mkdir -p "$OUTPUT_DIR"

shopt -s nullglob nocaseglob
FILES=("$INPUT_DIR"/*.mp4 "$INPUT_DIR"/*.mov "$INPUT_DIR"/*.m4v "$INPUT_DIR"/*.mkv)
shopt -u nocaseglob

if [ ${#FILES[@]} -eq 0 ]; then
  echo "No video files found in $INPUT_DIR"
  exit 0
fi

echo "Found ${#FILES[@]} video(s) in $INPUT_DIR"

for INPUT_VIDEO in "${FILES[@]}"; do
  ORIGINAL_NAME="$(basename "$INPUT_VIDEO")"
  BASE_NAME="${ORIGINAL_NAME%.*}"
  OUTPUT_PATH="${OUTPUT_DIR}/${ORIGINAL_NAME%.*}.mp4"

  if [ -f "$OUTPUT_PATH" ]; then
    echo "skip (already in output folder): $ORIGINAL_NAME"
    continue
  fi

  # sanitize into a safe project name: lowercase, spaces/punctuation -> hyphens
  PROJECT_NAME=$(echo "$BASE_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')

  echo ""
  echo "############################################"
  echo "# $ORIGINAL_NAME  ->  project '$PROJECT_NAME'"
  echo "############################################"

  bash scripts/process-video.sh "$INPUT_VIDEO" "$PROJECT_NAME" "$INTENSITY_MULTIPLIER"

  RENDERED="out/${PROJECT_NAME}.mp4"
  cp "$RENDERED" "$OUTPUT_PATH"
  echo "saved: $OUTPUT_PATH"

  # working copies aren't meant to pile up locally — the source lives in
  # the input folder and the result now lives in the output folder
  rm -f "public/${PROJECT_NAME}.mp4" "$RENDERED" "src/data/props/${PROJECT_NAME}.json"
done

echo ""
echo "Batch done: $OUTPUT_DIR"
