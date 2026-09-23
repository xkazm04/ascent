// The rubric's golden-fixture corpus: small synthetic repositories, each chosen to exercise ONE
// honesty rule of the scoring pipeline, driven end to end by rubric-fingerprint.ts.
//
// TEST-ONLY. Nothing under src/app or src/components may import this module (the guard lives in
// rubric-fingerprint.test.ts). It is plain data plus the canned model answer each fixture is scored
// against, so a fingerprint over it measures the INSTRUMENT (detectors, folds, the D9 battery, the
// prompt, the claim verifier, the engine) and never a live model.
//
// WHY A CORPUS AND NOT A HAND-LISTED SURFACE. model.test.ts hashes the rubric DECLARATION (weights,
// bands, blend, guardband, lenses, the system prompt). Everything that computes a score before the
// engine blends it sits outside that hash by construction, and five score-moving commits landed under
// r18 without a bump because of it (see the r19 note on SCORING_RUBRIC_VERSION). A fixture reaches
// what a declaration cannot: if an edit anywhere in the pipeline moves what one of these repositories
// scores or what the model is shown about it, the fingerprint moves.
//
// RULES FOR EDITING THIS FILE. Adding or changing a fixture changes the fingerprint, so it is re-pinned
// in the same diff; that re-pin is NOT a rubric event (the instrument did not move, the ruler's test
// set did) and needs no version bump. rubric-fingerprint.coverage.test.ts fails if a fixture stops
// being the only witness of some case, so the corpus cannot quietly rot into a pin that matches
// nothing.

import type { AppInventory } from "@/lib/github/check-suites";
import type { CiHealth } from "@/lib/github/actions-health";
import { estimateCoverage } from "@/lib/forge/source-selection";
import { fileWindowCoverage } from "@/lib/scoring/prompt";
import type {
  CommitInfo,
  DimensionId,
  Governance,
  LlmAssessment,
  LlmClaim,
  Discrepancy,
  LlmRoadmapItem,
  PrStats,
  RepoSnapshot,
  SecurityExposure,
  SecurityPosture,
} from "@/lib/types";

/** The one clock every fixture is scored at (D7's recency bonus reads it). */
export const RUBRIC_NOW = "2026-09-20T00:00:00.000Z";

export interface RubricFixture {
  id: string;
  /** The honesty rule this fixture exists to exercise, in one sentence. */
  rule: string;
  snapshot: RepoSnapshot;
  prStats: PrStats | null;
  governance: Governance | null;
  securityPosture: SecurityPosture | null;
  securityExposure: SecurityExposure | null;
  appInventory?: AppInventory | null;
  ciHealth?: CiHealth | null;
  /** The canned model answer this fixture is assembled against. */
  assessment: LlmAssessment;
}

const DIMS: DimensionId[] = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"];

/** A snapshot from `{path: content}` plus paths that are listed in the tree but were not fetched. */
function snap(
  name: string,
  files: Record<string, string>,
  opts: { listed?: string[]; commits?: CommitInfo[]; coverage?: number } = {},
): RepoSnapshot {
  const fetched = Object.entries(files).map(([path, content]) => ({ path, content, bytes: content.length }));
  const paths = [...fetched.map((f) => f.path), ...(opts.listed ?? [])];
  return {
    meta: {
      owner: "rubric-corpus",
      name,
      url: `https://github.com/rubric-corpus/${name}`,
      stars: 12,
      forks: 1,
      defaultBranch: "main",
      headSha: "0000000000000000000000000000000000000000",
      primaryLanguage: "TypeScript",
      pushedAt: "2026-09-18T00:00:00.000Z",
    },
    tree: paths.map((path) => ({ path, type: "blob" as const })),
    files: fetched,
    commits: opts.commits ?? [{ message: "initial commit" }],
    truncated: false,
    coverage: opts.coverage ?? 1,
  };
}

/** The canned model answer: every dimension scored at `llm[id] ?? 50`, plus whatever the fixture adds. */
function assess(opts: {
  llm?: Partial<Record<DimensionId, number>>;
  roadmap?: LlmRoadmapItem[];
  discrepancies?: Discrepancy[];
  claims?: LlmClaim[];
} = {}): LlmAssessment {
  return {
    dimensions: DIMS.map((id) => ({
      id,
      score: opts.llm?.[id] ?? 50,
      summary: `${id} as the fixture model read it.`,
      strengths: [],
      gaps: [`${id} gap named by the fixture model`],
    })),
    headline: "Fixture assessment.",
    strengths: ["fixture strength"],
    risks: ["fixture risk"],
    roadmap: opts.roadmap ?? [
      { title: "Wire CI into merges", dimension: "D3", impact: "high", effort: "low", rationale: "fixture" },
    ],
    discrepancies: opts.discrepancies ?? [],
    ...(opts.claims ? { claims: opts.claims } : {}),
  };
}

