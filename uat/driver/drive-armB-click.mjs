// Arm B: navigate, click one named button (tab), capture. Usage:
//   node uat/driver/drive-armB-click.mjs <path> <buttonNameRegex> <shot>
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const [path, name, shot = "click"] = process.argv.slice(2);
const outDir = (process.env.SHOT_DIR ?? "uat/_shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);
await page.getByRole("button", { name: new RegExp(name) }).first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}${shot}.png`, fullPage: true });
writeFileSync(`${outDir}${shot}.aria.yaml`, await page.locator("body").ariaSnapshot());
writeFileSync(`${outDir}${shot}.text.txt`, (await page.locator("body").innerText()).slice(0, 60000));
console.log(`captured ${shot} <- ${page.url()}`);
await browser.close();
