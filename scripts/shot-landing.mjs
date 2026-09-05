// Dev-only: screenshot the consolidated landing at desktop + mobile, reporting console/page errors.
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { resolve } from "path";

const base = process.argv[2] || "http://localhost:3001";
const outDir = resolve(process.cwd(), ".proto-shots");
mkdirSync(outDir, { recursive: true });
const reduce = process.env.REDUCE === "1";
const suffix = reduce ? "-reduced" : "";

const browser = await chromium.launch();
for (const [label, width] of [["desktop", 1440], ["mobile", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: reduce ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${outDir}/landing-${label}${suffix}.png`, fullPage: true });
  process.stderr.write(`[shot] landing-${label}${suffix}.png` + (errors.length ? ` ERRORS:\n${errors.slice(0, 8).join("\n")}` : " (clean)") + "\n");
  await ctx.close();
}
await browser.close();
console.log("done");
