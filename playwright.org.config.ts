import { defineConfig, devices } from "@playwright/test";

// Enterprise / org e2e suite. Runs against the LIVE :3007 server — real Postgres, the seeded
// Vercel org, and the live LLM provider (claude-cli). The only "shortcut" is org auth: AUTH is
// unconfigured on :3007, so org pages are open (no sign-in flow to drive). Assertions are
// business-value: each section must surface a gap to explore / exemplar to reuse / input to act on.
//
//   GITHUB_TOKEN=$(gh auth token) DATABASE_URL=... npx playwright test --config playwright.org.config.ts
//
// Assumes :3007 is already running (the long-lived dev/test server). reuseExistingServer means
// Playwright reuses it; the command is only a fallback if it isn't up.

const PORT = process.env.E2E_ORG_PORT || "3007";
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e/org-suite",
  globalSetup: "./e2e/org-suite/global-setup.ts",
  timeout: 210_000, // accommodate a live LLM scan (claude-cli) inside one test
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE, headless: true, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: BASE,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      PORT,
      DATABASE_URL: process.env.DATABASE_URL || "postgres://ascent:ascent@localhost:5432/ascent",
      LLM_PROVIDER: process.env.LLM_PROVIDER || "claude-cli",
      ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}),
    },
  },
});
