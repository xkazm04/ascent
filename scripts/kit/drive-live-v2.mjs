// Drives the Live cockpit v2 interactions (recipe step 6) and asserts on the product's own state (URL hash, DOM),
// not on a screenshot: open the outcome level, Esc, browser Back, deep link, run-row open, focus, Altimeter untouched.
//   node scripts/kit/drive-live-v2.mjs [--base http://localhost:3002]
import { chromium } from "@playwright/test";
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3002";
if (/:3000(\/|$)/.test(base)) process.exit(2);
const URL = `${base}/org/kiro?tab=live&view=cockpit`;
const browser = await chromium.launch();
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "pass" : "FAIL"} ${name}${extra ? "  " + extra : ""}`); if (!ok) fails++; };
async function fresh(theme, url = URL) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "ascent-theme", value: theme, url: base }]);
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await p.goto(url, { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  const s = p.getByRole("button", { name: "Skip setup" }); if (await s.count()) { await s.first().click().catch(() => {}); await p.waitForTimeout(300); }
  return { p, errs, ctx };
}
const level2 = (p) => p.locator('[data-role="level-nav"]').count();
const overview = (p) => p.locator('[data-role="cockpit-stage"]').count();

// --- prism
{
  const { p, errs, ctx } = await fresh("prism");
  check("prism: overview shown, level 2 closed", (await overview(p)) === 1 && (await level2(p)) === 0);
  await p.getByRole("button", { name: "Open the full outcome matrix" }).click(); await p.waitForTimeout(400);
  check("open matrix: hash is #outcome", (await p.evaluate(() => location.hash)) === "#outcome");
  check("open matrix: overview gone, level nav present", (await overview(p)) === 0 && (await level2(p)) === 1);
  check("open matrix: focus moved into the level heading", await p.evaluate(() => document.activeElement?.closest("#outcome-title") != null));
  check("open matrix: the sheet renders (a run column button)", (await p.getByRole("button", { name: /^Run \d+/ }).count()) > 0 || (await p.locator("table").count()) > 0);
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  check("Esc: back to overview, hash cleared", (await overview(p)) === 1 && (await p.evaluate(() => location.hash)) === "");
  await p.getByRole("button", { name: "Open the full outcome matrix" }).click(); await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Cockpit", exact: true }).first().click(); await p.waitForTimeout(400);
  check("Back button closes the level", (await overview(p)) === 1);
  await p.locator('[data-role="run-strip"] button').first().click(); await p.waitForTimeout(700);
  check("run row opens the level", (await level2(p)) === 1 && (await p.evaluate(() => location.hash)) === "#outcome");
  await p.goBack(); await p.waitForTimeout(400);
  check("browser Back from a run open closes the level", (await overview(p)) === 1);
  check("no console errors (prism)", errs.length === 0, errs[0]?.slice(0, 100));
  await ctx.close();
}
// --- deep link
{
  const { p, errs, ctx } = await fresh("prism", URL + "#outcome");
  check("deep link #outcome opens the level after hydration", (await level2(p)) === 1);
  check("no console errors (deep link)", errs.length === 0, errs[0]?.slice(0, 100));
  await ctx.close();
}
// --- altimeter untouched
{
  const { p, errs, ctx } = await fresh("altimeter");
  check("altimeter: v1 composition (no v2 hooks)", (await p.locator('[data-role="cockpit-v2"]').count()) === 0 && (await p.locator('section[aria-label="Loop cockpit"]').count()) === 1);
  check("altimeter: no level chrome, no outcome button", (await level2(p)) === 0 && (await p.getByRole("button", { name: "Open the full outcome matrix" }).count()) === 0);
  check("no console errors (altimeter)", errs.length === 0);
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
