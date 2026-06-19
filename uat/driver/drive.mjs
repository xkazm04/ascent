// Portable UAT browser driver — app-agnostic. Drives one route in chromium and
// captures a screenshot + ARIA snapshot + visible text, so the Character (the LLM)
// can perceive the page and decide the next action. Optionally clicks one control.
//
// Usage (run from the repo root, via the Bash / Git-Bash tool):
//   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:3100 \
//     SHOT_DIR=uat/runs/<id>/shots node uat/driver/drive.mjs /path shotName [clickRoleName]
//   (or set E2E_PORT instead of BASE_URL; BASE_URL defaults to http://localhost:3000)
//
// Gotchas this bakes in (all bit the pilot — keep them):
//   • MSYS_NO_PATHCONV=1 stops Git Bash mangling a leading-slash path arg into a
//     Windows path (e.g. "/dashboard" → "C:/Program Files/Git/dashboard").
//   • Playwright ≥1.50 REMOVED page.accessibility.snapshot() — use ariaSnapshot().
//   • waitUntil:'networkidle' can hang forever on a dev server (HMR keeps a socket
//     open) — wait for 'domcontentloaded' then best-effort settle, never block on it.
//   • For multi-step flows (fill a form, sort, then analyze) write a short bespoke
//     driver next to this one; this covers the common navigate-capture-[click] step.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
const [path = "/", shot = "page", clickName] = process.argv.slice(2);
const outDir = (process.env.SHOT_DIR ?? "uat/_shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1200 } });
await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(600);

if (clickName) {
  try {
    await page.getByRole("button", { name: new RegExp(clickName) }).first().click();
    await page.waitForTimeout(800);
  } catch (e) {
    console.log("click failed:", String(e).split("\n")[0]);
  }
}

await page.screenshot({ path: `${outDir}${shot}.png`, fullPage: true });
writeFileSync(`${outDir}${shot}.aria.yaml`, await page.locator("body").ariaSnapshot());
writeFileSync(`${outDir}${shot}.text.txt`, (await page.locator("body").innerText()).slice(0, 9000));
console.log("title:", await page.title());
console.log("url:", page.url());
console.log(`captured: ${shot}.{png,aria.yaml,text.txt} in ${outDir}`);
await browser.close();
