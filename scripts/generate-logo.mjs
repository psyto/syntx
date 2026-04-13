import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZE = 512;

// Generate both icon (512x512) and banner (1200x630)
const configs = [
  { name: "logo-icon.png", width: SIZE, height: SIZE, type: "icon" },
  { name: "logo-banner.png", width: 1200, height: 630, type: "banner" },
];

function makeHtml(type, width, height) {
  if (type === "icon") {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px; height: ${height}px;
    background: #050a0e;
    display: flex; align-items: center; justify-content: center;
  }
</style></head><body>
<svg width="360" height="360" viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Outer hexagon -->
  <polygon points="200,60 300,110 300,210 200,260 100,210 100,110"
    fill="none" stroke="#22d3ee" stroke-width="4" opacity="0.8"/>
  <!-- Inner hexagon -->
  <polygon points="200,90 270,125 270,195 200,230 130,195 130,125"
    fill="#22d3ee" fill-opacity="0.06" stroke="#22d3ee" stroke-width="2" opacity="0.4"/>

  <!-- Three venue lines -->
  <line x1="40" y1="40" x2="130" y2="115" stroke="#22d3ee" stroke-width="3" opacity="0.6"/>
  <circle cx="32" cy="32" r="12" fill="#22d3ee" fill-opacity="0.15" stroke="#22d3ee" stroke-width="2" opacity="0.5"/>

  <line x1="360" y1="40" x2="270" y2="115" stroke="#22d3ee" stroke-width="3" opacity="0.6"/>
  <circle cx="368" cy="32" r="12" fill="#22d3ee" fill-opacity="0.15" stroke="#22d3ee" stroke-width="2" opacity="0.5"/>

  <line x1="200" y1="370" x2="200" y2="260" stroke="#22d3ee" stroke-width="3" opacity="0.6"/>
  <circle cx="200" cy="380" r="12" fill="#22d3ee" fill-opacity="0.15" stroke="#22d3ee" stroke-width="2" opacity="0.5"/>

  <!-- Center S -->
  <text x="200" y="178" text-anchor="middle" fill="#22d3ee" font-size="72" font-weight="700"
    font-family="-apple-system, BlinkMacSystemFont, sans-serif">S</text>
</svg>
</body></html>`;
  }

  // Banner
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px; height: ${height}px;
    background: #050a0e;
    display: flex; align-items: center; justify-content: center; gap: 60px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }
</style></head><body>
<svg width="240" height="240" viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
  <polygon points="200,60 300,110 300,210 200,260 100,210 100,110"
    fill="none" stroke="#22d3ee" stroke-width="4" opacity="0.8"/>
  <polygon points="200,90 270,125 270,195 200,230 130,195 130,125"
    fill="#22d3ee" fill-opacity="0.06" stroke="#22d3ee" stroke-width="2" opacity="0.4"/>
  <line x1="40" y1="40" x2="130" y2="115" stroke="#22d3ee" stroke-width="3" opacity="0.6"/>
  <circle cx="32" cy="32" r="12" fill="#22d3ee" fill-opacity="0.15" stroke="#22d3ee" stroke-width="2" opacity="0.5"/>
  <line x1="360" y1="40" x2="270" y2="115" stroke="#22d3ee" stroke-width="3" opacity="0.6"/>
  <circle cx="368" cy="32" r="12" fill="#22d3ee" fill-opacity="0.15" stroke="#22d3ee" stroke-width="2" opacity="0.5"/>
  <line x1="200" y1="370" x2="200" y2="260" stroke="#22d3ee" stroke-width="3" opacity="0.6"/>
  <circle cx="200" cy="380" r="12" fill="#22d3ee" fill-opacity="0.15" stroke="#22d3ee" stroke-width="2" opacity="0.5"/>
  <text x="200" y="178" text-anchor="middle" fill="#22d3ee" font-size="72" font-weight="700"
    font-family="-apple-system, BlinkMacSystemFont, sans-serif">S</text>
</svg>
<div>
  <div style="font-size:72px;font-weight:700;color:#fff;letter-spacing:8px">SYNTX</div>
  <div style="font-size:20px;color:#6a7a8a;letter-spacing:3px;margin-top:12px">COMPOSABLE EXCHANGE-AGNOSTIC VAULTS</div>
</div>
</body></html>`;
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });

  for (const cfg of configs) {
    const page = await browser.newPage();
    await page.setViewport({ width: cfg.width, height: cfg.height });
    await page.setContent(makeHtml(cfg.type, cfg.width, cfg.height), { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 300));
    const path = join(__dirname, "..", cfg.name);
    await page.screenshot({ path });
    console.log(`Saved: ${cfg.name} (${cfg.width}x${cfg.height})`);
    await page.close();
  }

  await browser.close();
}

main().catch(console.error);
