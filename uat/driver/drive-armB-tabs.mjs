// Arm B multi-tab capture: navigate a list of paths in one chromium session,
// capture png + aria + text for each. Usage:
//   node uat/driver/drive-armB-tabs.mjs "<path>|<shot>" "<path>|<shot>" ...
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = (process.env.SHOT_DIR ?? "uat/_shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
for (const arg of process.argv.slice(2)) {
  const [path, shot] = arg.split("|");
  await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}${shot}.png`, fullPage: true });
  writeFileSync(`${outDir}${shot}.aria.yaml`, await page.locator("body").ariaSnapshot());
  writeFileSync(`${outDir}${shot}.text.txt`, (await page.locator("body").innerText()).slice(0, 60000));
  console.log(`captured ${shot} <- ${page.url()}`);
}
await browser.close();
