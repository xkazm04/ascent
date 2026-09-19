import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const SLUG = process.argv[2] ?? "vercel";
const outDir = "uat/runs/undefined/shots/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });

const groups = ["Overview", "Fleet", "Intel", "Plan", "Library", "Govern"];
let report = [];
for (const g of groups) {
  await page.goto(`${BASE}/org/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(400);
  try {
    await page.getByRole("button", { name: new RegExp("^" + g) }).first().click({ timeout: 3000 });
    await page.waitForTimeout(300);
    const links = await page.locator('nav[aria-label="Organization sections"] a').allInnerTexts();
    report.push(`GROUP ${g}: ${JSON.stringify(links)}`);
  } catch (e) {
    report.push(`GROUP ${g}: ERROR ${String(e).split("\n")[0]}`);
  }
}
writeFileSync(`${outDir}nav-groups-report.txt`, report.join("\n"));
console.log(report.join("\n"));
await browser.close();
