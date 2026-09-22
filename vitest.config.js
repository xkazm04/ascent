// Vitest config (plain JS so it is invisible to `tsc --noEmit`). vitest is a devDependency; run the
// suite with `npm test` (vitest run) or `npm run test:watch`. Its one job is to resolve the
// project's `@/*` path alias the same way tsconfig does, so unit tests can import production
// modules that use `@/...` imports.
import { resolve } from "node:path";

// Git exports GIT_DIR (and, from a worktree, GIT_WORK_TREE and friends) to hooks, and `git -C <dir>`
// or a `cwd` does NOT override them. When the pre-push hook runs this suite, every fixture that
// spawns git on a scratch repo would act on the REAL repository instead: since 2026-09-03 that wrote
// fixture identities into .git/config (471 master commits authored "Ascent Loop", more as "Deps Test",
// "Land Test", "Worktree Test"), overwrote .git/info/exclude, and on 2026-09-19 set core.worktree to
// a deleted path. This file runs in the main process before any worker forks, so deleting them here
// scrubs every worker and every child process a test spawns. Pinned by src/lib/local/git-env-scrub.test.ts.
for (const k of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
]) {
  delete process.env[k];
}

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
    // The full suite runs real Git subprocesses and PDF rendering alongside DOM tests. On a busy
    // Windows host, an isolated subsecond fixture can wait more than 15s for a child process.
    // Bound each test at 30s while the worker cap below keeps contention manageable.
    testTimeout: 30_000,
    // Real Git fixture repos and DOM workers contend heavily during the full coverage run on
    // Windows. Keep enough parallelism for the suite while giving child processes room to finish.
    maxWorkers: 4,
    // Calibrated coverage gate (`npm run test:coverage`, wired into CI). Scoped to three high-risk,
    // high-churn directories — the DB write/query layer and the two feature surfaces flagged by the
    // test-mastery scan. Each floor sits a few points BELOW the coverage measured the day it was set,
    // so the gate passes today and RATCHETS: new untested code in these dirs that drops coverage below
    // the floor fails CI. Raise a floor (never silently lower it) when a dir's real coverage climbs.
    // Floors are tuned for v8-instrumented runs (slightly slower; same line/branch counts).
    coverage: {
      provider: "v8",
      // Two include sets, two consumers. This one is the REPORT's population and it
      // is derived from the tree, not hand-listed: `all` instruments every src file
      // whether or not a test imported it, so an untested module reads as 0% instead
      // of being absent from the denominator. Measured 2026-09-01 over the full suite
      // (782 files): the previous hand-scoped list reported 175 files, the whole tree
      // reports 1529 at 68.98% lines, of which 490 sit at 0% — those 490 were invisible
      // to this report, not visibly untested. The
      // GATE is unaffected: every floor below is already per-glob, so widening the
      // report cannot move a threshold. That separation is also what lets the ratchet
      // mean something — a floor can only ratchet over a directory somebody added to
      // it, so the whole-tree number is the only place a NEW untested directory shows up.
      all: true,
      include: ["src/**/*.{ts,tsx}"],
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
    alias: [
      { find: /^@\//, replacement: resolve(process.cwd(), "src") + "/" },
      // `server-only` is a BUILD-time marker, not a runtime module: its default export throws on
      // import so that a client bundle referencing it fails `next build` (that is the whole point —
      // see Architect ADR 2026-08-28-server-only-boundary). Next resolves the package's `react-server`
      // condition to a no-op on the server; vitest has no such condition, so every unit test that
      // imports a guarded module (auth, access, authz, db) would throw. Point it at the package's own
      // empty.js — the same file Next uses — rather than setting a global `react-server` condition,
      // which would also change how react itself resolves.
      { find: /^server-only$/, replacement: resolve(process.cwd(), "node_modules/server-only/empty.js") },
    ],
  },
};

export default config;
