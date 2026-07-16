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
 * Usage: node scripts/generate-mask.js
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const FFMPEG = path.join(
  ROOT,
  "node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg",
);
const CHROME_EXECUTABLE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MP_DIR = path.join(ROOT, "node_modules/@mediapipe/selfie_segmentation");
const INPUT = path.join(ROOT, "public/input.mp4");
const OUTPUT_MASK = path.join(ROOT, "public/mask.mp4");
const SCRATCH = path.join(ROOT, ".mask-scratch");
const FRAMES_DIR = path.join(SCRATCH, "frames");
const MASKS_DIR = path.join(SCRATCH, "masks");

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const FRAME_COUNT = 216;
const MP_SERVER_PORT = 8934;

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
  for (let i = 0; i < FRAME_COUNT; i++) {
    const framePath = path.join(
      FRAMES_DIR,
      `frame_${String(i).padStart(4, "0")}.png`,
    );
    const base64 = fs.readFileSync(framePath).toString("base64");

    const outDataUrl = await page.evaluate(async (b64) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = async () => {
          window.__onResult = () => {
            window.__onResult = null;
            const results = window.__lastResults;
            const canvas = document.createElement("canvas");
            canvas.width = results.segmentationMask.width;
            canvas.height = results.segmentationMask.height;
            const ctx = canvas.getContext("2d");
            // Composite over black: the mask's alpha channel encodes the
            // (already-antialiased) foreground probability, so after
            // compositing over black the red channel IS that value 0-255.
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(results.segmentationMask, 0, 0);
            resolve(canvas.toDataURL("image/png"));
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
    }, base64);

    const outBuf = Buffer.from(outDataUrl.split(",")[1], "base64");
    fs.writeFileSync(
      path.join(MASKS_DIR, `mask_${String(i).padStart(4, "0")}.png`),
      outBuf,
    );

    if (i % 20 === 0 || i === FRAME_COUNT - 1) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  frame ${i + 1}/${FRAME_COUNT} (${elapsed}s elapsed)`);
    }
  }

  await browser.close();
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
  try {
    await segmentFrames();
  } finally {
    server.close();
  }
  encodeMaskVideo();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  console.log("Done:", OUTPUT_MASK);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
