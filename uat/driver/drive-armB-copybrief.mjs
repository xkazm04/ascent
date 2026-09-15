// Arm B: click "Copy briefing for LLM" on the Briefing tab and read the clipboard, so the
// markdown renderer (the same ExecBriefing object the board PDF renders) can be read as text.
// Usage: node uat/driver/drive-armB-copybrief.mjs "<org path with query>" <shot>
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const [path, shot = "copybrief"] = process.argv.slice(2);
const outDir = (process.env.SHOT_DIR ?? "uat/_shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);
await page.getByRole("button", { name: /Copy briefing for LLM/i }).first().click();
await page.waitForTimeout(1200);
const md = await page.evaluate(() => navigator.clipboard.readText());
writeFileSync(`${outDir}${shot}.md`, md);
console.log(`captured ${shot}.md (${md.length} chars) from ${page.url()}`);
await browser.close();
