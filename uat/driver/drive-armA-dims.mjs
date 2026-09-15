// Arm A: open the cached report, switch to Dimensions, expand each dimension, and dump
// every provenance SVG (aria-label, <title> children, guardband rect geometry) + evidence lines.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const repo = process.argv[2] ?? "sindresorhus/p-limit";
const tag = process.argv[3] ?? "armA-dims";
const outDir = (process.env.SHOT_DIR ?? "uat/_shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1600 } });
await page.goto(`${BASE}/report?repo=${encodeURIComponent(repo)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
for (let i = 0; i < 90; i++) {
  const t = await page.locator("body").innerText().catch(() => "");
  if (/Score waterfall|WHY THIS SCORE/i.test(t)) break;
  await page.waitForTimeout(4000);
}
await page.getByRole("button", { name: /^Dimensions$/ }).first().click();
await page.waitForTimeout(1200);
// expand everything expandable
for (const b of await page.locator('[aria-expanded="false"]').all()) { await b.click().catch(() => {}); await page.waitForTimeout(120); }
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}${tag}.png`, fullPage: true });
writeFileSync(`${outDir}${tag}.aria.yaml`, await page.locator("body").ariaSnapshot());
writeFileSync(`${outDir}${tag}.text.txt`, (await page.locator("body").innerText()).slice(0, 40000));
const svgs = await page.evaluate(() => [...document.querySelectorAll("svg[role='img']")].map((s) => ({
  label: s.getAttribute("aria-label"),
  titles: [...s.querySelectorAll("title")].map((t) => t.textContent),
  rects: [...s.querySelectorAll("rect")].map((r) => ({ x: r.getAttribute("x"), w: r.getAttribute("width"), op: r.getAttribute("opacity") })),
})).filter((s) => (s.label ?? "").startsWith("Score provenance")));
writeFileSync(`${outDir}${tag}.provenance.json`, JSON.stringify(svgs, null, 2));
console.log("provenance tracks:", svgs.length);
console.log(JSON.stringify(svgs, null, 1).slice(0, 4000));
await browser.close();
