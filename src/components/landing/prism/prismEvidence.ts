import { at } from "./at";

// Illustrative material for the Prism landing: what a reading, an evidence file and a next step COULD
// look like for each dimension. None of it is a measured repository, and every place it renders carries an
// "Illustrative" tag. Kept apart from the real rubric (prismModel.ts) so the two never get confused.

/** Which analyzer read the file, as the evidence panel prints it. */
export type EvidenceSource = "git ls-files" | "GitHub API" | "git log";

export interface PrismEvidence {
  /** Path (or pseudo-path) of the file the finding came from. */
  path: string;
  via: EvidenceSource;
  /** The verbatim excerpt, one string per line. */
  code: readonly string[];
  /** Level id this finding supports. */
  level: string;
  /** One sentence on what it shows. */
  note: string;
}

/** Illustrative reading (0-100) of each line on the ladder, by dimension index. */
export const READ: readonly number[] = [62,71,58,38,55,74,49,44,60];

/** Illustrative "next on this line" step per dimension. */
export const ROUTE: readonly string[] = [
  "Move the README guidance into an AGENTS.md that agents load on every task.",
  "Put coverage floors in CI so the suite cannot quietly shrink.",
  "Require the pipeline to pass before anything merges to main.",
  "Let an agent propose fixes for failing checks, on its own branch, behind human review.",
  "Record the next architectural decision as an ADR beside the code.",
  "Run lint and type checks in a pre-commit hook, not only in CI.",
  "Adopt conventional commits so history is machine-readable.",
  "Put lint, types and tests behind one verify script every agent calls.",
  "Turn on scheduled dependency updates and publish a security policy.",
];

