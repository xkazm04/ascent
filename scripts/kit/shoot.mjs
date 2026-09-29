// Kit integrated-page shooter (S0.4): the REAL route inside the REAL shell, per theme and size.
//   node scripts/kit/shoot.mjs --out <dir> [--base http://localhost:3011] [--themes altimeter,prism]
//        [--sizes 1280x800,1920x1080,1440x3200] [--routes "/org/kiro?tab=live,/org/kiro?tab=overview"]
// Theme is set through the `ascent-theme` cookie (the server reads it, so per-theme layouts render correctly). Fails loud (exit 1) on page
// errors, console errors or an empty mount. Port 3000 on this machine is another product: never default to it.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("base", "http://localhost:3011");
if (/:3000(\/|$)/.test(base)) { console.error("refusing :3000 (another product)"); process.exit(2); }
const out = resolve(arg("out", ".contest/kit-shots"));
const themes = arg("themes", "altimeter,prism").split(",");
const sizes = arg("sizes", "1280x800,1920x1080,1440x3200").split(",").map((s) => s.split("x").map(Number));
const routes = arg("routes", "/org/kiro?tab=live,/org/kiro?tab=overview").split(",");
mkdirSync(out, { recursive: true });
const slug = (r) => r.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "");
const browser = await chromium.launch();
let bad = 0;
for (const theme of themes) for (const route of routes) for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addCookies([{ name: "ascent-theme", value: theme, url: base }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await page.goto(base + route, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1800);
  const skip = page.getByRole("button", { name: "Skip setup" });
  if (await skip.count()) { await skip.first().click().catch(() => {}); await page.waitForTimeout(400); }
  // Some org tabs land scrolled (Live: scrollY 384-385 on load, non-deterministic by 1px). The page has scroll-behavior:smooth and a mount-time scroll (~384px, animated), so pin with an INSTANT scroll or a pair diff is scroll, not code.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(250);
  const chars = await page.evaluate(() => document.querySelector("main")?.innerText.length ?? 0);
  const applied = await page.evaluate(() => document.documentElement.dataset.theme ?? "none");
  const file = `${out}/${slug(route)}--${theme}--${w}x${h}.png`;
  await page.screenshot({ path: file, fullPage: h > 2000 });
  const flag = errs.length || chars < 50 ? "FAIL" : "ok";
  if (flag === "FAIL") bad++;
  console.log(`${flag} ${route} ${theme}(applied:${applied}) ${w}x${h} main=${chars}ch errs=${errs.length}${errs[0] ? " " + errs[0].slice(0, 120) : ""}`);
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
