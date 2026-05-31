import { defineConfig, devices } from "@playwright/test";

// Runs against `next dev` (React StrictMode ON) so the scan-flow test guards the
// double-mount class of bug, with the LLM forced to deterministic mock mode (no key,
// no cost). Scans still hit GitHub for real repo structure.
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
    env: { PORT, LLM_PROVIDER: "mock" },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
