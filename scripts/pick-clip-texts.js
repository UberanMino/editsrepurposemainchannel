/**
 * Sprinkles a small number of absurd/surrealist captions across a video's
 * clips (not one per clip — a handful, spread sporadically through the
 * timeline) from the shared text bank (src/data/surreal-text-bank.json).
 * Prefers whichever lines have been used least so far across all videos,
 * and writes the usage counts back so the next video's run continues the
 * rotation instead of repeating lines.
 *
 * Least-used-first with random tie-breaking, not strict round-robin, so
 * reuse still happens sometimes (as requested) without ever being the same
 * handful of lines every time.
 *
 * Usage:
 *   node scripts/pick-clip-texts.js <totalClipCount> <captionCount> <projectName> <outClipTextsPath>
 *
 * Example (12 clips in the edit, only 3 get a caption):
 *   node scripts/pick-clip-texts.js 12 3 edit-2026-07-16 src/data/edit-clip-texts.json
 */
const fs = require("fs");
const path = require("path");

const BANK_PATH = path.join(__dirname, "..", "src", "data", "surreal-text-bank.json");

const [, , totalClipCountArg, captionCountArg, projectName, outPath] = process.argv;
const totalClipCount = parseInt(totalClipCountArg, 10);
const captionCount = parseInt(captionCountArg, 10);

if (!totalClipCount || !captionCount || !projectName || !outPath) {
  console.error(
    "Usage: node scripts/pick-clip-texts.js <totalClipCount> <captionCount> <projectName> <outClipTextsPath>"
  );
  process.exit(1);
}

const bank = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));

// Safe on-screen zones: corners, kept clear of the vertical center band
// where the subject usually is in these portrait clips. Alternates so the
// same corner doesn't repeat back to back.
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];

function pickTexts(entries, count) {
  const pool = entries.map((e, i) => ({ ...e, _index: i }));
  const chosen = [];
  const usedIndices = new Set();

  for (let slot = 0; slot < count; slot += 1) {
    const available = pool.filter((e) => !usedIndices.has(e._index));
    const minUsage = Math.min(...available.map((e) => e.usageCount));
    const leastUsed = available.filter((e) => e.usageCount === minUsage);
    const pick = leastUsed[Math.floor(Math.random() * leastUsed.length)];
    usedIndices.add(pick._index);
    chosen.push(pick);
  }

  return chosen;
}

// Spread the captioned clips sporadically through the timeline instead of
// clustering: split the clip range into `captionCount` roughly-equal
// segments and pick one random clip index within each, so captions land a
// handful of times across the video rather than back to back.
function pickSporadicClipIndices(clipCount, count) {
  const segments = Math.min(count, clipCount);
  const segmentSize = clipCount / segments;
  const indices = [];
  for (let s = 0; s < segments; s += 1) {
    const start = Math.floor(s * segmentSize);
    const end = Math.floor((s + 1) * segmentSize);
    const idx = start + Math.floor(Math.random() * Math.max(1, end - start));
    indices.push(Math.min(idx, clipCount - 1));
  }
  return indices;
}

const clipIndices = pickSporadicClipIndices(totalClipCount, captionCount);
const chosen = pickTexts(bank.texts, clipIndices.length);

const now = new Date().toISOString();
const usedCorners = [];
const clipAssignments = chosen.map((entry, i) => {
  // avoid the same corner twice in a row
  let corner = CORNERS[Math.floor(Math.random() * CORNERS.length)];
  const prevCorner = usedCorners[i - 1];
  while (corner === prevCorner) {
    corner = CORNERS[Math.floor(Math.random() * CORNERS.length)];
  }
  usedCorners.push(corner);

  const bankEntry = bank.texts[entry._index];
  bankEntry.usageCount += 1;
  bankEntry.lastUsedAt = now;
  bankEntry.lastUsedInProject = projectName;

  // longer sentence-style lines get a smaller size so they still read as a
  // tucked-away note rather than a subtitle block. VT323 is a pixel font
  // that renders visually smaller than its px value vs. a normal typeface,
  // so these run a bit bigger than they would for a regular font.
  const baseSize =
    entry.text.length > 60 ? 26 : entry.text.length > 35 ? 31 : 36;

  return {
    clipIndex: clipIndices[i],
    text: entry.text,
    corner,
    // small per-clip random tilt/size so it doesn't look like a template
    rotationDeg: Math.round((Math.random() * 6 - 3) * 10) / 10,
    fontSizePx: baseSize + Math.round(Math.random() * 4),
  };
});

clipAssignments.sort((a, b) => a.clipIndex - b.clipIndex);

fs.writeFileSync(BANK_PATH, JSON.stringify(bank, null, 2) + "\n");
fs.writeFileSync(outPath, JSON.stringify(clipAssignments, null, 2) + "\n");

console.log(
  `Assigned ${clipAssignments.length} captions across ${totalClipCount} clips for "${projectName}":`
);
for (const c of clipAssignments) {
  console.log(`  clip ${c.clipIndex} [${c.corner}]: ${c.text}`);
}
