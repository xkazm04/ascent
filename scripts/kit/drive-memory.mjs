// Prism memory level: a row opens #memory-<id>, Esc closes it, and the author form keeps mem-kind.
//   node scripts/kit/drive-memory.mjs [--base http://localhost:3001]
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
await page.goto(base + "/org/kiro?tab=memory", { waitUntil: "networkidle", timeout: 120000 });
const skip = page.getByRole("button", { name: "Skip setup" });
if (await skip.count()) await skip.first().click().catch(() => {});
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "ok" : "FAIL"} ${name}`); if (!ok) failed++; };

const kind = page.locator("#mem-kind");
await kind.waitFor({ timeout: 20000 }).catch(() => {});
check("author kind id", (await kind.count()) === 1);

const row = page.locator("section[aria-label='Shared org memory'] [data-role='list-row'] button").first();
await row.waitFor({ timeout: 20000 }).catch(() => {});
check("memory row", (await row.count()) === 1);
if (await row.count()) await row.click();
const opened = await page.waitForFunction(() => location.hash.startsWith("#memory-"), null, { timeout: 5000 }).then(() => true).catch(() => false);
check("hash opens", opened);
check("level back", (await page.locator("[data-role='memory-scene'] [data-role='level-back']").count()) === 1);
const focused = await page.waitForFunction(() => {
  const scene = document.querySelector("[data-role='memory-scene']");
  return Boolean(scene && scene.contains(document.activeElement));
}, null, { timeout: 3000 }).then(() => true).catch(() => false);
check("focus in scene", focused);
await page.keyboard.press("Escape");
const closed = await page.waitForFunction(() => location.hash === "", null, { timeout: 3000 }).then(() => true).catch(() => false);
check("esc closes", closed);
check("no page errors", errs.length === 0);
if (errs[0]) console.log(errs[0].slice(0, 200));

await browser.close();
process.exit(failed ? 1 : 0);
