// Test fixtures for the ledger — one factory per record, each a complete, valid row with a sensible
// default, so a test states only the field it is about. Not imported by any production file.

import type { LoopLaneRecord, LoopRunDetail } from "../cockpit/loopTypes";
import type {
  DriveStatus,
  LedgerData,
  LoopDirectionRecord,
  LoopPlanRecord,
  LoopRunChronicleEntry,
  RepoRunnerState,
  RunnerKeptLessonRow,
} from "./ledgerTypes";

export const NOW = "2026-09-18T12:00:00.000Z";
/** Six hours before NOW — the default anchor. */
export const SEEN = "2026-09-18T06:00:00.000Z";
export const at = (hoursBeforeNow: number): string => new Date(Date.parse(NOW) - hoursBeforeNow * 3_600_000).toISOString();

export const chronicleRun = (seq: number | null, over: Partial<LoopRunChronicleEntry> = {}): LoopRunChronicleEntry => ({
  id: `run-${seq ?? "x"}`,
  phase: "done",
  repos: ["acme/kp"],
  cycle: 1,
  maxCycles: 3,
  startedAt: at(2),
  endedAt: at(1),
  lift: null,
  model: null,
  effort: null,
  costMicros: null,
  seq,
  driveId: null,
  planMode: null,
  lanes: 1,
  verifiedCloses: 0,
  landedAt: [],
  error: null,
  ...over,
});

export const plan = (id: string, over: Partial<LoopPlanRecord> = {}): LoopPlanRecord => ({
  id,
  orgId: "org-acme",
  repo: "acme/kp",
  runId: "run-7",
  laneId: "lane-1",
  directionId: null,
  itemKeys: ["k1"],
  recIds: ["r1"],
  itemTitles: ["Split the scoring engine"],
  plan: {
    v: 1,
    intent: "Split scoring into its own module",
    items: [{ recommendationId: "r1", approach: "Move the rubric out of engine.ts", files: ["src/scoring/engine.ts"], moves: [{ kind: "module-split", from: "src/scoring/", to: "src/rubric/" }] }],
    modules: ["src/scoring/", "src/rubric/"],
    check: "npm test passes",
    risks: ["imports churn"],
    notDoing: ["no behaviour change"],
  },
  planText: "```json\n{ \"v\": 1 }\n```",
  partition: { source: "context-map", modules: ["src/scoring/", "src/rubric/"] },
  cls: "major",
  clsReason: "declared-moves",
  status: "pending",
  sessionId: null,
  heldBranch: null,
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  createdAt: at(3),
  updatedAt: at(3),
  ...over,
});

export const direction = (id: string, over: Partial<LoopDirectionRecord> = {}): LoopDirectionRecord => ({
  id,
  orgId: "org-acme",
  repo: "acme/kp",
  title: "Split scoring into its own module",
  fence: ["src/scoring/"],
  checkText: "npm test passes",
  budgetCycles: 3,
  budgetMicros: null,
  usedCycles: 1,
  usedMicros: 0,
  status: "active",
  originPlanId: "plan-1",
  approvedBy: "alice",
  approvedAt: at(10),
  createdAt: at(10),
  updatedAt: at(10),
  endedAt: null,
  ...over,
});

export const repoState = (repo: string, over: Partial<RepoRunnerState> = {}): RepoRunnerState => ({
  repo,
  baseBranch: "main",
  paused: null,
  pausedUntil: null,
  note: null,
  failureStreak: 0,
  dryStreak: 0,
  lastMergeInSha: null,
  lastLandedSha: "abcdef1234567890",
  aheadOfBase: null,
  ...over,
});

export const runnerDrive = (over: Partial<DriveStatus> = {}): DriveStatus => ({
  id: "drive_runner",
  org: "acme",
  phase: "running",
  repos: ["acme/kp"],
  maxRuns: 0,
  maxCycles: 3,
  concurrency: 2,
  runs: [],
  measurement: null,
  runsBefore: 0,
  resumedFrom: null,
  startedAt: at(30),
  endedAt: null,
  error: null,
  stopRequested: false,
  mode: "continuous",
  pausedReason: null,
  pausedUntil: null,
  repoState: [repoState("acme/kp")],
  ...over,
});

export const keptLesson = (id: string, over: Partial<RunnerKeptLessonRow> = {}): RunnerKeptLessonRow => ({
  id,
  repo: "acme/kp",
  content: "Run the typecheck before the unit tests — it is ten times faster to fail.",
  laneId: "lane-1",
  memoryId: `mem-${id}`,
  state: "kept",
  keptAt: at(4),
  revokedBy: null,
  revokedAt: null,
  createdAt: at(5),
  ...over,
});

export const ledgerData = (over: Partial<LedgerData> = {}): LedgerData => ({
  slug: "acme",
  now: NOW,
  isOwner: true,
  selfHosted: true,
  seenAt: SEEN,
  runner: runnerDrive(),
  lastRunner: runnerDrive(),
  activeRun: null,
  driveModes: { drive_runner: "continuous" },
  pending: [],
  plans: [],
  directions: [],
  runs: [],
  runsHasMore: false,
  lessons: [],
  ahead: { "acme/kp": 3 },
  failed: [],
  ...over,
});

export const lane = (id: string, over: Partial<LoopLaneRecord> = {}): LoopLaneRecord =>
  ({
    id,
    runId: "run-7",
    repoFullName: "acme/kp",
    cycle: 1,
    phase: "done",
    branch: "ascent/loop-1-kp",
    batchIds: ["r1", "r2"],
    closedIds: ["r1"],
    commits: 2,
    log: Array.from({ length: 50 }, (_, i) => `line ${i + 1}`),
    error: null,
    deliverables: [{ headline: "Split the rubric out", dimId: null, kind: "closed", covers: ["r1"], evidence: null }],
    costMicros: 42_000_000,
    verifyVerdict: "verified",
    verifyRung: "primary",
    planId: "plan-1",
    proposed: { items: [{ id: "r1", title: "a", dimId: null, kind: "gap", craftAxis: null }, { id: "r2", title: "b", dimId: null, kind: "gap", craftAxis: null }, { id: "r3", title: "c", dimId: null, kind: "gap", craftAxis: null }], excluded: { deferred: 1, heldByPlan: 0, unmeasurable: 2, heldByOtherWorker: 0 }, curated: false },
    landedAt: at(1),
    report: { v: 1, parsed: true, items: [], lessons: ["Prefer the narrow import."] },
    ...over,
  }) as LoopLaneRecord;

export const runDetail = (lanes: LoopLaneRecord[]): LoopRunDetail =>
  ({ run: { id: "run-7", seq: 7 }, lanes, outcomes: [], economics: [], itemOutcomes: [] }) as unknown as LoopRunDetail;