export const EVIDENCE: readonly (readonly PrismEvidence[])[] = [
  [
    { path: "AGENTS.md", via: "git ls-files", level: "L3", note: "Shared, machine-readable guidance an agent can follow without asking.",
      code: ["# Working in this repository","","## Build and test","Run `npm run verify` before every commit.","It runs lint, types and the unit suite.","","## Conventions","New modules ship with a test beside them."] },
    { path: ".ai/rules/review.md", via: "git ls-files", level: "L4", note: "Scoped rules that route agent work through human review.",
      code: ["---","appliesTo: \"src/**\"","---","Agents open pull requests as drafts.","A human marks them ready for review.","Never edit generated files under src/gen/."] },
    { path: "README.md", via: "GitHub API", level: "L2", note: "Guidance also reaches people, pointing them at the machine-readable file.",
      code: ["## Contributing with an assistant","Read AGENTS.md before you ask","for a change; it lists the commands","and the conventions we hold to."] },
  ],
  [
    { path: "vitest.config.ts", via: "git ls-files", level: "L3", note: "Coverage floors enforced by configuration.",
      code: ["test: {","  coverage: {","    provider: 'v8',","    thresholds: { lines: 80, branches: 70 },","  },","},"] },
    { path: "src/**/*.test.ts", via: "git ls-files", level: "L3", note: "Breadth: tests sit beside most modules.",
      code: ["412 test files","1,180 source files","0.35 test files per source file"] },
    { path: ".github/workflows/e2e.yml", via: "git ls-files", level: "L4", note: "User journeys are verified end to end on every pull request.",
      code: ["- name: End-to-end","  run: npx playwright test","  env:","    CI: true"] },
  ],
  [
    { path: ".github/workflows/ci.yml", via: "git ls-files", level: "L2", note: "Every pull request runs the pipeline.",
      code: ["name: CI","on:","  pull_request:","    branches: [main]","  push:","    branches: [main]"] },
    { path: "branch protection: main", via: "GitHub API", level: "L3", note: "Nothing merges red, and a human approves.",
      code: ["required_status_checks:","  strict: true","  contexts: [verify, e2e]","required_approving_review_count: 1"] },
    { path: ".github/workflows/release.yml", via: "git ls-files", level: "L4", note: "Releases are cut by the pipeline, not by hand.",
      code: ["on:","  push:","    tags: ['v*']","jobs:","  release:","    steps:","      - run: npm run build","      - run: npm publish --provenance"] },
  ],
  [
    { path: ".github/workflows/ai-review.yml", via: "git ls-files", level: "L4", note: "An agent takes part in review; approval stays human.",
      code: ["name: AI review","on: pull_request","jobs:","  review:","    steps:","      - uses: actions/checkout@v4","      - run: npx review-agent --diff origin/main","        # comments inline, never approves"] },
    { path: "renovate.json", via: "git ls-files", level: "L4", note: "Dependency updates open, test and merge themselves inside a policy.",
      code: ["{","  \"extends\": [\"config:recommended\"],","  \"automerge\": true,","  \"automergeType\": \"pr\",","  \"matchUpdateTypes\": [\"patch\"]","}"] },
    { path: ".github/workflows/autofix.yml", via: "git ls-files", level: "L4", note: "A failing check becomes a proposed fix on its own branch.",
      code: ["on:","  check_run:","    types: [completed]","jobs:","  fix:","    if: github.event.check_run.conclusion == 'failure'","    steps:","      - run: npx fix-agent --open-pr"] },
  ],
  [
    { path: "docs/adr/0007-queue-backpressure.md", via: "git ls-files", level: "L3", note: "Decisions are written down where agents and newcomers find them.",
      code: ["# 7. Queue backpressure","","Status: Accepted","","## Context","Scans arrive in bursts; the worker pool","must shed load instead of timing out."] },
    { path: "CHANGELOG.md", via: "git ls-files", level: "L2", note: "Changes are recorded per release.",
      code: ["## 2.4.0","### Added","- Org view groups repositories by team","### Fixed","- Badge renders on dark READMEs"] },
    { path: "AGENTS.md", via: "git ls-files", level: "L4", note: "Docs written for agents as well as for people.",
      code: ["## Architecture map","src/scan     analyzers, one per dimension","src/score    weighting and guardbands","src/report   evidence and routes","Do not import report from scan."] },
  ],
  [
    { path: "tsconfig.json", via: "git ls-files", level: "L3", note: "The type checker refuses the unsafe paths generated code might take.",
      code: ["\"compilerOptions\": {","  \"strict\": true,","  \"noUncheckedIndexedAccess\": true,","  \"exactOptionalPropertyTypes\": true","}"] },
    { path: ".husky/pre-commit", via: "git ls-files", level: "L3", note: "Checks run before a commit exists.",
      code: ["#!/usr/bin/env sh","npx lint-staged","npm run typecheck"] },
    { path: ".github/CODEOWNERS", via: "git ls-files", level: "L3", note: "Every path has an owner who reviews it.",
      code: ["*               @platform","/src/billing/   @payments-team","/infra/         @sre"] },
  ],
  [
    { path: "git log: trailers", via: "git log", level: "L3", note: "Direct evidence that AI takes part in writing changes.",
      code: ["Co-authored-by: coding-agent <agent@example.invalid>","  on 137 of 412 commits, last 90 days"] },
    { path: "git log --oneline", via: "git log", level: "L2", note: "Conventional commits make history machine-readable.",
      code: ["feat(api): paginate org scans","fix(ui): focus ring on dark surfaces","chore(deps): bump undici","docs(adr): record queue backpressure","test(score): pin guardband edges"] },
    { path: "git log: cadence", via: "git log", level: "L3", note: "Small, frequent changes: the rhythm autonomy needs.",
      code: ["merges to main on 22 of 30 days","median pull request open 9 h"] },
  ],
  [
    { path: "scripts/verify.sh", via: "git ls-files", level: "L3", note: "One gate every human and agent runs the same way.",
      code: ["#!/usr/bin/env bash","set -euo pipefail","npm run lint","npm run typecheck","npm test -- --run"] },
    { path: "evals/summarize-diff.yaml", via: "git ls-files", level: "L4", note: "Prompts are tested like code, in CI.",
      code: ["eval: summarize-diff","cases: 40","threshold: 0.9","run: on pull_request","fail_below: true"] },
    { path: ".github/pull_request_template.md", via: "git ls-files", level: "L3", note: "Human review of agent work is an explicit, repeatable step.",
      code: ["## Checklist","- [ ] verify.sh passes locally","- [ ] Agent-authored changes reviewed line by line","- [ ] Evidence linked for any new rule"] },
  ],
  [
    { path: ".github/dependabot.yml", via: "git ls-files", level: "L3", note: "Dependencies are watched and updated on a schedule.",
      code: ["version: 2","updates:","  - package-ecosystem: \"npm\"","    directory: \"/\"","    schedule:","      interval: \"weekly\""] },
    { path: ".github/workflows/codeql.yml", via: "git ls-files", level: "L3", note: "Static security analysis on every change.",
      code: ["- uses: github/codeql-action/init@v3","  with:","    languages: javascript-typescript","- uses: github/codeql-action/analyze@v3"] },
    { path: "SECURITY.md", via: "git ls-files", level: "L2", note: "A private path to report what scanners miss.",
      code: ["# Security policy","Report a vulnerability privately through","GitHub security advisories. We answer","within five working days."] },
  ],
];

/** The evidence tabled for dimension `i`. */
export const evidenceFor = (i: number): readonly PrismEvidence[] => at(EVIDENCE, i);
