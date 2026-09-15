// Arm A (anonymous) report driver: open /report?repo=<r>, wait for the live scan to land,
// then capture the address bar, a permalink sweep, and per-dimension provenance DOM.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const repo = process.argv[2] ?? "sindresorhus/p-limit";
const tag = process.argv[3] ?? "armA-report";
const outDir = (process.env.SHOT_DIR ?? "uat/_shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1400 } });
const t0 = Date.now();
await page.goto(`${BASE}/report?repo=${encodeURIComponent(repo)}`, { waitUntil: "domcontentloaded", timeout: 60000 });

// Wait for the score to render (report landed) — hard fail after 10 min.
let landed = false;
for (let i = 0; i < 120; i++) {
  const txt = await page.locator("body").innerText().catch(() => "");
  if (/Maturity index|Dimensions\b/i.test(txt) && !/Asking Claude|Composing your report/i.test(txt)) { landed = true; break; }
  await page.waitForTimeout(5000);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`landed=${landed} after ${secs}s`);
console.log("url:", page.url());

await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}${tag}.png`, fullPage: true });
writeFileSync(`${outDir}${tag}.aria.yaml`, await page.locator("body").ariaSnapshot());
writeFileSync(`${outDir}${tag}.text.txt`, (await page.locator("body").innerText()).slice(0, 30000));

// Permalink sweep across the whole DOM
const perma = await page.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll("a[href],button")) {
    const href = el.getAttribute("href") ?? "";
    const t = (el.textContent ?? "").trim().slice(0, 80);
    if (/\/report\/[^?\s]+\/[^?\s]+/.test(href) || /permalink|copy link|share/i.test(t)) hits.push({ tag: el.tagName, href, text: t });
  }
  return hits;
});
console.log("PERMALINK SWEEP:", JSON.stringify(perma));
writeFileSync(`${outDir}${tag}.permalink.json`, JSON.stringify({ url: page.url(), hits: perma }, null, 2));

await browser.close();
