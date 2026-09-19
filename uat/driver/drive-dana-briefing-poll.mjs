import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const outDir = "uat/runs/undefined/shots/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
const t0 = Date.now();
await page.goto("http://localhost:3000/org/vercel/executive", { waitUntil: "domcontentloaded", timeout: 60000 });

let settled = false;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);
  const text = await page.locator("body").innerText();
  const elapsed = Date.now() - t0;
  const hasForecast = /forecast|leverage|move to make|trajectory|Adoption vs|Rigor/i.test(text);
  console.log(`t+${elapsed}ms: len=${text.length} hasForecastLike=${hasForecast}`);
  if (hasForecast && text.length > 800) {
    settled = true;
    writeFileSync(`${outDir}08-briefing-settled.text.txt`, text.slice(0, 15000));
    await page.screenshot({ path: `${outDir}08-briefing-settled.png`, fullPage: true });
    console.log(`SETTLED at t+${elapsed}ms`);
    break;
  }
}
if (!settled) {
  writeFileSync(`${outDir}09-briefing-neversettled.text.txt`, (await page.locator("body").innerText()).slice(0, 15000));
  await page.screenshot({ path: `${outDir}09-briefing-neversettled.png`, fullPage: true });
  console.log("NEVER SETTLED within 20s");
}
await browser.close();
