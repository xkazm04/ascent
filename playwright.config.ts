import { defineConfig, devices } from "@playwright/test";

// Runs against `next dev` (React StrictMode ON) so the scan-flow test guards the
// double-mount class of bug, with the LLM forced to deterministic mock mode (no key,
// no cost). Scans still hit GitHub for real repo structure.
//
// The server also runs with a CONFIGURED-BUT-UNREACHABLE DATABASE_URL on purpose: that is the
// realistic local/outage state (Postgres not running) that used to 500 the public-scan funnel and
// the org dashboard, because isDbConfigured() was true yet every query threw a connection error. The
// scan + org specs assert the app degrades gracefully under it. Set a real DATABASE_URL (and a real
// LLM_PROVIDER) in the env to run the same specs against a live stack instead.
const PORT = process.env.E2E_PORT || "3100";
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: { baseURL: BASE, headless: true, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: BASE,
    env: {
      PORT,
      LLM_PROVIDER: process.env.LLM_PROVIDER || "mock",
      // Configured (so isDbConfigured() is true) but unreachable — a closed localhost port refuses
      // instantly, so resilient reads degrade without a per-query connect-timeout stall. This is the
      // exact state the public-scan and org-dashboard fixes harden against.
      DATABASE_URL: process.env.DATABASE_URL || "postgres://ascent:ascent@127.0.0.1:55432/ascent",
      // Real repo structure still comes from GitHub; pass a token through when present so CI scans
      // aren't throttled by the anonymous rate limit.
      ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}),
    },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
