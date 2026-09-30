// Drives the Practices Prism level and asserts on the URL hash and the DOM, not on a screenshot.
//   node scripts/kit/drive-practices.mjs [--base http://localhost:3001]
import { chromium } from "@playwright/test";

const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3001";
if (/:3000(\/|$)/.test(base)) process.exit(2);
const URL = `${base}/org/kiro?tab=practices`;
const browser = await chromium.launch();
let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "pass" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fails++;
};

async function fresh(theme, url = URL) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "ascent-theme", value: theme, url: base }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  const skip = p.getByRole("button", { name: "Skip setup" });
  if (await skip.count()) {
    await skip.first().click().catch(() => {});
    await p.waitForTimeout(300);
  }
  return { p, errs, ctx };
}

const masthead = (p) => p.locator("[data-role='practices-v2'] [data-kit='masthead']").count();
const level = (p) => p.locator("[data-role='practice-level']").count();
// A fully adopted library has no gap repo, so PracticeApply returns nothing. That is the same
// rule as Altimeter. Either the apply control or the "no gaps" sentence must be on the level.
async function minedDetail(p) {
  const save = (await p.getByRole("button", { name: "Save as playbook" }).count()) > 0;
  const apply = (await p.getByText("Apply to a repo").count()) > 0;
  const adopted = (await p.getByText("No clear gaps").count()) > 0;
  return save && (apply || adopted);
}

let practiceHash = "";
{
  const { p, errs, ctx } = await fresh("prism");
  const rows = p.locator("[data-role='practices-v2'] button[id^='practice-']");
  const rowCount = await rows.count();
  check("prism: a mined practice row is on the overview", rowCount > 0);
  if (rowCount === 0) {
    const sample = await p.evaluate(() => (document.querySelector("main")?.innerText ?? document.body.innerText).slice(0, 240));
    check("prism: overview shown, level closed", false, sample.replace(/\s+/g, " "));
    check("no console errors (prism)", errs.length === 0, errs[0]?.slice(0, 160));
    await ctx.close();
  } else {
  const id = await rows.first().getAttribute("id");
  practiceHash = id ? `#${id}` : "";
  check("prism: overview shown, level closed", (await masthead(p)) === 1 && (await level(p)) === 0);
  await rows.first().click();
  await p.waitForTimeout(400);
  const hash = await p.evaluate(() => location.hash);
  check("open row: hash is #practice-", hash.startsWith("#practice-") && hash.length > "#practice-".length, hash);
  check("open row: masthead gone, level present", (await masthead(p)) === 0 && (await level(p)) === 1);
  check("open row: focus on the level heading", await p.evaluate(() => document.activeElement?.id === "practice-level-title"));
  check("open row: mined detail shows apply, or the library has no gap", await minedDetail(p));
  await p.goBack();
  await p.waitForTimeout(400);
  check("browser Back closes the level", (await masthead(p)) === 1 && (await p.evaluate(() => location.hash)) === "");
  await p.locator("[data-role='practices-v2'] button[id^='practice-']").first().click();
  await p.waitForTimeout(300);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  check("Esc: back to overview, hash cleared", (await masthead(p)) === 1 && (await p.evaluate(() => location.hash)) === "");
  await p.locator("[data-role='practices-v2'] button[id^='practice-']").first().click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Library", exact: true }).click();
  await p.waitForTimeout(400);
  check("Back button closes the level", (await masthead(p)) === 1);
  const next = p.locator("[data-role='level-next']");
  await p.locator("[data-role='practices-v2'] button[id^='practice-']").first().click();
  await p.waitForTimeout(300);
  if ((await next.count()) > 0) {
    const before = await p.evaluate(() => location.hash);
    await next.click();
    await p.waitForTimeout(300);
    const after = await p.evaluate(() => location.hash);
    check("next walks to another practice", after !== before && after.startsWith("#"));
  } else {
    check("next walks to another practice", false, "no next control");
  }
  check("no console errors (prism)", errs.length === 0, errs[0]?.slice(0, 160));
  await ctx.close();
  }
}

{
  const { p, errs, ctx } = await fresh("prism", URL + practiceHash);
  check("deep link opens the level after hydration", practiceHash !== "" && (await level(p)) === 1, practiceHash);
  check("deep link keeps the mined detail on screen", await minedDetail(p));
  check("no console errors (deep link)", errs.length === 0, errs[0]?.slice(0, 160));
  await ctx.close();
}

{
  const { p, errs, ctx } = await fresh("altimeter");
  check("altimeter: v1 library, no prism composition", (await p.locator("[data-role='practices-v2']").count()) === 0 && (await p.getByText("Practice Library").count()) > 0);
  check("altimeter: no practice level", (await level(p)) === 0);
  check("no console errors (altimeter)", errs.length === 0, errs[0]?.slice(0, 160));
  await ctx.close();
}

await browser.close();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
