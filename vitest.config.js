// Vitest config (plain JS so it is invisible to `tsc --noEmit`). vitest is a devDependency; run the
// suite with `npm test` (vitest run) or `npm run test:watch`. Its one job is to resolve the
// project's `@/*` path alias the same way tsconfig does, so unit tests can import production
// modules that use `@/...` imports.
import { resolve } from "node:path";

export default {
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
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