const commits = (n: number, make: (i: number) => string): CommitInfo[] =>
  Array.from({ length: n }, (_, i) => ({ message: make(i), authorLogin: `dev${i % 3}`, committedAt: "2026-09-15T00:00:00.000Z" }));

const README_LONG = `# Full house\n\n${"## Section\nHow to build, test and ship this service, with examples.\n\n".repeat(30)}`;
const GUIDANCE = [
  "# Agent guide",
  "",
  "## Commands",
  "- Install: `npm ci`",
  "- Test: `npm test`",
  "- Lint: `npm run lint`",
  "",
  "## Rules",
  "- Never commit secrets; read SECURITY.md before touching auth.",
  "- Every change needs a test; run the suite before pushing.",
  "- Keep modules under 300 lines; extract instead of appending.",
].join("\n");
const REVIEW_PROMPT = `# Review rubric\n\n${"Check the change for missing tests, unsafe input handling and unclear names. ".repeat(4)}`;

const PR_STATS: PrStats = {
  analyzed: 40, totalCount: 400, open: 3, merged: 36, closedUnmerged: 4, mergeRate: 90,
  reviewedRate: 85, avgReviews: 1.4, avgComments: 2, medianHoursToMerge: 6, medianHoursToFirstReview: 2,
  avgLineChanges: 120, avgChangedFiles: 4, smallPrRate: 70, botAuthoredRate: 10, aiInvolvedRate: 45,
  aiGovernedRate: 80, revertRate: 2, draftRate: 5, tools: [{ name: "Claude", count: 12 }],
  aiAuthoredPrs: 4, aiMarkedPrs: 12, aiTrailerPrs: 2, aiTrailerRate: 40, aiPreReviewedRate: 50,
  reworkRate: 3, aiReworkRate: null,
};
const GOVERNANCE: Governance = {
  defaultBranch: "main", protected: true, requiresPullRequest: true, requiredApprovals: 1,
  requiresCodeOwnerReview: true, requiresStatusChecks: true, requiresSignatures: false,
  linearHistory: true, ruleCount: 5, readable: true,
};

// ---- the window-overflow fixture: more fetched text than the prompt window holds ------------------
const OVERFLOW_FILES: Record<string, string> = {
  "README.md": "# overflow\nA service with more source than the prompt window can show.",
  ...Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => [`src/module-${String(i).padStart(2, "0")}.ts`, `export const m${i} = ${JSON.stringify("x".repeat(2400))};\n`]),
  ),
};
const overflowFetched = Object.entries(OVERFLOW_FILES).map(([path, content]) => ({ path, content }));
/** The coverage figure the ingest path would compute: every pick fetched, the window drops the rest. */
const OVERFLOW_COVERAGE = estimateCoverage(
  overflowFetched.length,
  overflowFetched.length,
  overflowFetched.length,
  false,
  0,
  fileWindowCoverage(overflowFetched).omitted,
);

