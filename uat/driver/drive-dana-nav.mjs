import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const SLUG = process.argv[2] ?? "vercel";
const outDir = "uat/runs/undefined/shots/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
await page.goto(`${BASE}/org/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(800);

const groups = ["Overview", "Fleet", "Intel", "Plan", "Library", "Govern"];
for (const g of groups) {
  try {
    const btn = page.getByRole("button", { name: new RegExp("^" + g) }).first();
    await btn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
  } catch (e) {
    console.log(`could not click group ${g}:`, String(e).split("\n")[0]);
  }
}
await page.waitForTimeout(500);
const ariaSnap = await page.locator("body").ariaSnapshot();
writeFileSync(`${outDir}nav-expanded.aria.yaml`, ariaSnap);
await page.screenshot({ path: `${outDir}04-nav-expanded.png`, fullPage: true });

// Time click-to-executive/briefing from a fresh landing
await page.goto(`${BASE}/org/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(500);
// Expand Overview group (Briefing lives there per earlier scan)
try {
  await page.getByRole("button", { name: /^Overview/ }).first().click({ timeout: 3000 });
} catch {}
await page.waitForTimeout(200);
const t0 = Date.now();
try {
  await page.getByRole("link", { name: /^Briefing$/i }).first().click({ timeout: 5000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const t1 = Date.now();
  console.log(`CLICK(expand+click)-TO-BRIEFING latency: ${t1 - t0}ms; URL: ${page.url()}`);
  await page.screenshot({ path: `${outDir}05-briefing.png`, fullPage: true });
  writeFileSync(`${outDir}05-briefing.text.txt`, (await page.locator("body").innerText()).slice(0, 12000));
} catch (e) {
  console.log("BRIEFING CLICK FAILED:", String(e).split("\n")[0]);
}

await browser.close();
console.log("DONE");
