// Prism skills level: a row opens #skill-<id>, Esc closes it, and the token name field keeps its id.
//   node scripts/kit/drive-skills.mjs [--base http://localhost:3001]
import { chromium } from "@playwright/test";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("base", "http://localhost:3001");
if (/:3000(\/|$)/.test(base)) { console.error("refusing :3000"); process.exit(2); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "ascent-theme", value: "prism", url: base }]);
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(base + "/org/kiro?tab=skills", { waitUntil: "networkidle", timeout: 120000 });
const skip = page.getByRole("button", { name: "Skip setup" });
if (await skip.count()) await skip.first().click().catch(() => {});
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "ok" : "FAIL"} ${name}`); if (!ok) failed++; };

const search = page.locator("#skill-filter-search");
await search.waitFor({ timeout: 20000 }).catch(() => {});
check("search id", (await search.count()) === 1);

const ladder = page.locator("[data-role='skills-v2'] [data-kit='ladder']");
check("lifecycle ladder", (await ladder.count()) >= 1);

const row = page.locator("[data-role='skills-v2'] [data-role='list-row'] button").first();
await row.waitFor({ timeout: 20000 }).catch(() => {});
check("skill row", (await row.count()) === 1);
if (await row.count()) await row.click();
const opened = await page.waitForFunction(() => location.hash.startsWith("#skill-"), null, { timeout: 5000 }).then(() => true).catch(() => false);
check("hash opens", opened);
check("level back", (await page.locator("[data-role='skill-scene'] [data-role='level-back']").count()) === 1);
const focused = await page.waitForFunction(() => {
  const scene = document.querySelector("[data-role='skill-scene']");
  return Boolean(scene && scene.contains(document.activeElement));
}, null, { timeout: 3000 }).then(() => true).catch(() => false);
check("focus in scene", focused);
await page.keyboard.press("Escape");
const closed = await page.waitForFunction(() => location.hash === "", null, { timeout: 3000 }).then(() => true).catch(() => false);
check("esc closes", closed);

const token = page.locator("#skill-token-name");
await token.waitFor({ timeout: 5000 }).catch(() => {});
check("token name id", (await token.count()) === 1);
check("no page errors", errs.length === 0);
if (errs[0]) console.log(errs[0].slice(0, 200));

await browser.close();
process.exit(failed ? 1 : 0);