export const RUBRIC_CORPUS: readonly RubricFixture[] = [
  {
    id: "bare",
    rule: "an empty repo floors honestly, and an empty model roadmap falls back to the engine's own",
    snapshot: snap("bare", { "README.md": "# bare\nA small tool." }),
    prStats: null, governance: null, securityPosture: null, securityExposure: null,
    assessment: assess({ llm: { D1: 20, D5: 30 }, roadmap: [] }),
  },
  {
    id: "full-house",
    rule: "every detector fires, including D6 enforcement (a ratchet and a zero-warning gate)",
    snapshot: snap(
      "full-house",
      {
        "README.md": README_LONG,
        "AGENTS.md": GUIDANCE,
        "package.json": JSON.stringify({
          scripts: { test: "vitest run", lint: "eslint . --max-warnings 0", "check:ceiling": "node scripts/suppression-ceiling.mjs" },
          devDependencies: { eslint: "9", prettier: "3", husky: "9", vitest: "3", typescript: "5" },
        }),
        "tsconfig.json": '{ "compilerOptions": { "strict": true } }',
        ".eslintrc.json": '{ "root": true }',
        ".prettierrc": "{}",
        "src/sum.test.ts": "it('adds', () => { expect(sum(1, 2)).toBe(3); });\nit('throws', () => { expect(() => sum()).toThrow(); });\n",
        ".github/workflows/ci.yml": "on: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  ci:\n    steps:\n      - run: npm ci\n      - run: npm test\n      - run: npm run lint\n      - run: npx tsc --noEmit\n",
        ".github/workflows/review.yml": "on:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  review:\n    steps:\n      - uses: anthropics/claude-code-action@v1\n",
        ".github/workflows/codeql.yml": "on: [push]\njobs:\n  scan:\n    steps:\n      - uses: github/codeql-action/analyze@v3\n",
        ".github/review-prompt.md": REVIEW_PROMPT,
        ".github/dependabot.yml": "version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n",
        "SECURITY.md": "# Security\nReport vulnerabilities privately to security@example.test.",
        "CONTRIBUTING.md": "# Contributing\nDefinition of done: tests pass and an agent review ran.",
      },
      {
        listed: [
          "vitest.config.ts", ".husky/pre-commit", ".github/CODEOWNERS", "commitlint.config.js", "CHANGELOG.md",
          "docs/architecture.md", "docs/operations.md", "docs/adr/0001-record.md", "evals/golden.test.ts",
          "prompts/review.md", "src/sum.ts", ".github/pull_request_template.md",
        ],
        commits: commits(12, (i) => `feat(core): step ${i}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`),
      },
    ),
    prStats: null, governance: null, securityPosture: null, securityExposure: null,
    assessment: assess({ llm: { D2: 70, D3: 70, D6: 80 } }),
  },
  {
    id: "gerrit",
    rule: "review that runs off GitHub is credited from commit trailers, and GitHub's reviewedRate is not held against it",
    snapshot: snap(
      "gerrit",
      { "README.md": "# gerrit\nReviewed on Gerrit.", "go.mod": "module example.test/gerrit\n\ngo 1.23\n" },
      {
        commits: commits(10, (i) => `net: fix case ${i}\n\nChange-Id: I${String(i).padStart(2, "0")}0123456789abcdef0123456789abcdef01234567\nReviewed-on: https://go-review.googlesource.com/c/net/+/${1000 + i}`),
      },
    ),
    prStats: { ...PR_STATS, reviewedRate: 4, aiPreReviewedRate: null },
    governance: null, securityPosture: null, securityExposure: null,
    assessment: assess({ llm: { D6: 60 } }),
  },
  {
    id: "contradicting-guidance",
    rule: "two guidance files that disagree lose the coherence band, and a cited contradiction scores zero",
    snapshot: snap("contradicting-guidance", {
      "README.md": "# contradicting\nTwo guides.",
      "AGENTS.md": GUIDANCE,
      ".cursorrules": "# Cursor rules\n\n## Commands\n- Test: `yarn jest --ci`\n- Lint: `yarn eslint .`\n",
    }),
    prStats: null, governance: null, securityPosture: null, securityExposure: null,
    assessment: assess({
      claims: [
        { dimension: "D1", facet: "contradiction", path: "AGENTS.md", quote: "- Test: `npm test`", path2: ".cursorrules", quote2: "- Test: `yarn jest --ci`" },
      ],
    }),
  },
  {
    id: "tokened",
    rule: "a token scan folds PR, governance, the installed-App inventory and CI health into the signals",
    snapshot: snap("tokened", {
      "README.md": "# tokened\nScanned with a token.",
      "package.json": JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "3" } }),
      ".github/workflows/ci.yml": "on: [push, pull_request]\njobs:\n  ci:\n    steps:\n      - run: npm test\n",
    }),
    prStats: PR_STATS,
    governance: GOVERNANCE,
    securityPosture: { advisoryCount: 2, advisoryCapped: false, orgSecurityPolicy: true },
    securityExposure: { known: true, source: "osv", critical: 0, high: 1, medium: 2, low: 0, scanned: 40 },
    appInventory: {
      sha: "0000000000000000000000000000000000000000",
      apps: [
        { slug: "coderabbitai", name: "CodeRabbit", conclusion: "success" },
        { slug: "github-code-scanning", name: "GitHub Code Scanning", conclusion: "success" },
        { slug: "codecov", name: "Codecov", conclusion: "success" },
        { slug: "github-actions", name: "GitHub Actions", conclusion: "success" },
      ],
      total: 4,
      truncated: false,
    },
    ciHealth: { branch: "main", sampled: 30, successRate: 96, medianDurationMin: 7, latestRunAt: "2026-09-19T00:00:00.000Z", workflows: 2, failing: [] },
    assessment: assess(),
  },
  {
    id: "claims",
    rule: "the model moves D1 and D4 only by citations the verifier confirms, and a copy agreeing with its source proves nothing",
    snapshot: snap(
      "claims",
      {
        "README.md": "# claims\nA repo whose practice only a reader can see.",
        "AGENTS.md": GUIDANCE,
        ".github/copilot-instructions.md": GUIDANCE,
        "CLAUDE.md": "# Claude\n\nThe house rules an agent must follow are kept in AGENTS.md, and that file wins any disagreement.\n",
        ".github/workflows/review.yml": "on:\n  pull_request:\njobs:\n  critic:\n    steps:\n      - run: node scripts/pr-critic.mjs\n",
      },
      { commits: [{ message: "fix(parser): address pr-critic findings on the tokenizer" }, { message: "feat: parser" }] },
    ),
    prStats: null, governance: null, securityPosture: null, securityExposure: null,
    assessment: assess({
      claims: [
        { dimension: "D1", facet: "canonical_declared", path: "CLAUDE.md", quote: "The house rules an agent must follow are kept in AGENTS.md" },
        { dimension: "D1", facet: "commands_agree", path: "AGENTS.md", quote: "- Test: `npm test`", path2: ".github/copilot-instructions.md", quote2: "- Test: `npm test`" },
        { dimension: "D4", facet: "automated_review", path: ".github/workflows/review.yml", quote: "run: node scripts/pr-critic.mjs" },
        // Quoted with the prompt's own bullet, the way the model copies a commit line.
        { dimension: "D4", facet: "observed", path: "commits", quote: "- fix(parser): address pr-critic findings on the tokenizer" },
      ],
    }),
  },
  {
    id: "widened-d9-hatch",
    rule: "two flagged discrepancies widen their guardbands, and a D9 visibility claim renormalizes D9 out",
    snapshot: snap("widened-d9-hatch", {
      "README.md": "# widened\nTests and CI the detectors under-read.",
      "src/a.test.ts": "it('a', () => { expect(1).toBe(1); });\n",
      ".github/workflows/ci.yml": "on: [push]\njobs:\n  ci:\n    steps:\n      - run: make ci\n",
    }),
    prStats: null, governance: null, securityPosture: null, securityExposure: null,
    assessment: assess({
      llm: { D2: 90, D3: 90 },
      discrepancies: [
        { dimension: "D2", claim: "The suite runs through make ci, which the detector did not read." },
        { dimension: "D3", claim: "Delivery runs through a Makefile target the detector did not credit." },
        { dimension: "D9", claim: "Code scanning runs via GitHub default setup configured in repo settings." },
      ],
    }),
  },
  {
    id: "discrepancy-blown",
    rule: "a self-audit that suspects most detectors widens nothing and suppresses the D9 hatch",
    snapshot: snap("discrepancy-blown", {
      "README.md": "# blown\nEvery detector is wrong, says the model.",
      "src/a.test.ts": "it('a', () => { expect(1).toBe(1); });\n",
    }),
    prStats: null, governance: null, securityPosture: null, securityExposure: null,
    assessment: assess({
      llm: { D2: 95, D3: 95, D5: 95, D6: 95 },
      discrepancies: [
        { dimension: "D2", claim: "Tests are everywhere." },
        { dimension: "D3", claim: "CI is somewhere else." },
        { dimension: "D5", claim: "Docs live in a wiki." },
        { dimension: "D6", claim: "Lint runs in the IDE." },
        { dimension: "D9", claim: "Security is configured in repo settings." },
      ],
    }),
  },
  {
    id: "window-overflow",
    rule: "a fetched set larger than the prompt window lowers coverage and the blend, and the model is told what it did not see",
    snapshot: snap("window-overflow", OVERFLOW_FILES, { coverage: OVERFLOW_COVERAGE }),
    prStats: null, governance: null, securityPosture: null, securityExposure: null,
    assessment: assess({ llm: { D2: 80, D5: 80 } }),
  },
];
