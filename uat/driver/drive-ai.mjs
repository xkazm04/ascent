// Portable UAT AI-surface driver (L2) — for surfaces whose value IS a model call.
// Navigates, fills inputs, clicks "generate", then POLLS until the real-model result
// settles (15–130s), and captures screenshot + ARIA + text. Optionally asserts the
// output echoes a supplied real entity (the grounding check), so L2 can prove the
// *grounded* path end-to-end, not merely that a call fired.
//
// Usage (from repo root, via the Git-Bash tool):
//   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:3100 SHOT_DIR=uat/runs/<id>/shots \
//     FILL='[["Konkurent X","Asana"],["levnější","levnější, česky, Sklik a Fakturoid"]]' \
//     node uat/driver/drive-ai.mjs /app/demo-app/srovnani-seo tobias-grounded "Vygenerovat srovnání" "Asana"
//
//   • FILL (env, optional): JSON [[placeholderRegex, value], ...] filled before generating.
//   • arg1 path, arg2 shotName.
//   • arg3 generateName: role=button name regex to click (the "generate" control).
//   • arg4 assertEcho (optional): text the grounded output should contain — when present,
//     polling stops as soon as it appears and the run reports grounded-echo:true/false.
// Same gotchas baked in as drive.mjs (MSYS_NO_PATHCONV, ariaSnapshot, no networkidle block).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
const [path = "/", shot = "ai", generateName = "Generovat", assertEcho] = process.argv.slice(2);
const outDir = (process.env.SHOT_DIR ?? "uat/_shots").replace(/\/?$/, "/");
const MAX_MS = Number(process.env.AI_MAX_MS ?? 140000);
// Loading words that mean "still generating" — extend per app/language as needed.
const LOADING = /Generuji|Navrhuji|Analyzuji|Generuje|Načít|Loading|Generating/i;
mkdirSync(outDir, { recursive: true });

let fills = [];
try {
  fills = JSON.parse(process.env.FILL ?? "[]");
} catch {
  console.log("bad FILL json — ignoring");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 2200 } });
await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(600);

for (const [ph, val] of fills) {
  try {
    await page.getByPlaceholder(new RegExp(ph)).first().fill(String(val));
  } catch (e) {
    console.log("fill failed:", ph, String(e).split("\n")[0]);
  }
}

try {
  await page.getByRole("button", { name: new RegExp(generateName) }).first().click();
} catch (e) {
  console.log("generate click failed:", String(e).split("\n")[0]);
}

// Poll until the result echoes the asserted entity, or (no assertion) until the
// loading state clears and the page text stops growing across two checks.
const start = Date.now();
let hit = false;
let prevLen = -1;
let stable = 0;
while (Date.now() - start < MAX_MS) {
  await page.waitForTimeout(3000);
  const t = await page.locator("body").innerText();
  if (assertEcho && new RegExp(assertEcho).test(t)) {
    hit = true;
    break;
  }
  if (!LOADING.test(t) && Date.now() - start > 12000) {
    if (t.length === prevLen) {
      if (++stable >= 2) break;
    } else {
      stable = 0;
    }
    prevLen = t.length;
  }
}

await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}${shot}.png`, fullPage: true });
writeFileSync(`${outDir}${shot}.text.txt`, (await page.locator("body").innerText()).slice(0, 14000));
writeFileSync(`${outDir}${shot}.aria.yaml`, await page.locator("body").ariaSnapshot());
console.log(
  `captured: ${shot}.{png,text.txt,aria.yaml} · grounded-echo:${assertEcho ? hit : "n/a"} · elapsed:${Math.round(
    (Date.now() - start) / 1000
  )}s`
);
await browser.close();
