// Fixture view models for the Developer route, selected by the client-side "preview as" control
// (docs/REGISTRY-AND-CARE-IMPL.md §5.3 — React state, never a search param).
//
// PREVIEW ONLY. Imported lazily by `DeveloperHome` and shown only while the real view has nothing to
// render, and every fixture carries `demo` so the page can stamp a visible "preview" chip — a fixture
// must never be mistaken for a developer's real data.
//
//   personal        the developer's home, populated (the argument-making state)
//   personal-empty  the mentor has never shared — the invitation state

import {
  emptyDeveloperView,
  type CareBand,
  type CareMove,
  type CareShapeField,
  type DeveloperView,
} from "./developer-view";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const MOVES: CareMove[] = [
  {
    id: "plan-mode-multifile",
    title: "Plan mode before any multi-file change",
    state: "kept",
    category: "session",
    why: "Journal: 9 of your last 14 sessions touched 3+ files; 6 of those needed a re-correction in turn 2-4.",
    evidence: "4 repos in this org adopted the same move — median 2.1 fewer turns per session.",
    expectedSaving: 95,
    tryFor: null,
    registryPromotable: true,
    at: ago(6),
  },
  {
    id: "tests-before-commit",
    title: "Run the test command before every commit",
    state: "kept",
    category: "verification",
    why: "Journal: 5 sessions ended with a commit and no test run; 2 of those were reverted the next day.",
    evidence: "ascent-web gained +6 on D2 within two scans of adopting a pre-commit test hook.",
    expectedSaving: 60,
    tryFor: null,
    registryPromotable: true,
    at: ago(12),
  },
  {
    id: "claude-md-commands",
    title: "Seed CLAUDE.md for acme/billing-api with the four commands you keep re-explaining",
    state: "trying",
    category: "context",
    why: "Journal: `pnpm test:int`, the migration command and the seed script were re-explained in 7 sessions.",
    evidence: "This is D5's open recommendation on that repo — you would be its champion.",
    expectedSaving: 45,
    tryFor: 5,
    at: ago(2),
  },
  {
    id: "review-skill",
    title: "Install /code-review from the registry and run it on the diff",
    state: "trying",
    category: "tooling",
    why: "Journal: 3 sessions ended with a review round-trip that the local skill would have caught.",
    evidence: "Registry catalog: 11 invokes across 3 repos in the last 30 days; 0 reported regressions.",
    expectedSaving: 30,
    tryFor: 8,
    at: ago(3),
  },
  {
    id: "permission-allowlist",
    title: "Allowlist the six commands you re-approve every session",
    state: "proposed",
    category: "tooling",
    why: "Journal: 41 permission prompts in 30 days, 38 of them for the same six commands.",
    evidence: null,
    expectedSaving: 25,
    tryFor: 10,
    at: ago(1),
  },
  {
    id: "effort-default",
    title: "Drop to a lighter model for the short lookup sessions",
    state: "proposed",
    category: "cost",
    why: "Journal: 22 sessions were under 4 turns and read-only — the heavy default bought nothing.",
    evidence: null,
    expectedSaving: null,
    tryFor: 6,
    at: ago(1),
  },
  {
    id: "smaller-asks",
    title: "Split asks smaller (one file per turn)",
    state: "dropped",
    category: "session",
    why: "Journal: long asks correlated with re-corrections.",
    evidence: null,
    expectedSaving: 20,
    tryFor: null,
    droppedReason: "Broke your flow on refactors — cost more than it saved after 6 sessions.",
    at: ago(21),
  },
];

const BANDS: Partial<Record<CareShapeField, CareBand>> = {
  sessionsPerWeek: { p25: 6, p50: 11, p75: 17 },
  turnsPerSession: { p25: 7, p50: 11, p75: 18 },
  planModePct: { p25: 12, p50: 31, p75: 58 },
  retriesPerSession: { p25: 1, p50: 2, p75: 4 },
  testsBeforeCommitPct: { p25: 34, p50: 61, p75: 84 },
  skillInvokes30d: { p25: 4, p50: 14, p75: 39 },
};

