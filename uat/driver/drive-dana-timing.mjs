import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const SLUG = process.argv[2] ?? "vercel";
const outDir = "uat/runs/undefined/shots/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });

// Fresh landing (already seeded from earlier run)
await page.goto(`${BASE}/org/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);

// Click "Briefing" directly — visible by default since Overview group is pre-expanded
const t0 = Date.now();
await page.getByRole("link", { name: /^Briefing$/i }).first().click({ timeout: 5000 });
await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(300);
const t1 = Date.now();
console.log(`CLICK-TO-BRIEFING (Executive/forecast page) latency: ${t1 - t0}ms; URL: ${page.url()}`);
await page.screenshot({ path: `${outDir}06-briefing-page.png`, fullPage: true });
writeFileSync(`${outDir}06-briefing-page.text.txt`, (await page.locator("body").innerText()).slice(0, 15000));
writeFileSync(`${outDir}06-briefing-page.aria.yaml`, await page.locator("body").ariaSnapshot());

// Back to overview, then click into Intel group -> Teams
await page.goto(`${BASE}/org/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(400);
const t2 = Date.now();
await page.getByRole("button", { name: /^Intel/ }).first().click({ timeout: 3000 });
await page.waitForTimeout(250);
await page.getByRole("link", { name: /^Teams/i }).first().click({ timeout: 5000 });
await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(300);
const t3 = Date.now();
console.log(`CLICK(expand Intel + click Teams)-TO-TEAMS latency: ${t3 - t2}ms; URL: ${page.url()}`);
await page.screenshot({ path: `${outDir}07-teams-page.png`, fullPage: true });
writeFileSync(`${outDir}07-teams-page.text.txt`, (await page.locator("body").innerText()).slice(0, 15000));

await browser.close();
console.log("DONE");
