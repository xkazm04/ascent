// Arm C: open the loop cockpit's Outcome sheet, click one RUN column to load that run's
// detail (which is what mounts CockpitVerdicts + any economics rendering), and capture
// FULL text (no 9000-char truncation — the price list lives at the page bottom).
//
// Usage: node uat/driver/drive-armC-openrun.mjs <path> <runLabelRegex> <shot>
//   e.g.  node uat/driver/drive-armC-openrun.mjs "/org/kiro?tab=live" "RUN 2" armC-run2
// Pass "-" as the label to capture without clicking.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const [path, label = "-", shot = "armC-run"] = process.argv.slice(2);
const outDir = (process.env.SHOT_DIR ?? "uat/_shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1800 } });
const netLog = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/org/loop")) netLog.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, "")}`);
});
await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

if (label !== "-") {
  const target = page.getByRole("button", { name: new RegExp(label, "i") }).first();
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 8000 });
    await target.click({ timeout: 8000 });
    console.log("clicked:", label);
  } catch (e) {
    console.log("click failed:", String(e).split("\n")[0]);
  }
  await page.waitForTimeout(3000);
}

// Walk the whole page so lazy/virtualized rows render before the capture.
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 600) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 60));
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(800);

await page.screenshot({ path: `${outDir}${shot}.png`, fullPage: true });
writeFileSync(`${outDir}${shot}.aria.yaml`, await page.locator("body").ariaSnapshot());
writeFileSync(`${outDir}${shot}.text.txt`, await page.locator("body").innerText());
writeFileSync(`${outDir}${shot}.net.txt`, netLog.join("\n"));
console.log("url:", page.url());
console.log("loop API calls:", netLog.length);
console.log(`captured: ${shot}.{png,aria.yaml,text.txt,net.txt} in ${outDir}`);
await browser.close();