function personalFixture(login: string | null): DeveloperView {
  return {
    login,
    demo: "personal",
    profile: {
      role: "Backend engineer",
      archetypeHint: "verifier",
      goals: [
        "Stop re-explaining the same build commands",
        "Ship with tests run, every time",
        "Spend less of the week on review round-trips",
      ],
      sharedAt: ago(1),
    },
    moves: MOVES,
    shape: {
      sessionsPerWeek: 14,
      turnsPerSession: 9,
      planModePct: 62,
      retriesPerSession: 2,
      testsBeforeCommitPct: 71,
      skillInvokes30d: 23,
    },
    sharedFields: [
      "sessionsPerWeek",
      "turnsPerSession",
      "planModePct",
      "retriesPerSession",
      "testsBeforeCommitPct",
      "skillInvokes30d",
    ],
    orgBands: BANDS,
    activity: {
      commits: 412,
      aiCommits: 268,
      aiShare: 65,
      repos: 3,
      lastActiveAt: ago(1),
      champion: true,
    },
    myRepos: [
      {
        fullName: "acme/billing-api",
        level: "L3",
        score: 58,
        openRecommendations: [
          { title: "Document the build + test commands in CLAUDE.md", dimension: "D5" },
          { title: "Add a pre-commit test hook", dimension: "D2" },
        ],
      },
      {
        fullName: "acme/web",
        level: "L4",
        score: 71,
        openRecommendations: [{ title: "Adopt /code-review on pull requests", dimension: "D3" }],
      },
      {
        fullName: "acme/ledger-worker",
        level: "L2",
        score: 41,
        openRecommendations: [
          { title: "Write an .ai/manifest.yaml pointing at the registry", dimension: "D1" },
          { title: "Add a context map", dimension: "D8" },
        ],
      },
    ],
    journal: [
      { at: ago(1), line: "Plan mode held for the whole billing refactor — two turns, no re-correction.", kind: "retro" },
      { at: ago(4), line: "Week: retries down from 4 to 2 per session. Protecting plan mode.", kind: "weekly" },
      { at: ago(6), line: "Kept: plan mode before any multi-file change.", kind: "move" },
      { at: ago(9), line: "Re-explained the migration command again. That is the CLAUDE.md move.", kind: "retro" },
      { at: ago(11), line: "Week: tests ran before 5 of 6 commits. Best week so far.", kind: "weekly" },
      { at: ago(12), line: "Kept: run the test command before every commit.", kind: "move" },
      { at: ago(21), line: "Dropped: smaller asks — cost more than it saved.", kind: "move" },
    ],
    setup: {
      mentorInstalled: true,
      hookInstalled: true,
      lastShareAt: ago(1),
      sharing: [
        { field: "Session counts (30d)", shared: true },
        { field: "Plan-mode ratio", shared: true },
        { field: "Tests-before-commit ratio", shared: true },
        { field: "Skill invokes", shared: true },
        { field: "Moves kept / dropped", shared: true, note: "titles only, as counts in org mode" },
        { field: "Transcript text", shared: false, note: "never leaves your machine — not a setting" },
        { field: "Prompts, diffs, file contents", shared: false, note: "never collected" },
        { field: "Per-person rows in org mode", shared: false, note: "unrepresentable in the org view model" },
      ],
    },
  };
}

function personalEmptyFixture(login: string | null): DeveloperView {
  return { ...emptyDeveloperView(login), demo: "personal-empty" };
}

/** Resolve a preview id to a fixture, or null when it names nothing. */
export function developerFixture(demo: string, login: string | null = null): DeveloperView | null {
  switch (demo) {
    case "personal":
      return personalFixture(login);
    case "personal-empty":
      return personalEmptyFixture(login);
    default:
      return null;
  }
}

/** The preview states, for the page's "Preview as" control. */
export const DEVELOPER_PREVIEW_STATES = ["personal", "personal-empty"] as const;
