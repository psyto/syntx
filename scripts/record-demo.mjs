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
const BASE_URL = "http://localhost:3000/vaults";

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function titleHtml(title, subtitle, bullets) {
  const bulletHtml = bullets.map(b => `<div class="bullet">${esc(b)}</div>`).join("");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { width:${WIDTH}px; height:${HEIGHT}px; background:#0a0e14; color:#e0e0e0;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; }
.logo { font-size:24px; letter-spacing:8px; color:#22d3ee; margin-bottom:40px; font-weight:300;
  font-family:'SF Mono','Fira Code',monospace; }
.main-title { font-size:48px; font-weight:700; color:#fff; margin-bottom:16px; line-height:1.2; }
.main-subtitle { font-size:20px; color:#8899aa; margin-bottom:48px; max-width:700px; line-height:1.5; }
.bullets { text-align:left; display:inline-block; }
.bullet { font-size:18px; color:#b0bec5; padding:6px 0; }
.bullet::before { content:"→ "; color:#22d3ee; }
</style></head><body>
<div class="logo">SYNTX</div>
<div class="main-title">${esc(title)}</div>
<div class="main-subtitle">${esc(subtitle)}</div>
<div class="bullets">${bulletHtml}</div>
</body></html>`;
}

async function captureFrames(page, count) {
  const frames = [];
  const frameInterval = 1000 / FPS;
  for (let f = 0; f < count; f++) {
    frames.push(f);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Timeline — 3 minute demo
// ---------------------------------------------------------------------------

const timeline = [
  // 0:00-0:08 — Title
  { type: "html", duration: 8000, html: titleHtml("Syntx Demo", "Shielded Cross-Venue Perp Execution on Solana", []) },

  // 0:08-0:13 — Landing page
  { type: "page", duration: 5000, url: `${BASE_URL}/` },

  // 0:13-0:30 — Trade page (intent form)
  { type: "page", duration: 17000, url: `${BASE_URL}/trade` },

  // 0:30-0:50 — Submit intent + see result
  {
    type: "action", duration: 20000, url: `${BASE_URL}/trade`,
    actions: async (page) => {
      // Type 1000 into size input
      const inputs = await page.$$("input[type='number']");
      if (inputs[0]) {
        await inputs[0].click({ clickCount: 3 });
        await inputs[0].type("1000");
      }
      await new Promise(r => setTimeout(r, 1000));

      // Click Submit
      const buttons = await page.$$("button");
      for (const btn of buttons) {
        const text = await btn.evaluate(el => el.textContent);
        if (text?.includes("Submit Shielded Intent")) {
          await btn.click();
          break;
        }
      }
      await new Promise(r => setTimeout(r, 5000));
    },
  },

  // 0:50-1:00 — Trade page how-it-works (scroll down)
  { type: "scroll", duration: 10000, target: 900 },

  // 1:00-1:20 — Earn page (Principal Protected tab)
  { type: "page", duration: 20000, url: `${BASE_URL}/earn` },

  // 1:20-1:30 — Earn page scroll to allocation
  { type: "scroll", duration: 10000, target: 500 },

  // 1:30-1:50 — Build page
  { type: "page", duration: 20000, url: `${BASE_URL}/build` },

  // 1:50-2:05 — Build page scroll to VenueAdapter
  { type: "scroll", duration: 15000, target: 800 },

  // 2:05-2:20 — Build page scroll to preview + roadmap
  { type: "scroll", duration: 15000, target: 1400 },

  // 2:20-2:40 — Stats
  {
    type: "html", duration: 20000,
    html: titleHtml("What We Built", "All real. All on-chain. All open-source.", [
      "18 Anchor instructions, 32+ tests",
      "5 venue adapters across 4 architectures",
      "Privacy matcher — real TradeCpi execution",
      "Delta hedge strategy (Black-Scholes option replication)",
      "Standalone vault mode (no venue lock-in)",
      "3 keeper strategies (funding rate, structured, intent)",
    ]),
  },

  // 2:40-3:00 — Closing
  {
    type: "html", duration: 20000,
    html: titleHtml("Syntx", "Shielded cross-venue perp execution. Structured products. Composable vault layer.", [
      "GitHub: github.com/psyto/syntx",
      "Live: fabrknt.com/vaults",
      "Built by @psyto for Solana Frontier Hackathon",
    ]),
  },
];

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

async function record() {
  if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR, { recursive: true });

  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: [`--window-size=${WIDTH},${HEIGHT}`, "--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  let frameNum = 0;
  const frameInterval = 1000 / FPS;
  let currentScroll = 0;

  for (let t = 0; t < timeline.length; t++) {
    const entry = timeline[t];
    console.log(`  Scene ${t}: ${entry.type} (${entry.duration}ms)${entry.url ? " " + entry.url : ""}`);

    if (entry.type === "html") {
      await page.setContent(entry.html, { waitUntil: "domcontentloaded" });
      currentScroll = 0;
    } else if (entry.type === "page") {
      try {
        await page.goto(entry.url, { waitUntil: "networkidle0", timeout: 10000 });
      } catch {
        await new Promise(r => setTimeout(r, 2000));
      }
      currentScroll = 0;
    } else if (entry.type === "action") {
      if (entry.url) {
        try {
          await page.goto(entry.url, { waitUntil: "networkidle0", timeout: 10000 });
        } catch {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      currentScroll = 0;
      if (entry.actions) await entry.actions(page);
    }

    await new Promise(r => setTimeout(r, 300));

    const frames = Math.ceil(entry.duration / frameInterval);
    for (let f = 0; f < frames; f++) {
      // Smooth scroll for scroll entries
      if (entry.type === "scroll") {
        const progress = f / frames;
        const targetScroll = entry.target || 0;
        const newScroll = currentScroll + (targetScroll - currentScroll) * progress;
        await page.evaluate((top) => window.scrollTo(0, top), Math.floor(newScroll));
      }

      const path = join(FRAMES_DIR, `frame_${String(frameNum).padStart(6, "0")}.png`);
      await page.screenshot({ path });
      frameNum++;
    }

    // Update scroll position after entry
    if (entry.type === "scroll") {
      currentScroll = entry.target || 0;
    }
  }

  console.log(`Captured ${frameNum} frames`);
  await browser.close();

  console.log("Compiling video...");
  execSync([
    "ffmpeg -y",
    `-framerate ${FPS}`,
    `-i "${join(FRAMES_DIR, "frame_%06d.png")}"`,
    "-c:v libx264 -preset medium -crf 23",
    "-pix_fmt yuv420p -movflags +faststart",
    `"${OUTPUT}"`,
  ].join(" "), { stdio: "inherit" });

  rmSync(FRAMES_DIR, { recursive: true });
  console.log(`\nDone! Video saved to: ${OUTPUT}`);
}

record().catch(err => {
  console.error("Recording failed:", err);
  process.exit(1);
});
