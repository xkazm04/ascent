// Bespoke L2 driver for Sam × "scan my repo, get a roadmap"
// Journey: land on / -> paste repo -> submit -> watch SSE progress live -> report -> tabs -> badge check.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const REPO = process.env.REPO ?? "expressjs/express";
const outDir = (process.env.SHOT_DIR ?? "uat/runs/undefined/shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });

const journal = [];
const log = (msg) => { const line = `[${new Date().toISOString()}] ${msg}`; console.log(line); journal.push(line); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });

log(`Landing on ${BASE}/`);
const t0 = Date.now();
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}01-landing.png`, fullPage: true });
writeFileSync(`${outDir}01-landing.text.txt`, (await page.locator("body").innerText()).slice(0, 4000));

log("Clicking 'Scan a repository' to open the scan modal");
await page.getByRole("button", { name: /scan a repository/i }).first().click({ timeout: 15000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}01b-modal.png`, fullPage: true });

log(`Finding the scan input, typing ${REPO}`);
const input = page.getByLabel("GitHub repository").first();
await input.waitFor({ state: "visible", timeout: 30000 });
await input.click();
await input.fill(REPO);
await page.screenshot({ path: `${outDir}02-typed.png`, fullPage: true });

log("Submitting scan");
const submitStart = Date.now();
await page.getByRole("button", { name: /scan/i }).first().click().catch(async () => {
  await page.keyboard.press("Enter");
});

// Now on /report?repo=... — poll for progress text every 4s, capture what stage/message shows.
let sawProgressText = new Set();
let reportReady = false;
let elapsedAtReady = null;
const MAX_MS = 12 * 60 * 1000; // 12 min budget
let pollCount = 0;
while (Date.now() - submitStart < MAX_MS) {
  await page.waitForTimeout(4000);
  pollCount++;
  const url = page.url();
  const text = await page.locator("body").innerText().catch(() => "");
  const snippet = text.slice(0, 500).replace(/\s+/g, " ");
  if (pollCount <= 3 || pollCount % 5 === 0) {
    log(`poll#${pollCount} t+${Math.round((Date.now()-submitStart)/1000)}s url=${url} text="${snippet}"`);
  }
  sawProgressText.add(snippet);
  if (pollCount === 2) {
    await page.screenshot({ path: `${outDir}03-progress-early.png`, fullPage: true }).catch(() => {});
  }
  if (pollCount === 8) {
    await page.screenshot({ path: `${outDir}04-progress-mid.png`, fullPage: true }).catch(() => {});
  }
  // Heuristic: report ready when Scoring/Dimension/Roadmap tabs or score ring visible
  const hasReportChrome = /Scoring|Dimensions|Roadmap|Sandbox/i.test(text) && /Overall|Level|Score/i.test(text);
  if (hasReportChrome && !/Scanning|Analyzing|Reading files|Running detectors/i.test(text)) {
    reportReady = true;
    elapsedAtReady = Date.now() - submitStart;
    log(`Report appears ready at t+${Math.round(elapsedAtReady/1000)}s`);
    break;
  }
}

if (!reportReady) {
  log(`TIMEOUT: report did not render within ${MAX_MS/1000}s`);
}

await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}05-report-scoring.png`, fullPage: true });
writeFileSync(`${outDir}05-report-scoring.text.txt`, (await page.locator("body").innerText()).slice(0, 12000));
writeFileSync(`${outDir}05-report-scoring.aria.yaml`, await page.locator("body").ariaSnapshot().catch(() => ""));

// Click Dimensions tab
log("Opening Dimensions tab");
try {
  await page.getByRole("tab", { name: /Dimensions/i }).click({ timeout: 5000 });
} catch {
  try { await page.getByRole("button", { name: /Dimensions/i }).click({ timeout: 5000 }); } catch (e2) { log("Dimensions tab click failed: " + String(e2).split("\n")[0]); }
}
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}06-dimensions.png`, fullPage: true });
writeFileSync(`${outDir}06-dimensions.text.txt`, (await page.locator("body").innerText()).slice(0, 14000));
writeFileSync(`${outDir}06-dimensions.aria.yaml`, await page.locator("body").ariaSnapshot().catch(() => ""));

// Try to expand first dimension card to see evidence + provenance
log("Expanding a dimension card for evidence");
try {
  const card = page.locator('[class*="dimension" i], button, [role="button"]').filter({ hasText: /D1|D2|D3|D4|D5|D6|D7|D8|D9/ }).first();
  await card.click({ timeout: 5000 });
  await page.waitForTimeout(800);
} catch (e) { log("dimension card expand failed: " + String(e).split("\n")[0]); }
await page.screenshot({ path: `${outDir}07-dimension-detail.png`, fullPage: true });
writeFileSync(`${outDir}07-dimension-detail.text.txt`, (await page.locator("body").innerText()).slice(0, 14000));
writeFileSync(`${outDir}07-dimension-detail.aria.yaml`, await page.locator("body").ariaSnapshot().catch(() => ""));

// Roadmap tab
log("Opening Roadmap tab");
try {
  await page.getByRole("tab", { name: /Roadmap/i }).click({ timeout: 5000 });
} catch {
  try { await page.getByRole("button", { name: /Roadmap/i }).click({ timeout: 5000 }); } catch (e2) { log("Roadmap tab click failed: " + String(e2).split("\n")[0]); }
}
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}08-roadmap.png`, fullPage: true });
writeFileSync(`${outDir}08-roadmap.text.txt`, (await page.locator("body").innerText()).slice(0, 14000));
writeFileSync(`${outDir}08-roadmap.aria.yaml`, await page.locator("body").ariaSnapshot().catch(() => ""));

// Look for a badge link anywhere on report page (search all tab bodies + header)
log("Searching for a /badge link on the report");
const allLinks = await page.locator("a[href*='badge']").all();
let badgeLinks = [];
for (const l of allLinks) {
  badgeLinks.push({ href: await l.getAttribute("href"), text: (await l.innerText()).slice(0, 60) });
}
log(`badge links found: ${JSON.stringify(badgeLinks)}`);

const totalElapsed = Date.now() - t0;
log(`Total elapsed from landing to report-ready: ${Math.round(totalElapsed/1000)}s`);

writeFileSync(`${outDir}journal.log`, journal.join("\n"));
writeFileSync(`${outDir}badge-links.json`, JSON.stringify({ badgeLinks, reportReady, elapsedAtReadySec: elapsedAtReady ? Math.round(elapsedAtReady/1000) : null, totalElapsedSec: Math.round(totalElapsed/1000), finalUrl: page.url() }, null, 2));

console.log("DONE");
await browser.close();
