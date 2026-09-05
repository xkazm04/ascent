// Quick capture-only pass against an already-scanned (now cached) report — used because the
// live drive-sam.mjs's "report ready" text heuristic got stuck on a page section it didn't expect.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const REPO = process.env.REPO ?? "expressjs/express";
const outDir = (process.env.SHOT_DIR ?? "uat/runs/undefined/shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });

await page.goto(`${BASE}/report?repo=${encodeURIComponent(REPO)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}sam-05-report-scoring.png`, fullPage: true });
writeFileSync(`${outDir}sam-05-report-scoring.text.txt`, (await page.locator("body").innerText()).slice(0, 16000));
writeFileSync(`${outDir}sam-05-report-scoring.aria.yaml`, await page.locator("body").ariaSnapshot().catch(() => ""));

// Dimensions tab
try { await page.getByRole("tab", { name: /Dimensions/i }).click({ timeout: 5000 }); }
catch { try { await page.getByRole("button", { name: /Dimensions/i }).click({ timeout: 5000 }); } catch {} }
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}sam-06-dimensions.png`, fullPage: true });
writeFileSync(`${outDir}sam-06-dimensions.text.txt`, (await page.locator("body").innerText()).slice(0, 16000));
writeFileSync(`${outDir}sam-06-dimensions.aria.yaml`, await page.locator("body").ariaSnapshot().catch(() => ""));

// Expand a dimension card
try {
  const card = page.locator('button, [role="button"]').filter({ hasText: /D1|D2|D3|D4|D5|D6|D7|D8|D9/ }).first();
  await card.click({ timeout: 5000 });
  await page.waitForTimeout(800);
} catch {}
await page.screenshot({ path: `${outDir}sam-07-dimension-detail.png`, fullPage: true });
writeFileSync(`${outDir}sam-07-dimension-detail.text.txt`, (await page.locator("body").innerText()).slice(0, 16000));
writeFileSync(`${outDir}sam-07-dimension-detail.aria.yaml`, await page.locator("body").ariaSnapshot().catch(() => ""));

// Roadmap tab
try { await page.getByRole("tab", { name: /Roadmap/i }).click({ timeout: 5000 }); }
catch { try { await page.getByRole("button", { name: /Roadmap/i }).click({ timeout: 5000 }); } catch {} }
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}sam-08-roadmap.png`, fullPage: true });
writeFileSync(`${outDir}sam-08-roadmap.text.txt`, (await page.locator("body").innerText()).slice(0, 16000));
writeFileSync(`${outDir}sam-08-roadmap.aria.yaml`, await page.locator("body").ariaSnapshot().catch(() => ""));

// Badge links anywhere on the report
const allLinks = await page.locator("a[href*='badge']").all();
let badgeLinks = [];
for (const l of allLinks) badgeLinks.push({ href: await l.getAttribute("href"), text: (await l.innerText()).slice(0, 60) });
writeFileSync(`${outDir}sam-badge-links.json`, JSON.stringify({ badgeLinks, finalUrl: page.url() }, null, 2));

console.log("badgeLinks:", JSON.stringify(badgeLinks));
console.log("DONE CAPTURE");
await browser.close();
