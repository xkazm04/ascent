// Bespoke L2 driver for Tomas x evaluate-whether-to-adopt.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = (process.env.SHOT_DIR ?? "uat/runs/undefined/shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1400 } });

async function capture(shot) {
  await page.screenshot({ path: `${outDir}${shot}.png`, fullPage: true });
  writeFileSync(`${outDir}${shot}.text.txt`, (await page.locator("body").innerText()).slice(0, 12000));
  writeFileSync(`${outDir}${shot}.aria.yaml`, await page.locator("body").ariaSnapshot());
  console.log(`captured ${shot}`);
}

// 1. Landing
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1000);
await capture("01-landing");

// 2. About
await page.goto(BASE + "/about", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1000);
await capture("02-about");

// 3. Pricing
await page.goto(BASE + "/pricing", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1000);
await capture("03-pricing");

// 4. Start scan of vercel/next.js via direct nav (equivalent to ScanForm submit)
const scanStart = Date.now();
await page.goto(BASE + "/report?repo=vercel%2Fnext.js&fresh=1", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1500);
await capture("04-scan-start");

// Poll every 15s up to 12 minutes, logging progress text and screenshotting at intervals
const MAX_MS = 12 * 60 * 1000;
let shots = 0;
while (Date.now() - scanStart < MAX_MS) {
  await page.waitForTimeout(15000);
  const t = await page.locator("body").innerText().catch(() => "");
  const elapsedSec = Math.round((Date.now() - scanStart) / 1000);
  const pctMatch = t.match(/(\d{1,3})%/);
  const pct = pctMatch ? pctMatch[1] : null;
  console.log(`[t=${elapsedSec}s] pct=${pct} snippet=${t.slice(0, 150).replace(/\n/g, " | ")}`);
  if (elapsedSec % 60 < 15 && shots < 15) {
    shots++;
    await page.screenshot({ path: `${outDir}progress-${elapsedSec}s.png`, fullPage: false }).catch(() => {});
  }
  const isScanning = /Scanning/i.test(t);
  const hasScore = /\b\d{1,3}\s*\/\s*100\b/.test(t);
  if (hasScore && !isScanning) {
    console.log(`DONE at t=${elapsedSec}s`);
    break;
  }
  if (/error|failed|not found/i.test(t) && !isScanning) {
    console.log(`POSSIBLE ERROR at t=${elapsedSec}s: ${t.slice(0,300)}`);
  }
}

const totalElapsed = Math.round((Date.now() - scanStart) / 1000);
console.log(`TOTAL SCAN WALL CLOCK: ${totalElapsed}s`);
await capture("05-scan-final");

await browser.close();
