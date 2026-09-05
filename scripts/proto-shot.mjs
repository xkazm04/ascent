// Dev-only: screenshot each landing prototype tab at desktop + mobile widths for visual review.
// Usage: node scripts/proto-shot.mjs [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve } from "path";

const base = process.argv[2] || process.env.BASE || "http://localhost:3001";
const outDir = resolve(process.cwd(), ".proto-shots");
mkdirSync(outDir, { recursive: true });

const tabs = [
  ["altimeter", "Altimeter"],
  ["flightdeck", "Flight Deck"],
  ["index", "The Index"],
  ["baseline", "Baseline"],
];
const viewports = [
  ["desktop", 1440],
  ["mobile", 390],
];

const reduce = process.env.REDUCE === "1";
const suffix = reduce ? "-reduced" : "";
const browser = await chromium.launch();
for (const [vlabel, width] of viewports) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: reduce ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
  for (const [id, label] of tabs) {
    try {
      await page.getByRole("tab", { name: label }).first().click({ timeout: 5000 });
    } catch {
      process.stderr.write(`[shot] could not click tab ${label}\n`);
    }
    await page.waitForTimeout(1700);
    await page.screenshot({ path: `${outDir}/${id}-${vlabel}${suffix}.png`, fullPage: true });
    process.stderr.write(`[shot] ${id}-${vlabel}${suffix}.png\n`);
  }
  if (errors.length) process.stderr.write(`[shot] ${vlabel} console/page errors:\n${errors.slice(0, 10).join("\n")}\n`);
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ outDir, tabs: tabs.map((t) => t[0]), viewports: viewports.map((v) => v[0]) }));
