// Arm B / NADIA-L1-07: with a requireChecks-bearing policy stored server-side, edit ONE unrelated
// field (Min overall) in the Governance policy editor, save, and see whether requireChecks survives.
// Captures the tab before and after, and prints the API policy at each step.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = (process.env.SHOT_DIR ?? "uat/_shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });
const ORG = process.argv[2] ?? "public";
const NEW_MIN_OVERALL = process.argv[3] ?? "55";
// RC-M2 / RC2-M2 (2026-08-31): the shot stem used to be hard-coded, so re-running this driver for a
// recertification pass OVERWROTE the arm it was reused from — twice, and the shots are gitignored, so
// the baselines are gone. Pass a stem (env or argv) whenever this runs outside its originating arm.
// The old name is the default, so every existing invocation keeps its filenames.
const SHOT = process.env.SHOT_PREFIX ?? process.argv[4] ?? "armB-nadia07";

const api = async (page) =>
  page.evaluate(async (o) => (await fetch(`/api/org/gate-policy?org=${o}`)).text(), ORG);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
await page.goto(`${BASE}/org/${ORG}?tab=governance`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log("POLICY BEFORE:", await api(page));

const body = await page.locator("body").innerText();
console.log("UI mentions requireChecks/control ids BEFORE:",
  /requireChecks|control\.prepush\.lint|guardrail\.never-commit|required control/i.test(body));
writeFileSync(`${outDir}${SHOT}-before.text.txt`, body.slice(0, 60000));
await page.screenshot({ path: `${outDir}${SHOT}-before.png`, fullPage: true });
writeFileSync(`${outDir}${SHOT}-before.aria.yaml`, await page.locator("body").ariaSnapshot());

// Edit ONE unrelated field, then save.
const field = page.getByLabel(/Min overall/i).first();
await field.fill(NEW_MIN_OVERALL);
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^Save policy$/i }).first().click();
await page.waitForTimeout(3500);

console.log("POLICY AFTER :", await api(page));
const after = await page.locator("body").innerText();
writeFileSync(`${outDir}${SHOT}-after.text.txt`, after.slice(0, 60000));
await page.screenshot({ path: `${outDir}${SHOT}-after.png`, fullPage: true });
writeFileSync(`${outDir}${SHOT}-after.aria.yaml`, await page.locator("body").ariaSnapshot());
await browser.close();
