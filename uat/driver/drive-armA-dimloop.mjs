import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const repo = process.argv[2] ?? "sindresorhus/p-limit";
const outDir = (process.env.SHOT_DIR ?? "uat/_shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1600 } });
await page.goto(`${BASE}/report?repo=${encodeURIComponent(repo)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
for (let i = 0; i < 90; i++) { const t = await page.locator("body").innerText().catch(()=> ""); if (/Score waterfall|WHY THIS SCORE/i.test(t)) break; await page.waitForTimeout(4000); }
await page.getByRole("button", { name: /^Dimensions$/ }).first().click();
await page.waitForTimeout(1000);
const out = [];
for (let n = 1; n <= 9; n++) {
  await page.getByRole("button", { name: new RegExp(`^D${n} `) }).first().click();
  await page.waitForTimeout(500);
  for (const b of await page.locator('[aria-expanded="false"]').all()) { await b.click().catch(()=>{}); await page.waitForTimeout(80); }
  await page.waitForTimeout(400);
  const rec = await page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg[role='img']")].find((s) => (s.getAttribute("aria-label") ?? "").startsWith("Score provenance"));
    const panel = svg ? svg.closest("div").parentElement : null;
    const rect = svg?.querySelector("rect");
    const codes = panel ? [...panel.querySelectorAll("code")].map((c) => c.textContent) : [];
    return {
      label: svg?.getAttribute("aria-label") ?? null,
      titles: svg ? [...svg.querySelectorAll("title")].map((t) => t.textContent) : [],
      bandRect: rect ? { x: rect.getAttribute("x"), width: rect.getAttribute("width") } : null,
      panelText: panel ? panel.innerText.slice(0, 2600) : null,
      codeTokens: codes,
    };
  });
  out.push({ dim: `D${n}`, ...rec });
  await page.screenshot({ path: `${outDir}armA-dim-D${n}.png`, fullPage: false });
}
writeFileSync(`${outDir}armA-dimloop.json`, JSON.stringify(out, null, 2));
for (const r of out) console.log(`\n### ${r.dim} :: ${r.label}\n  band=${JSON.stringify(r.bandRect)}\n  titles=${JSON.stringify(r.titles)}\n  codeTokens=${JSON.stringify(r.codeTokens)}`);
await browser.close();
