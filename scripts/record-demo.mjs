import puppeteer from "puppeteer";
import { mkdirSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = join(__dirname, "frames");
const OUTPUT = join(__dirname, "demo-video.mp4");
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const BASE_URL = "https://syntx.fabrknt.com/vaults";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Title card HTML
function titleCard(title, subtitle) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; background: #050a0e;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .title { font-size: 48px; font-weight: 700; color: #fff; margin-bottom: 16px; }
  .sub { font-size: 24px; color: #6a7a8a; }
</style></head><body>
<div class="title">${title}</div>
<div class="sub">${subtitle}</div>
</body></html>`;
}

async function captureFrames(page, durationMs, frameNum) {
  const frames = Math.ceil(durationMs / (1000 / FPS));
  for (let f = 0; f < frames; f++) {
    await page.screenshot({ path: join(FRAMES_DIR, `frame_${String(frameNum++).padStart(6, "0")}.png`) });
  }
  return frameNum;
}

async function captureScrollFrames(page, durationMs, scrollDist, frameNum) {
  const frames = Math.ceil(durationMs / (1000 / FPS));
  for (let f = 0; f < frames; f++) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.floor((f / frames) * scrollDist));
    await page.screenshot({ path: join(FRAMES_DIR, `frame_${String(frameNum++).padStart(6, "0")}.png`) });
  }
  return frameNum;
}

async function showTitleCard(page, title, subtitle, durationMs, frameNum) {
  await page.setContent(titleCard(title, subtitle), { waitUntil: "domcontentloaded" });
  await sleep(100);
  return captureFrames(page, durationMs, frameNum);
}

async function record() {
  if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: true, args: [`--window-size=${WIDTH},${HEIGHT}`] });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  let fn = 0;

  // === Title: Intro ===
  console.log("Title: Intro");
  fn = await showTitleCard(page,
    "Syntx — Product Demo",
    "Composable Exchange-Agnostic Vaults on Solana", 3000, fn);

  // === Scene 1: Landing hero ===
  console.log("Scene 1: Landing");
  fn = await showTitleCard(page, "1. Landing Page", "Three architectures, one vault", 2000, fn);
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 20000 });
  await sleep(1000);
  fn = await captureFrames(page, 3000, fn);
  fn = await captureScrollFrames(page, 4000, 1400, fn);

  // === Scene 2: Venue routing diagram ===
  console.log("Scene 2: Venue routing");
  fn = await showTitleCard(page, "2. Exchange-Agnostic Routing", "Percolator · Phoenix · Jupiter Perps", 2000, fn);
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, 1200));
  await sleep(500);
  fn = await captureFrames(page, 4000, fn);

  // === Scene 3: Vault marketplace ===
  console.log("Scene 3: Vaults");
  fn = await showTitleCard(page, "3. Vault Marketplace", "Named vaults with venue badges", 2000, fn);
  await page.goto(`${BASE_URL}/vaults`, { waitUntil: "networkidle2", timeout: 20000 });
  await sleep(2000);
  fn = await captureFrames(page, 3000, fn);
  // Click first vault
  try {
    const buttons = await page.$$("button");
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes("Funding Rate") || text.includes("Delta Neutral")) {
        await btn.click();
        await sleep(1500);
        break;
      }
    }
  } catch {}
  fn = await captureScrollFrames(page, 4000, 400, fn);

  // === Scene 4: Compose page ===
  console.log("Scene 4: Compose");
  fn = await showTitleCard(page, "4. Composability", "CPI interface + architecture diagram", 2000, fn);
  await page.goto(`${BASE_URL}/compose`, { waitUntil: "networkidle2", timeout: 20000 });
  await sleep(1000);
  fn = await captureFrames(page, 2000, fn);
  // Scroll to architecture diagram
  fn = await captureScrollFrames(page, 5000, 3500, fn);

  // === Scene 5: CPI code ===
  console.log("Scene 5: CPI code");
  fn = await showTitleCard(page, "5. CPI Interface", "Any Solana program can trade through Syntx vaults", 2000, fn);
  await page.goto(`${BASE_URL}/compose`, { waitUntil: "networkidle2", timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, 4000));
  await sleep(500);
  fn = await captureFrames(page, 4000, fn);

  // === Closing ===
  console.log("Closing");
  fn = await showTitleCard(page,
    "Syntx",
    "15 instructions · 29 tests · 4 venue adapters · 3 architectures", 2000, fn);
  fn = await showTitleCard(page,
    "github.com/psyto/syntx",
    "fabrknt.com/vaults · @psyto", 3000, fn);

  console.log(`Captured ${fn} frames`);
  await browser.close();

  console.log("Compiling...");
  execSync([
    "ffmpeg -y",
    `-framerate ${FPS}`,
    `-i "${join(FRAMES_DIR, "frame_%06d.png")}"`,
    "-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart",
    `"${OUTPUT}"`,
  ].join(" "), { stdio: "inherit" });

  rmSync(FRAMES_DIR, { recursive: true });
  console.log(`\nDone! ${OUTPUT}`);
}

record().catch(err => { console.error(err); process.exit(1); });
