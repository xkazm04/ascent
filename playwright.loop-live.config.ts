import { defineConfig, devices } from "@playwright/test";

// LOOP — LIVE (L2) config. The sibling of `playwright.loop.config.ts`, with one deliberate
// difference: **it starts no server.**
//
// `playwright.loop.config.ts` owns its dev server, which is exactly right for the mock suite and
// exactly wrong here. The L2 certification's central act is *killing the server mid-drive and
// restarting it*, and a `webServer` Playwright owns cannot be killed from underneath Playwright
// without ending the run. So the operator (or the certification script) owns the process, and this
// config only points a browser at it.
//
// Consequences the reader should know before running it:
//   • Nothing here is isolated. The server this drives carries whatever env it was launched with —
//     including, for the L2-A/B half, `LLM_PROVIDER=claude-cli`, which SPENDS MODEL SESSIONS.
//     Launch it against a throwaway `PGLITE_DATA_DIR` and a scratch repo, never the operator's.
//   • It is not wired into CI and must not be: it asserts against state a human staged.
//
//   npx playwright test --config playwright.loop-live.config.ts
//
// See uat/runs/2026-08-29-loop-l2/ for the run this was written for and what each spec proved.

const PORT = process.env.L2_PORT || "3220";
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e/loop",
  testMatch: /live-.*\.spec\.ts/,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE, headless: true, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
