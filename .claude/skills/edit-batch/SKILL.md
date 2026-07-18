---
name: edit-batch
description: Batch-run the beat-synced absurd-clips edit pipeline (mirror + beat-triggered zoom/stretch/glitch effects, alternating surreal captions) over every video in a folder, saving finished files to another folder. Use when the user asks to process/edit a folder of clips, run the batch pipeline, or apply "the usual effects" to a batch of videos.
---

# Beat-synced batch video edit pipeline

This repo's pipeline mirrors each input video, detects its own kick/snare
beats and hard cuts, and layers on beat-triggered effects (horizontal
stretch dominant, vertical stretch secondary, occasional zoom/shake/glitch/
color-glitch/warp) that snap in hard on each hit and ease back out before
the next one. Every other video also gets 2-3 sporadic surreal captions in
a retro VHS-style font. See `scripts/process-video.sh` and
`scripts/process-folder.sh` for the implementation — this skill just
documents how to run them.

## Prerequisites (one-time setup)

From the repo root:

```bash
npm install
pip install numpy pillow   # or: pip3 install numpy pillow
```

Requires `node`, `python3`, and `jq` on PATH. `ffmpeg` is resolved
automatically (bundled with the `@remotion/compositor-*` package npm
installs for your platform; falls back to a system `ffmpeg` if none of
those work).

On a normal local machine, Remotion downloads/manages its own headless
Chrome automatically the first time you render — no extra setup needed.
(`REMOTION_BROWSER_EXECUTABLE` only needs to be set on a sandboxed machine
that can't reach Remotion's download host.)

## Running a batch

```bash
bash scripts/process-folder.sh "<input-folder>" "<output-folder>"
```

This processes every `.mp4`/`.mov`/`.m4v`/`.mkv` file in the input folder
and writes `<same-filename>.mp4` into the output folder. Already-processed
files (same name already present in the output folder) are skipped, so
re-running after dropping new clips into the input folder is safe — it
only processes what's new.

Each video:
- gets its own kick/snare beat detection run against **its own audio**
  (repeating audio across many files is fine — analysis just runs again
  each time, it doesn't assume a shared track)
- gets a random effect-intensity multiplier drawn independently from
  **[1.4, 1.6]** (the agreed range — "what we built is the minimum, up to
  ~60% stronger, varying slightly video to video")
- is always mirrored horizontally
- gets captions only on every other video (tracked automatically in
  `src/data/pipeline-state.json`, which persists across runs — don't
  hand-edit it)

To pin the same intensity for every video in a run instead of randomizing
per video (e.g. to A/B test a specific value):

```bash
bash scripts/process-folder.sh "<input-folder>" "<output-folder>" 1.5
```

## Running a single video

```bash
bash scripts/process-video.sh "<input-video>" [project-name] [intensity-multiplier]
```

Output lands at `out/<project-name>.mp4` (derived from the filename if
omitted). This is what `process-folder.sh` calls per file; use it directly
for one-off videos or debugging.

## The shared caption bank

`src/data/surreal-text-bank.json` is the fixed, user-approved list of
surreal one-liners (do not invent new ones without being asked). Its
`usageCount`/`lastUsedAt`/`lastUsedInProject` fields are updated
automatically each time a video draws from it — `scripts/pick-clip-texts.js`
always prefers whichever lines have been used least, so a big batch won't
repeat the same handful of captions.

## What NOT to commit

`public/*.mp4`, `out/`, and `src/data/props/` are gitignored on purpose —
they're per-video working files, not durable pipeline state. Only the
pipeline code and the two shared JSON state files
(`src/data/pipeline-state.json`, `src/data/surreal-text-bank.json`) should
be committed as the batch progresses.
