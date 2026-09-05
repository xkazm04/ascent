// Bespoke L2 driver for Dana × prove-and-track-fleet-maturity.
// Times click-to-executive and click-to-teams latency, captures nav labels,
// and pulls fleet vs team headline numbers for reconciliation.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SLUG = process.argv[2] ?? "vercel";
const outDir = (process.env.SHOT_DIR ?? "uat/runs/undefined/shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });

async function capture(name) {
  await page.screenshot({ path: `${outDir}${name}.png`, fullPage: true });
  writeFileSync(`${outDir}${name}.aria.yaml`, await page.locator("body").ariaSnapshot());
  writeFileSync(`${outDir}${name}.text.txt`, (await page.locator("body").innerText()).slice(0, 12000));
}

// --- Visit 1: seed the developer profile (per env.md, first visit seeds) ---
await page.goto(`${BASE}/org/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(800);

// --- Visit 2: the "real" Dana landing, timed ---
const t0 = Date.now();
await page.goto(`${BASE}/org/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(500);
const tOverviewReady = Date.now();
await capture("01-overview");
console.log(`OVERVIEW load: ${tOverviewReady - t0}ms`);

// Grab nav labels visible in the org shell
const navText = await page.locator("nav, header").allInnerTexts();
writeFileSync(`${outDir}nav-labels.txt`, navText.join("\n---\n"));
console.log("NAV TEXT SNIPPET:", navText.join(" | ").slice(0, 500));

// --- Click to Executive ---
const tExecClickStart = Date.now();
let execFound = true;
try {
  await page.getByRole("link", { name: /^Executive$/i }).first().click({ timeout: 5000 });
} catch (e) {
  execFound = false;
  console.log("EXECUTIVE LINK NOT FOUND BY ROLE:", String(e).split("\n")[0]);
}
if (execFound) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const tExecReady = Date.now();
  await capture("02-executive");
  console.log(`CLICK-TO-EXECUTIVE latency: ${tExecReady - tExecClickStart}ms; URL: ${page.url()}`);
}

// --- Navigate back to overview, then click to Teams ---
await page.goto(`${BASE}/org/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(500);
const tTeamsClickStart = Date.now();
let teamsFound = true;
try {
  await page.getByRole("link", { name: /^Teams$/i }).first().click({ timeout: 5000 });
} catch (e) {
  teamsFound = false;
  console.log("TEAMS LINK NOT FOUND BY ROLE:", String(e).split("\n")[0]);
}
if (teamsFound) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const tTeamsReady = Date.now();
  await capture("03-teams");
  console.log(`CLICK-TO-TEAMS latency: ${tTeamsReady - tTeamsClickStart}ms; URL: ${page.url()}`);
}

await browser.close();
console.log("DONE");
