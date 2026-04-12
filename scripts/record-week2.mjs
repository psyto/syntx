import puppeteer from "puppeteer";
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTX_ROOT = join(__dirname, "..");
const FRAMES_DIR = join(__dirname, "frames");
const OUTPUT = join(__dirname, "week2-update.mp4");
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

// ---------------------------------------------------------------------------
// Read source files
// ---------------------------------------------------------------------------

function readSrc(rel) {
  return readFileSync(join(SYNTX_ROOT, rel), "utf-8");
}

const phoenixAdapter = readSrc("keeper/src/venues/phoenix.ts");
const jupiterAdapter = readSrc("keeper/src/venues/jupiter.ts");
const routerTs = readSrc("keeper/src/venues/router.ts");
const clientTs = readSrc("sdk/src/client.ts");
const libRs = readSrc("programs/syntx-vault/src/lib.rs");

// ---------------------------------------------------------------------------
// HTML slides
// ---------------------------------------------------------------------------

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function codeSlide(title, subtitle, code, highlightLines = []) {
  const lines = code.split("\n");
  const numberedLines = lines
    .map((line, i) => {
      const num = i + 1;
      const hl = highlightLines.includes(num);
      return `<div class="line${hl ? " hl" : ""}"><span class="ln">${String(num).padStart(3)}</span>${escHtml(line)}</div>`;
    })
    .join("");

  return `
    <div class="slide">
      <div class="header">
        <div class="title">${escHtml(title)}</div>
        <div class="subtitle">${escHtml(subtitle)}</div>
      </div>
      <div class="code-container">
        <pre class="code">${numberedLines}</pre>
      </div>
    </div>
  `;
}

function titleSlide(title, subtitle, bullets = []) {
  const bulletHtml = bullets.map((b) => `<div class="bullet">${escHtml(b)}</div>`).join("");
  return `
    <div class="slide title-slide">
      <div class="logo">SYNTX</div>
      <div class="main-title">${escHtml(title)}</div>
      <div class="main-subtitle">${escHtml(subtitle)}</div>
      <div class="bullets">${bulletHtml}</div>
    </div>
  `;
}

function screenshotSlide(title, subtitle, imgDescription) {
  return `
    <div class="slide">
      <div class="header">
        <div class="title">${escHtml(title)}</div>
        <div class="subtitle">${escHtml(subtitle)}</div>
      </div>
      <div class="screenshot-placeholder">
        <div class="screenshot-text">${escHtml(imgDescription)}</div>
      </div>
    </div>
  `;
}

function statSlide(title, stats) {
  const statsHtml = stats.map(s => `
    <div class="stat-card">
      <div class="stat-value">${escHtml(s.value)}</div>
      <div class="stat-label">${escHtml(s.label)}</div>
    </div>
  `).join("");
  return `
    <div class="slide title-slide">
      <div class="logo">SYNTX</div>
      <div class="main-title" style="font-size:42px;margin-bottom:32px">${escHtml(title)}</div>
      <div class="stats-grid">${statsHtml}</div>
    </div>
  `;
}

// Extract timelock code (lines 647-682 of lib.rs)
const timelockCode = libRs.split("\n").slice(646, 682).join("\n");
// Extract immutable floor code (lines 693-722 of lib.rs)
const floorCode = libRs.split("\n").slice(692, 722).join("\n");

