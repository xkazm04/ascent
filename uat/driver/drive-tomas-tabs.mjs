import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = (process.env.SHOT_DIR ?? "uat/runs/undefined/shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1400 } });

await page.goto(BASE + "/report?repo=vercel%2Fnext.js", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3000);

async function capture(shot) {
  await page.screenshot({ path: `${outDir}${shot}.png`, fullPage: true });
  writeFileSync(`${outDir}${shot}.text.txt`, (await page.locator("body").innerText()).slice(0, 14000));
  console.log(`captured ${shot}`);
}

await capture("06-report-cached-load");

// Click Dimensions tab
try {
  await page.getByRole("button", { name: /^Dimensions$/ }).first().click();
  await page.waitForTimeout(1000);
  await capture("07-dimensions-tab");
  // expand first dimension row
  const rows = await page.locator('button[aria-expanded]').all();
  if (rows.length > 0) {
    await rows[0].click();
    await page.waitForTimeout(600);
    await capture("08-dimension-expanded");
  }
} catch (e) {
  console.log("dimensions tab failed:", String(e).split("\n")[0]);
}

// Click Roadmap tab
try {
  await page.getByRole("button", { name: /^Roadmap$/ }).first().click();
  await page.waitForTimeout(1000);
  await capture("09-roadmap-tab");
} catch (e) {
  console.log("roadmap tab failed:", String(e).split("\n")[0]);
}

await browser.close();
