// Bespoke recertify driver — Finding L2-oliver-005: on a PUBLIC-funnel report,
// change a recommendation status and capture the failure copy (must be the amber
// "policy" message with Dismiss and NO Retry, not "check your connection").
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = (process.env.SHOT_DIR ?? "uat/runs/2026-07-16-recertify/shots").replace(/\/?$/, "/");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1200 } });

const patches = [];
page.on("response", (r) => {
  if (r.url().includes("/api/recommendations/") && r.request().method() === "PATCH") {
    patches.push({ url: r.url(), status: r.status() });
  }
});

await page.goto(BASE + "/report/lukeed/clsx", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(600);

// Open the Roadmap tab (where RecommendationTracker renders).
const roadmapTab = page.getByRole("tab", { name: /roadmap/i }).or(page.getByRole("button", { name: /roadmap/i }));
await roadmapTab.first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}clsx-roadmap-before.png`, fullPage: true });

// Change the first recommendation's status — this fires PATCH /api/recommendations/[id].
const select = page.getByLabel("Recommendation status").first();
await select.selectOption("in_progress");

// Wait for the row error alert — filter to the one with real text (Next's route
// announcer is an empty role="alert" that otherwise matches first).
const alert = page.getByRole("alert").filter({ hasText: /./ }).first();
await alert.waitFor({ timeout: 20000 });
await page.waitForTimeout(500);
const alertText = (await alert.innerText()).trim();
const alertClass = await alert.getAttribute("class");
const hasRetry = await alert.getByRole("button", { name: /retry/i }).count();
const hasDismiss = await alert.getByRole("button", { name: /dismiss/i }).count();
const selectValue = await select.inputValue(); // should have rolled back to "open"

await page.screenshot({ path: `${outDir}clsx-tracker-403-policy.png`, fullPage: true });
writeFileSync(`${outDir}clsx-tracker-403.aria.yaml`, await page.locator("body").ariaSnapshot());

console.log(JSON.stringify({ alertText, alertClass, hasRetry, hasDismiss, selectValue, patches }, null, 2));
await browser.close();
