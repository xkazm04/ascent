// Computed-style check of kit roles on a real route (recipe step 9). The spec is a roles file: each role names a
// CSS selector (prefer the kit's data-role hooks) and the computed values the language spec (KIT-V2-LANGUAGE.md
// section 1-2) demands. A deviation is fixed in the part's CSS, never per module; an owner-accepted departure is
// listed in the role's "accept" array and printed, so the review that moved the design stays visible.
//   node scripts/kit/roles-check.mjs --roles scripts/kit/roles/overview.json [--base http://localhost:3002]
//        [--route "/org/kiro?tab=overview"] [--theme prism] [--size 1440x900]
// Values: a number (px, tolerance 0.6), a string (exact), or [min, max]. Exit 1 on any un-accepted deviation.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("base", "http://localhost:3002");
if (/:3000(\/|$)/.test(base)) { console.error("refusing :3000 (another product)"); process.exit(2); }
const spec = JSON.parse(readFileSync(arg("roles"), "utf8"));
const route = arg("route", spec.route ?? "/org/kiro?tab=overview");
const theme = arg("theme", "prism");
const [w, h] = arg("size", "1440x900").split("x").map(Number);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: w, height: h } });
await ctx.addCookies([{ name: "ascent-theme", value: theme, url: base }]);
const page = await ctx.newPage();
await page.goto(base + route, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(1500);

const PROPS = ["fontSize", "fontWeight", "letterSpacing", "lineHeight", "textTransform", "fontFamily", "borderTopWidth", "borderRadius", "height", "width", "color", "backgroundColor"];
let bad = 0, checked = 0;
for (const [name, role] of Object.entries(spec.roles)) {
  const got = await page.evaluate(([sel, props]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const o = Object.fromEntries(props.map((p) => [p, cs[p]]));
    o.width = r.width; o.height = r.height; o.count = document.querySelectorAll(sel).length;
    return o;
  }, [role.selector, PROPS]);
  if (!got) { console.log(`MISSING ${name}  ${role.selector}`); bad++; continue; }
  for (const [prop, want] of Object.entries(role.expect ?? {})) {
    checked++;
    let have = got[prop];
    const num = parseFloat(have);
    let ok;
    if (Array.isArray(want)) ok = num >= want[0] && num <= want[1];
    else if (typeof want === "number") ok = Math.abs(num - want) <= 0.6;
    else if (prop === "fontFamily") ok = String(have).toLowerCase().includes(String(want).toLowerCase());
    else ok = String(have) === want;
    const accepted = (role.accept ?? []).includes(prop);
    if (!ok) { console.log(`${accepted ? "ACCEPTED" : "DEVIATION"} ${name}.${prop}: want ${JSON.stringify(want)} got ${have}${role.why ? "  (" + role.why + ")" : ""}`); if (!accepted) bad++; }
  }
}
console.log(`${bad ? "FAIL" : "ok"}: ${Object.keys(spec.roles).length} roles, ${checked} properties, ${bad} deviation(s) at ${w}x${h} ${theme}`);
await browser.close();
process.exit(bad ? 1 : 0);
