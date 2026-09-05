import { defineConfig, devices } from "@playwright/test";

// Enterprise / org e2e suite. Runs against the LIVE :3007 server: real Postgres, the seeded Vercel
// org, and a live LLM provider. The only "shortcut" is org auth (the server runs with the wall off,
// so org pages are open and there is no sign-in flow to drive). Assertions are business-value: each
// section must surface a gap to explore / exemplar to reuse / input to act on.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE SERVER MUST RUN IN DEV MODE FOR THE LIVE-LLM TESTS TO MEAN ANYTHING.
//
// This config used to launch `next start` while declaring LLM_PROVIDER=claude-cli. Those two are
// incompatible, and silently so: `claude-cli` is gated behind `NODE_ENV !== "production"` in
// src/lib/llm/index.ts (deliberately, so a production build PRUNES the import and Vercel never
// traces a binary it doesn't have). Under `next start` that gate is false, the provider throws
// immediately, the scan fails over, and every "live LLM" assertion in scan-intelligence.spec.ts was
// actually grading the deterministic MOCK. Measured 2026-08-14: the failover chain ran
// claude-cli -> Bedrock -> mock, and the suite reported on mock output while claiming to test a
// live model.
//
// So the webServer command is `next dev`. Its cost is a slower first paint per route; its benefit is
// that the one thing this suite exists to prove -- that a real model produces a real assessment --
// is actually being proven.
//
// Next refuses a second `next dev` in the same directory, so stop any other dev server first.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
//   GITHUB_TOKEN=$(gh auth token) DATABASE_URL=... npx playwright test --config playwright.org.config.ts
//
// Assumes :3007 is already running (the long-lived dev/test server). reuseExistingServer means
// Playwright reuses it; the command below is only a fallback if it isn't up -- and a server started
// by hand must carry the same env, `next dev` included, or the live-LLM tests silently degrade.

const PORT = process.env.E2E_ORG_PORT || "3007";
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e/org-suite",
  globalSetup: "./e2e/org-suite/global-setup.ts",
  // 300s, from measurement rather than guesswork: a real claude-opus-5 assessment of vercel/sandbox
  // took 177s wall-clock (163s of it inside the model). 210s left almost no headroom for page load
  // plus a slower repo, and a timeout there reads as "the feature is broken" rather than "the model
  // took longer today". Dev mode also pays a first-compile cost per route on top.
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE, headless: true, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `next dev`, NOT `next start`: see the note at the top of this file. A production build cannot
    // run the claude-cli provider at all, which is what these tests are for.
    command: `npx next dev -p ${PORT}`,
    url: BASE,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      PORT,
      // Org dashboards run open in the auth-off e2e/seed workflow: see authz.canReadOrg.
      ASCENT_OPEN_ORG_DASHBOARDS: "1",
      // The seed + import routes are WRITES and stay walled by requireOrgAccess unless the bypass is
      // on. It is hard-disabled in production builds, which is another reason this must be dev mode.
      ASCENT_AUTH_BYPASS: "1",
      DATABASE_URL: process.env.DATABASE_URL || "postgres://ascent:ascent@localhost:5432/ascent",
      LLM_PROVIDER: process.env.LLM_PROVIDER || "claude-cli",
      // Pin the model so the suite's live-LLM result is attributable to a known engine rather than
      // to whatever CLAUDE_MODEL happened to be in the shell. Measured on claude-opus-5: a real
      // 9-dimension assessment of vercel/sandbox took ~177s and 11,908 output tokens.
      CLAUDE_MODEL: process.env.CLAUDE_MODEL || "claude-opus-5",
      ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}),
    },
  },
});
