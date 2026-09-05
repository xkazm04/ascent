import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// LOCAL-MODE LOOP suite — the only e2e config that drives the cockpit's improvement loop end to end.
//
// It is a THIRD config rather than a project inside either existing one, because the loop needs a
// server env that contradicts both:
//
//   • playwright.config.ts boots a dev server with a deliberately UNREACHABLE DATABASE_URL (that is
//     the degrade-gracefully state its specs assert). The loop is nothing but database state.
//   • playwright.org.config.ts targets the long-lived :3007 server with real Postgres, the seeded
//     `vercel` org and a LIVE model. Pointing local mode at it would write loop rows and agent
//     branches into the operator's own working data, and score them with a paid model.
//
// So this config starts its own dev server, on its own port, against its own THROWAWAY PGlite data
// dir, declaring its own local org — nothing it does can touch the operator's `.pglite/ascent` or
// their `kiro` org. The LLM is the deterministic mock, which is also what makes the suite's central
// honesty assertion possible: every scan it produces is a mock scan, so the outcome ledger must
// refuse to call the movement a lift ("not attributable: mock scan"). That is the correct rendering
// of this state, not a limitation of the harness.
//
//   npx playwright test --config playwright.loop.config.ts
//
// NOT wired into CI. `.github/workflows/ci.yml` runs lint/tsc/vitest/coverage/build and no Playwright
// at all; the only e2e in CI is smoke.yml's `--grep @smoke` post-deploy pass. Wiring e2e into PR CI is
// backlog item 11 and owns that decision — this suite is runnable, and deliberately not registered.

const PORT = process.env.E2E_LOOP_PORT || "3111";
const BASE = `http://localhost:${PORT}`;

// The declared local org for this suite. Deliberately NOT the operator's `ASCENT_LOCAL_ORG` — the
// value below is what `ensureLocalOrg()` creates on first request, and it exists only in the
// throwaway database beneath it.
export const LOOP_ORG = process.env.E2E_LOOP_ORG || "e2eloop";

// A throwaway PGlite dir, wiped once per run so the suite always starts schema-only and zero-row
// (prisma/init.sql is re-run idempotently by pglite-boot). The wipe happens at CONFIG LOAD because
// Playwright starts `webServer` BEFORE `globalSetup` — by the time a global setup could run, PGlite
// has already booted from the dir. Guarded by an env stamp so the workers (which re-load this file
// and inherit the runner's env) can never wipe a database mid-run.
function dataDir(): string {
  const existing = process.env.E2E_LOOP_DATA_DIR;
  if (existing) return existing;
  const rel = ".pglite/e2e-loop";
  const abs = resolve(process.cwd(), rel);
  // Safety rail copied from scripts/dev-empty.mjs: refuse to delete anything but the throwaway dir.
  if (!/[\\/]\.pglite[\\/]e2e-loop$/.test(abs)) {
    throw new Error(`[loop-e2e] refusing to wipe an unexpected data dir: ${abs}`);
  }
  rmSync(abs, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  process.env.E2E_LOOP_DATA_DIR = rel;
  return rel;
}

export default defineConfig({
  testDir: "./e2e/loop",
  // A run installs the `.ai/` foundation into a git worktree and rescans it; on a cold `next dev`
  // the first paint of /org/[slug] compiles the whole org shell first. Both are minutes, not seconds.
  timeout: 420_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE, headless: true, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `--webpack`: Turbopack refuses this checkout (node_modules is a junction). `next dev`, not
    // `next start`, for the same reason playwright.org.config.ts gives — a production build hard-
    // disables ASCENT_AUTH_BYPASS and prunes the CLI providers.
    command: `npx next dev --webpack -p ${PORT}`,
    // Readiness is probed on the cheapest route in the app, not on `/`. The landing page pulls
    // recharts + framer-motion + the deck and takes minutes to compile on a cold webpack dev server;
    // waiting on it made "the server is up" indistinguishable from "the marketing page is slow".
    url: `${BASE}/api/health`,
    // Deliberately false. Reusing whatever happens to hold the port would silently run this suite
    // against a server carrying the operator's env — their org, their database, their LLM provider —
    // which is the one failure this config exists to make impossible.
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      PORT,
      ASCENT_EMPTY: "1", // next.config.ts → distDir .next-empty, so this server never touches `.next`
      LLM_PROVIDER: "mock",
      PGLITE_DATA_DIR: dataDir(),
      // Dummy URL: isDbConfigured() must be true; the PGlite adapter provides the real connection.
      DATABASE_URL: "postgresql://pglite@127.0.0.1:5432/ascent",
      // The cockpit's gate, set the sanctioned way — the same four env facts CockpitSetup names.
      ASCENT_SELF_HOSTED: "1",
      ASCENT_AUTOPILOT: "1",
      ASCENT_LOCAL_ORG: LOOP_ORG,
      ASCENT_LOCAL_ORG_NAME: "Loop e2e",
      // Auth off (dev-only bypass) + org reads open: the same pair the org-suite and dev:empty use.
      ASCENT_AUTH_BYPASS: "1",
      ASCENT_OPEN_ORG_DASHBOARDS: "1",
      // Blanked, not inherited: the fixture repo is a local git repo that does not exist on GitHub,
      // and every scan this suite runs passes `noAmbientToken`. An inherited PAT would be dead weight
      // with a real blast radius.
      GITHUB_TOKEN: "",
      SENTRY_DSN: "",
    },
  },
});
