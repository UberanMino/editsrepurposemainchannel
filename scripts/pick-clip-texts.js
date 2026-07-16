/**
 * Assigns one absurd/surrealist caption per clip from the shared text bank
 * (src/data/surreal-text-bank.json), preferring whichever lines have been
 * used least so far across all videos, and writes the usage counts back so
 * the next video's run continues the rotation instead of repeating lines.
 *
 * Least-used-first with random tie-breaking, not strict round-robin, so
 * reuse still happens sometimes (as requested) without ever being the same
 * handful of lines every time.
 *
 * Usage:
 *   node scripts/pick-clip-texts.js <clipCount> <projectName> <outClipTextsPath>
 *
 * Example:
 *   node scripts/pick-clip-texts.js 12 edit-2026-07-16 src/data/edit-clip-texts.json
 */
const fs = require("fs");
const path = require("path");

const BANK_PATH = path.join(__dirname, "..", "src", "data", "surreal-text-bank.json");

const [, , clipCountArg, projectName, outPath] = process.argv;
const clipCount = parseInt(clipCountArg, 10);

if (!clipCount || !projectName || !outPath) {
  console.error(
    "Usage: node scripts/pick-clip-texts.js <clipCount> <projectName> <outClipTextsPath>"
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

const chosen = pickTexts(bank.texts, clipCount);

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
  // tucked-away note rather than a subtitle block
  const baseSize =
    entry.text.length > 60 ? 20 : entry.text.length > 35 ? 24 : 28;

  return {
    clipIndex: i,
    text: entry.text,
    corner,
    // small per-clip random tilt/size so it doesn't look like a template
    rotationDeg: Math.round((Math.random() * 6 - 3) * 10) / 10,
    fontSizePx: baseSize + Math.round(Math.random() * 4),
  };
});

fs.writeFileSync(BANK_PATH, JSON.stringify(bank, null, 2) + "\n");
fs.writeFileSync(outPath, JSON.stringify(clipAssignments, null, 2) + "\n");

console.log(`Assigned ${clipAssignments.length} captions for "${projectName}":`);
for (const c of clipAssignments) {
  console.log(`  clip ${c.clipIndex} [${c.corner}]: ${c.text}`);
}