const slides = [
  // Slide 0: Title
  titleSlide(
    "Week 2 Update",
    "Composable Exchange-Agnostic Vaults on Solana",
    [
      "3 venue adapters — 3 architectures (slab, CLOB, oracle-AMM)",
      "VenueRouter — multi-venue smart routing",
      "48h timelock + immutable circuit breaker floor",
      "27 tests, 17 instructions, full SDK",
    ]
  ),

  // Slide 1: Phoenix adapter
  codeSlide(
    "venues/phoenix.ts",
    "Phoenix V1 — CLOB orderbook architecture",
    phoenixAdapter.split("\n").slice(0, 55).join("\n"),
    [23, 24, 25, 42, 43, 44, 45, 46, 47]
  ),

  // Slide 2: Jupiter Perps adapter
  codeSlide(
    "venues/jupiter.ts",
    "Jupiter Perps — oracle-based AMM architecture (3rd venue, 3rd architecture)",
    jupiterAdapter.split("\n").slice(0, 55).join("\n"),
    [22, 23, 24, 25, 69, 70, 71]
  ),

  // Slide 3: VenueRouter
  codeSlide(
    "venues/router.ts",
    "VenueRouter scores all 3 venues and routes to best execution",
    routerTs.split("\n").slice(0, 55).join("\n"),
    [15, 16, 17, 18, 19, 22, 23, 30]
  ),

  // Slide 4: 48h Timelock
  codeSlide(
    "lib.rs — Manager Transfer Timelock",
    "Studied Drift exploit → proactively added 48h delay on manager transfer",
    timelockCode,
    [1, 2, 3, 14, 15, 20]
  ),

  // Slide 5: Immutable circuit breaker floor
  codeSlide(
    "lib.rs — Immutable Circuit Breaker Floor",
    "min_drawdown_bps set at creation — manager can never reduce below this",
    floorCode,
    [1, 2, 3, 15, 16, 17, 18]
  ),

  // Slide 6: Stats
  statSlide("Week 2 Progress", [
    { value: "3", label: "Architectures" },
    { value: "4", label: "Venue Adapters" },
    { value: "27", label: "Tests Passing" },
    { value: "48h", label: "Manager Timelock" },
    { value: "17", label: "Anchor Instructions" },
    { value: "5", label: "Frontend Pages" },
  ]),

  // Slide 7: Also this week
  titleSlide(
    "Also This Week",
    "Frontend, SDK, Security, Documentation",
    [
      "Landing + compose reframed: 3 architectures, venue diagram",
      "Vault UX: named vaults, Max button, toasts, dollar withdraw",
      "SDK complete: buildDepositTx, buildWithdrawTx",
      "CPI examples, venue adapter skeleton, business plan",
    ]
  ),

  // Slide 8: Closing
  titleSlide(
    "Next Week",
    "Final polish + submission materials",
    [
      "Demo video (2-3 min product walkthrough)",
      "Pitch video (3 min business case)",
      "Final code cleanup + devnet freshness",
      "Submit on Colosseum by May 10",
    ]
  ),
];

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    overflow: hidden;
    background: #0a0e14;
    color: #e0e0e0;
    font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  }
  .slide {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    padding: 40px 60px;
    visibility: hidden;
    opacity: 0;
  }
  .slide.active { visibility: visible; opacity: 1; }

  /* Title slide */
  .title-slide {
    justify-content: center;
    align-items: center;
    text-align: center;
  }
  .logo {
    font-size: 24px;
    letter-spacing: 8px;
    color: #22d3ee;
    margin-bottom: 40px;
    font-weight: 300;
  }
  .main-title {
    font-size: 56px;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .main-subtitle {
    font-size: 22px;
    color: #8899aa;
    margin-bottom: 48px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .bullets {
    text-align: left;
    display: inline-block;
  }
  .bullet {
    font-size: 20px;
    color: #b0bec5;
    padding: 8px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .bullet::before {
    content: "→ ";
    color: #22d3ee;
  }

  /* Stats grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
    max-width: 700px;
  }
  .stat-card {
    background: #0d1117;
    border: 1px solid #1a2030;
    border-radius: 12px;
    padding: 24px;
    text-align: center;
  }
  .stat-value {
    font-size: 48px;
    font-weight: 700;
    color: #22d3ee;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .stat-label {
    font-size: 14px;
    color: #6a7a8a;
    margin-top: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  /* Code slide */
  .header {
    margin-bottom: 20px;
    border-bottom: 1px solid #1a2030;
    padding-bottom: 16px;
  }
  .title {
    font-size: 28px;
    color: #22d3ee;
    font-weight: 600;
  }
  .subtitle {
    font-size: 16px;
    color: #6a7a8a;
    margin-top: 6px;
  }
  .code-container {
    flex: 1;
    overflow: hidden;
    border-radius: 8px;
    background: #0d1117;
    border: 1px solid #1a2030;
  }
  .code {
    font-size: 14px;
    line-height: 1.5;
    padding: 20px;
    overflow: hidden;
  }
  .line { white-space: pre; }
  .line.hl {
    background: rgba(34, 211, 238, 0.08);
    border-left: 3px solid #22d3ee;
    margin-left: -3px;
  }
  .ln {
    color: #3a4a5a;
    margin-right: 16px;
    user-select: none;
  }

  /* Screenshot placeholder */
  .screenshot-placeholder {
    flex: 1;
    border-radius: 12px;
    background: #0d1117;
    border: 1px solid #1a2030;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .screenshot-text {
    font-size: 24px;
    color: #3a4a5a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  /* Fade transition */
  .slide { transition: opacity 0.3s ease; }
</style>
</head>
<body>
${slides.map((s, i) => {
  const activeClass = i === 0 ? " active" : "";
  return s.replace(/<div class="slide/, `<div id="slide-${i}" class="slide${activeClass}`);
}).join("\n")}
<script>
  let current = 0;
  const total = ${slides.length};

  window.goToSlide = function(n) {
    if (n === current || n < 0 || n >= total) return;
    const prev = document.getElementById("slide-" + current);
    const next = document.getElementById("slide-" + n);
    if (prev) prev.classList.remove("active");
    if (next) next.classList.add("active");
    current = n;
  };

  window.scrollCode = function(slideIdx, scrollTop) {
    const slide = document.getElementById("slide-" + slideIdx);
    if (!slide) return;
    const container = slide.querySelector(".code-container");
    if (container) container.scrollTop = scrollTop;
  };
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const timeline = [
  [0, 7000],   // Title: 7s
  [1, 7000],   // Phoenix adapter: 7s
  [2, 7000],   // Jupiter adapter: 7s
  [3, 7000],   // VenueRouter: 7s
  [4, 7000],   // Timelock: 7s
  [5, 6000],   // Immutable floor: 6s
  [6, 6000],   // Stats: 6s
  [7, 7000],   // Also this week: 7s
  [8, 6000],   // Closing: 6s
];

async function record() {
  if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR, { recursive: true });

  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: [`--window-size=${WIDTH},${HEIGHT}`],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 500));

  console.log("Recording frames...");
  let frameNum = 0;
  const frameInterval = 1000 / FPS;

  for (const [slideIdx, durationMs] of timeline) {
    console.log(`  Slide ${slideIdx}: ${durationMs}ms`);
    await page.evaluate((n) => window.goToSlide(n), slideIdx);
    await new Promise((r) => setTimeout(r, 100));

    const frames = Math.ceil(durationMs / frameInterval);
    for (let f = 0; f < frames; f++) {
      const path = join(FRAMES_DIR, `frame_${String(frameNum).padStart(6, "0")}.png`);
      await page.screenshot({ path });
      frameNum++;

      // Scroll code slides
      if ([1, 2, 3, 4, 5].includes(slideIdx)) {
        const scrollProgress = f / frames;
        const maxScroll = 300;
        const scrollTop = Math.floor(scrollProgress * maxScroll);
        await page.evaluate(
          (idx, top) => window.scrollCode(idx, top),
          slideIdx,
          scrollTop
        );
      }
    }
  }

  console.log(`Captured ${frameNum} frames`);
  await browser.close();

  console.log("Compiling video with ffmpeg...");
  const ffmpegCmd = [
    "ffmpeg -y",
    `-framerate ${FPS}`,
    `-i "${join(FRAMES_DIR, "frame_%06d.png")}"`,
    "-c:v libx264",
    "-preset medium",
    "-crf 23",
    "-pix_fmt yuv420p",
    "-movflags +faststart",
    `"${OUTPUT}"`,
  ].join(" ");

  execSync(ffmpegCmd, { stdio: "inherit" });

  rmSync(FRAMES_DIR, { recursive: true });
  console.log(`\nDone! Video saved to: ${OUTPUT}`);
}

record().catch((err) => {
  console.error("Recording failed:", err);
  process.exit(1);
});
