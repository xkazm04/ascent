// Vitest config (plain JS so it is invisible to `tsc --noEmit`). vitest is a devDependency; run the
// suite with `npm test` (vitest run) or `npm run test:watch`. Its one job is to resolve the
// project's `@/*` path alias the same way tsconfig does, so unit tests can import production
// modules that use `@/...` imports.
import { resolve } from "node:path";

const config = {
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // The default environment stays `node` — the overwhelming majority of the suite is pure logic and
    // runs far faster there. A COMPONENT test opts into a DOM per file with a docblock on line 1:
    //   // @vitest-environment jsdom
    // Before this existed there was no jsdom at all, so JSX/CSS/a11y changes could not be regression-
    // pinned; the bug+ui scan's 93 ui-perfectionist findings had no test coverage available to them.
    // The setup file is inert under node (it guards on `document`), so it costs the node tests nothing.
    setupFiles: ["./vitest.setup.dom.js"],
    // Pin the deployment mode for the whole suite. `selfHosted()` (src/lib/env.ts) defaults to TRUE
    // when no POLAR_ACCESS_TOKEN is present — which is right for a fresh clone but wrong for a test
    // run, where the assertions are about Ascent CLOUD's tier gating (BYOM is Enterprise-only, the
    // Free tier gets 5 scans, retention is 30 days). Without this pin, every one of those assertions
    // would flip the moment the gates learned about self-hosting. Self-host behaviour has its own
    // coverage in src/lib/self-host.test.ts, which sets the flag per-test via vi.stubEnv.
    env: { ASCENT_SELF_HOSTED: "0" },
    // 15s, up from the 5s default. Not a licence for slow tests — it is a contention allowance. The
    // suite grew past 5,000 tests across ~400 files, several of which do real work (spawning the
    // doctor subprocess against fixture repos, driving the @react-pdf pipeline end to end). Those
    // finish in well under a second each in isolation, but on a saturated 16-core box the runner's
    // own parallelism starves individual workers past 5s, producing failures that reproduce nowhere
    // and re-run green. A genuine hang or infinite loop still fails, just three seconds later.
    testTimeout: 15_000,
    // Calibrated coverage gate (`npm run test:coverage`, wired into CI). Scoped to three high-risk,
    // high-churn directories — the DB write/query layer and the two feature surfaces flagged by the
    // test-mastery scan. Each floor sits a few points BELOW the coverage measured the day it was set,
    // so the gate passes today and RATCHETS: new untested code in these dirs that drops coverage below
    // the floor fails CI. Raise a floor (never silently lower it) when a dir's real coverage climbs.
    // Floors are tuned for v8-instrumented runs (slightly slower; same line/branch counts).
    coverage: {
      provider: "v8",
      include: [
        "src/components/onboarding/**/*.{ts,tsx}",
        "src/lib/db/**/*.{ts,tsx}",
        "src/components/launch/**/*.{ts,tsx}",
      ],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts"],
      reporter: ["text-summary", "text", "json-summary"],
      thresholds: {
        // Measured 2026-06-19 (stmts/branch/funcs/lines): db 64/56/67/68, launch 43/37/30/41,
        // onboarding 19/14/9/19. Floors are ~current minus a small noise margin.
        "src/lib/db/**": { statements: 60, branches: 52, functions: 62, lines: 64 },
        "src/components/launch/**": { statements: 38, branches: 33, functions: 26, lines: 36 },
        "src/components/onboarding/**": { statements: 15, branches: 11, functions: 6, lines: 16 },
      },
    },
  },
  resolve: {
    alias: [{ find: /^@\//, replacement: resolve(process.cwd(), "src") + "/" }],
  },
};

export default config;
