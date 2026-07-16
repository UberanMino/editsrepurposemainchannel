/**
 * One-time preprocessing: runs MediaPipe Selfie Segmentation over every frame
 * of public/input.mp4 and writes a soft foreground alpha matte to
 * public/mask.mp4 (same fps/frame count as the source), for the
 * ForegroundPop composition to sample alongside the color video.
 *
 * MediaPipe's model ships its own WASM + tflite weights inside the
 * @mediapipe/selfie_segmentation npm package (no CDN needed), but the JS API
 * only runs in a browser (WebGL + WASM), so this drives it headlessly via
 * Playwright instead of Node's TFJS bindings.
 *
 * While it's already got the color frame + mask decoded in the browser, this
 * also samples the dominant (circular-mean) hue of the foreground region and
 * writes src/data/scene-colors.json: one complementary "target hue" per frame
 * for the background to be recolored toward, so the fore/background color
 * contrast adapts to whatever the subject is actually wearing/colored like
 * in that shot, instead of a fixed hue.
 *
 * Usage:
 *   node scripts/generate-mask.js
 *   node scripts/generate-mask.js --input=public/input2.mp4 \
 *     --mask-out=public/mask2.mp4 --colors-out=src/data/scene-colors2.json \
 *     --frames=370
 *
 * All flags are optional and default to the original input.mp4 pipeline.
 * --width/--height default to the composition's 1080x1920 output size (the
 * source is scaled down to this during frame extraction); --frames defaults
 * to 216 (the original clip's frame count at 30fps) — pass the real frame
 * count for a differently-timed source video.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}
const argv = parseArgs();

const ROOT = path.join(__dirname, "..");
const FFMPEG = path.join(
  ROOT,
  "node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg",
);
const CHROME_EXECUTABLE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MP_DIR = path.join(ROOT, "node_modules/@mediapipe/selfie_segmentation");
const INPUT = path.join(ROOT, argv.input || "public/input.mp4");
const OUTPUT_MASK = path.join(ROOT, argv["mask-out"] || "public/mask.mp4");
const OUTPUT_COLORS = path.join(
  ROOT,
  argv["colors-out"] || "src/data/scene-colors.json",
);
const SCRATCH = path.join(
  ROOT,
  argv.scratch || ".mask-scratch",
);
const FRAMES_DIR = path.join(SCRATCH, "frames");
const MASKS_DIR = path.join(SCRATCH, "masks");

const WIDTH = Number(argv.width || 1080);
const HEIGHT = Number(argv.height || 1920);
const FPS = Number(argv.fps || 30);
const FRAME_COUNT = Number(argv.frames || 216);
const MP_SERVER_PORT = Number(argv.port || 8934);

// Downsampled canvas used only for the per-frame dominant-hue estimate —
// full resolution isn't needed for a color average and would be much slower
// to loop over in JS.
const ANALYSIS_WIDTH = 135;
const ANALYSIS_HEIGHT = 240;
// Ignore near-gray pixels (they have unstable/meaningless hue) when
// estimating the foreground's dominant color.
const ANALYSIS_MIN_SATURATION = 0.15;
// How much weight a frame's own dominant hue carries against its neighbors
// when smoothing the hue sequence over time (higher = less smoothing).
const HUE_SMOOTHING_ALPHA = 0.25;
// Fallback hue (degrees) used if a frame has no confidently-colored
// foreground pixels at all (e.g. very first frame, or nothing detected yet).
const FALLBACK_HUE_DEG = 210;

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
}

function extractFrames() {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  console.log("Extracting frames...");
  run(FFMPEG, [
    "-y",
    "-i",
    INPUT,
    "-vsync",
    "0",
    "-frames:v",
    String(FRAME_COUNT),
    "-vf",
    `scale=${WIDTH}:${HEIGHT}`,
    "-start_number",
    "0",
    path.join(FRAMES_DIR, "frame_%04d.png"),
  ]);
}

function serveMediapipeAssets() {
  const server = http.createServer((req, res) => {
    const filePath = path.join(MP_DIR, decodeURIComponent(req.url.split("?")[0]));
    if (!filePath.startsWith(MP_DIR)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Access-Control-Allow-Origin": "*" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(MP_SERVER_PORT, "127.0.0.1", () => resolve(server));
  });
}

async function segmentFrames() {
  fs.mkdirSync(MASKS_DIR, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME_EXECUTABLE });
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({
    url: `http://127.0.0.1:${MP_SERVER_PORT}/selfie_segmentation.js`,
  });

  // Instantiate the model once and reuse it across all frames.
  await page.evaluate(
    async (port) => {
      // eslint-disable-next-line no-undef
      const seg = new SelfieSegmentation({
        locateFile: (file) => `http://127.0.0.1:${port}/${file}`,
      });
      seg.setOptions({ modelSelection: 1 });
      window.__seg = seg;
      window.__ready = new Promise((resolve) => {
        seg.onResults((results) => {
          window.__lastResults = results;
          if (window.__onResult) window.__onResult();
        });
      });
      // Warm up so the wasm/model is loaded before timing frames.
      const warm = new Image();
      await new Promise((resolveWarm, rejectWarm) => {
        warm.onload = async () => {
          await seg.send({ image: warm });
          resolveWarm();
        };
        warm.onerror = rejectWarm;
        warm.src =
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      });
    },
    MP_SERVER_PORT,
  );

  const start = Date.now();
  const foregroundHues = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const framePath = path.join(
      FRAMES_DIR,
      `frame_${String(i).padStart(4, "0")}.png`,
    );
    const base64 = fs.readFileSync(framePath).toString("base64");

    const { maskDataUrl, hueDeg } = await page.evaluate(
      async ({ b64, analysisW, analysisH, minSat }) => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = async () => {
            window.__onResult = () => {
              window.__onResult = null;
              const results = window.__lastResults;
              const maskImg = results.segmentationMask;

              const canvas = document.createElement("canvas");
              canvas.width = maskImg.width;
              canvas.height = maskImg.height;
              const ctx = canvas.getContext("2d");
              // Composite over black: the mask's alpha channel encodes the
              // (already-antialiased) foreground probability, so after
              // compositing over black the red channel IS that value 0-255.
              ctx.fillStyle = "black";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(maskImg, 0, 0);
              const maskDataUrl = canvas.toDataURL("image/png");

              // Downsampled analysis pass: weighted circular-mean hue of the
              // foreground region (mask * saturation as weight, so gray /
              // background-leaking pixels barely count).
              const colorCanvas = document.createElement("canvas");
              colorCanvas.width = analysisW;
              colorCanvas.height = analysisH;
              const colorCtx = colorCanvas.getContext("2d");
              colorCtx.drawImage(img, 0, 0, analysisW, analysisH);
              const colorData = colorCtx.getImageData(
                0,
                0,
                analysisW,
                analysisH,
              ).data;

              const maskCanvas = document.createElement("canvas");
              maskCanvas.width = analysisW;
              maskCanvas.height = analysisH;
              const maskCtx = maskCanvas.getContext("2d");
              maskCtx.drawImage(canvas, 0, 0, analysisW, analysisH);
              const maskData = maskCtx.getImageData(
                0,
                0,
                analysisW,
                analysisH,
              ).data;

              let sumSin = 0;
              let sumCos = 0;
              let sumWeight = 0;
              const pixelCount = analysisW * analysisH;
              for (let p = 0; p < pixelCount; p++) {
                const o = p * 4;
                const r = colorData[o] / 255;
                const g = colorData[o + 1] / 255;
                const b = colorData[o + 2] / 255;
                const maskVal = maskData[o] / 255;

                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const d = max - min;
                const sat = max === 0 ? 0 : d / max;
                if (sat < minSat) continue;

                let hue;
                if (d === 0) hue = 0;
                else if (max === r) hue = ((g - b) / d) % 6;
                else if (max === g) hue = (b - r) / d + 2;
                else hue = (r - g) / d + 4;
                hue *= 60;
                if (hue < 0) hue += 360;

                const weight = maskVal * sat;
                if (weight <= 0) continue;
                const rad = (hue * Math.PI) / 180;
                sumSin += Math.sin(rad) * weight;
                sumCos += Math.cos(rad) * weight;
                sumWeight += weight;
              }

              let hueDeg = null;
              if (sumWeight > 0.001) {
                let deg = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
                if (deg < 0) deg += 360;
                hueDeg = deg;
              }

              resolve({ maskDataUrl, hueDeg });
            };
            try {
              await window.__seg.send({ image: img });
            } catch (e) {
              reject(String(e));
            }
          };
          img.onerror = () => reject("img load error");
          img.src = "data:image/png;base64," + b64;
        });
      },
      { b64: base64, analysisW: ANALYSIS_WIDTH, analysisH: ANALYSIS_HEIGHT, minSat: ANALYSIS_MIN_SATURATION },
    );

    const outBuf = Buffer.from(maskDataUrl.split(",")[1], "base64");
    fs.writeFileSync(
      path.join(MASKS_DIR, `mask_${String(i).padStart(4, "0")}.png`),
      outBuf,
    );
    foregroundHues.push(hueDeg);

    if (i % 20 === 0 || i === FRAME_COUNT - 1) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  frame ${i + 1}/${FRAME_COUNT} (${elapsed}s elapsed)`);
    }
  }

  await browser.close();
  return foregroundHues;
}

// Circular (hue-aware) exponential moving average, with null frames (no
// confident foreground color) filled by holding the last known value.
function smoothHueSequence(rawHues) {
  let lastValid = rawHues.find((h) => h !== null);
  if (lastValid === undefined) lastValid = FALLBACK_HUE_DEG;

  let avgSin = Math.sin((lastValid * Math.PI) / 180);
  let avgCos = Math.cos((lastValid * Math.PI) / 180);

  return rawHues.map((h) => {
    const sample = h === null ? lastValid : h;
    const rad = (sample * Math.PI) / 180;
    avgSin =
      avgSin * (1 - HUE_SMOOTHING_ALPHA) + Math.sin(rad) * HUE_SMOOTHING_ALPHA;
    avgCos =
      avgCos * (1 - HUE_SMOOTHING_ALPHA) + Math.cos(rad) * HUE_SMOOTHING_ALPHA;
    let deg = (Math.atan2(avgSin, avgCos) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    if (h !== null) lastValid = h;
    return deg;
  });
}

function writeSceneColors(rawHues) {
  const smoothed = smoothHueSequence(rawHues);
  const backgroundTargetHueDeg = smoothed.map((h) => (h + 180) % 360);

  fs.mkdirSync(path.dirname(OUTPUT_COLORS), { recursive: true });
  fs.writeFileSync(
    OUTPUT_COLORS,
    JSON.stringify(backgroundTargetHueDeg, null, 0),
  );
  console.log("Wrote", OUTPUT_COLORS);
}

function encodeMaskVideo() {
  console.log("Encoding mask.mp4...");
  run(FFMPEG, [
    "-y",
    "-framerate",
    String(FPS),
    "-start_number",
    "0",
    "-i",
    path.join(MASKS_DIR, "mask_%04d.png"),
    "-frames:v",
    String(FRAME_COUNT),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "18",
    OUTPUT_MASK,
  ]);
}

async function main() {
  extractFrames();
  const server = await serveMediapipeAssets();
  let foregroundHues;
  try {
    foregroundHues = await segmentFrames();
  } finally {
    server.close();
  }
  encodeMaskVideo();
  writeSceneColors(foregroundHues);
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  console.log("Done:", OUTPUT_MASK);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
