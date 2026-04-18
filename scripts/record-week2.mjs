import puppeteer from "puppeteer";
import { mkdirSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = join(__dirname, "frames");
const OUTPUT = join(__dirname, "week2-update.mp4");
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const BASE_URL = "http://localhost:3000/vaults";

// ---------------------------------------------------------------------------
// HTML slide generators
// ---------------------------------------------------------------------------

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
.main-title { font-size:52px; font-weight:700; color:#fff; margin-bottom:16px; }
.main-subtitle { font-size:22px; color:#8899aa; margin-bottom:48px; }
.bullets { text-align:left; display:inline-block; }
.bullet { font-size:20px; color:#b0bec5; padding:8px 0; }
.bullet::before { content:"→ "; color:#22d3ee; }
</style></head><body>
<div class="logo">SYNTX</div>
<div class="main-title">${esc(title)}</div>
<div class="main-subtitle">${esc(subtitle)}</div>
<div class="bullets">${bulletHtml}</div>
</body></html>`;
}

function terminalHtml(title, lines) {
  const colored = lines.map(l => {
    const e = esc(l);
    if (l.includes("SUCCEEDED")) return `<span style="color:#27c93f;font-weight:bold">${e}</span>`;
    if (l.includes("tx:")) return `<span style="color:#27c93f">${e}</span>`;
    if (l.includes("===")) return `<span style="color:#22d3ee">${e}</span>`;
    return e;
  });
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { width:${WIDTH}px; height:${HEIGHT}px; background:#0a0e14; color:#e0e0e0;
  font-family:'SF Mono','Fira Code',monospace; display:flex; flex-direction:column; padding:40px 60px; }
.header { margin-bottom:20px; border-bottom:1px solid #1a2030; padding-bottom:16px; }
.title { font-size:28px; color:#22d3ee; font-weight:600; }
.subtitle { font-size:16px; color:#6a7a8a; margin-top:6px; }
.terminal { flex:1; border-radius:12px; overflow:hidden; border:1px solid #2a3040; background:#0d1117; }
.terminal-bar { background:#1a2030; padding:12px 16px; display:flex; align-items:center; gap:8px; }
.dot { width:12px; height:12px; border-radius:50%; display:inline-block; }
.dot.red { background:#ff5f56; } .dot.yellow { background:#ffbd2e; } .dot.green { background:#27c93f; }
.terminal-title { color:#6a7a8a; margin-left:12px; font-size:14px; }
.terminal-body { padding:24px; font-size:15px; line-height:1.7; color:#b0bec5; white-space:pre; }
</style></head><body>
<div class="header">
  <div class="title">${esc(title)}</div>
  <div class="subtitle">Localnet — solana-test-validator</div>
</div>
<div class="terminal">
  <div class="terminal-bar">
    <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
    <span class="terminal-title">syntx/keeper</span>
  </div>
  <div class="terminal-body">${colored.join("\n")}</div>
</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const timeline = [
  // 0:00-0:08 — Title
  {
    type: "html", duration: 8000,
    html: titleHtml("Week 2 Update", "Shielded Cross-Venue Perp Execution", [
      "Encrypted intent routing across venues",
      "Principal-protected SOL vault (delta hedge)",
      "Standalone vault mode (no Percolator lock-in)",
      "Real TradeCpi through privacy matcher",
    ]),
  },

  // 0:08-0:18 — Trade page
  { type: "page", duration: 10000, url: `${BASE_URL}/trade` },

  // 0:18-0:28 — Earn page
  { type: "page", duration: 10000, url: `${BASE_URL}/earn` },

  // 0:28-0:38 — Build page
  { type: "page", duration: 10000, url: `${BASE_URL}/build` },

  // 0:38-0:52 — Terminal: real TradeCpi
  {
    type: "html", duration: 14000,
    html: terminalHtml("Real Intent Execution — Privacy Matcher", [
      "$ SOLANA_RPC_URL=http://localhost:8899 npx ts-node src/setup-intent.ts",
      "",
      "=== Step 1: Collateral mint ===",
      "Mint: 9kA7WEHbdttdGRRcxqjVxAkox1qyNB1X6ZkMNZCFuNzP",
      "",
      "=== Step 3: InitMarket ===",
      "InitMarket tx: tCSgxwvYGASrZZWw3u2v...NfYiz5",
      "",
      "=== Step 4: InitLP ===",
      "Matcher context: 3KPhBXZSCQrUwREjNnPE...yw97yG",
      "InitLP tx: 58wGHS5doPpmLVg9VuYj...3UPma",
      "",
      "=== Step 5: InitUser ===",
      "InitUser tx: 2st9i2MfrekQtnd75Y1y...xmT",
      "",
      "=== Step 6: Init privacy matcher ===",
      "LP PDA for matcher: 5iTdSGvKvrFVGnNHckRG...Vve7Q",
      "",
      "=== Step 7: Push oracle price ===",
      "Push oracle tx: 3zogcMQLtF95RJPKQ...qB1u",
      "",
      "=== Step 8: Test TradeCpi ===",
      "LP PDA: 5iTdSGvKvrFVGnNHckRGZzYexkRVFyzuPyCAiR8Vve7Q",
      "TradeCpi tx: 4JzDnvPjH27kbV53pK72AFeWnkULpSQthkH49D85AHqS",
      "",
      "=== REAL INTENT EXECUTION SUCCEEDED! ===",
    ]),
  },

  // 0:52-0:60 — Closing
  {
    type: "html", duration: 8000,
    html: titleHtml("Next Week", "Demo video, pitch video, final submission", [
      "Connect Trade page to real on-chain execution",
      "Deploy to devnet",
      "Record demo + pitch videos",
      "Submit on Colosseum",
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

  for (let t = 0; t < timeline.length; t++) {
    const entry = timeline[t];
    console.log(`  Scene ${t}: ${entry.type} (${entry.duration}ms)`);

    if (entry.type === "html") {
      await page.setContent(entry.html, { waitUntil: "domcontentloaded" });
    } else if (entry.type === "page") {
      try {
        await page.goto(entry.url, { waitUntil: "networkidle0", timeout: 10000 });
      } catch {
        // networkidle0 may timeout, page is still loaded
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    await new Promise(r => setTimeout(r, 500)); // Let render settle

    const frames = Math.ceil(entry.duration / frameInterval);
    for (let f = 0; f < frames; f++) {
      const path = join(FRAMES_DIR, `frame_${String(frameNum).padStart(6, "0")}.png`);
      await page.screenshot({ path });
      frameNum++;

      // Slow scroll on live pages
      if (entry.type === "page") {
        const progress = f / frames;
        await page.evaluate((top) => window.scrollTo(0, top), Math.floor(progress * 500));
      }
    }
  }

  console.log(`Captured ${frameNum} frames`);
  await browser.close();

  // Compile video
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
