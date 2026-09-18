// THE STANDING RUNNER'S WIRE CONTRACT — every identifier the engine, the API and the three views share
// (spark theater-upgrade, 2026-09-18).
//
// DEPENDENCY-FREE on purpose, for the same reason `delivery-options.ts` and `drive-types.ts` are: the
// ledger and the theater import these shapes in the BROWSER, and the engine imports them on the
// server. Two declarations of one vocabulary is how a field silently stops arriving, so there is
// exactly one, here, and nothing in this file may import a module that reaches for the db, the
// filesystem or `process`.
//
// WHAT THE RUNNER IS. A `continuous` drive (`LoopDrive.mode`) that works each repo's backlog and then
// its craft ladder indefinitely. It never stops on green, dry or a run cap; it PAUSES, on a named
// breaker, with the reason on every surface. Verified work lands on a per-repo runner branch
// (`RUNNER_BRANCH`), never on the operator's working branch; merging that branch is the operator's.
// Every lane opens with a read-only planning session, and only a plan that moves ARCHITECTURE waits
// for a human — contract, dependency and footprint changes are auto-approved by operator decision.
//
// Timestamps are ISO STRINGS throughout (AGENTS.md: a wire type never declares a `Date`).

/** The one long-lived branch per repo the runner accumulates verified work on. Never checked out
 *  anywhere: landing is a fast-forward `update-ref`, so no working copy is ever touched by it. */
export const RUNNER_BRANCH = "ascent/runner";

// ── the runner (a continuous drive) ──────────────────────────────────────────────────────────────

/** `bounded` is every drive before the runner existed, byte-identical. `continuous` is the runner. */
export type DriveMode = "bounded" | "continuous";
export const DRIVE_MODES: readonly DriveMode[] = ["bounded", "continuous"];

/** A continuous drive's lifecycle. `idle` = every repo is backing off after dry runs and nothing is
 *  due yet; `paused` = a runner-wide breaker fired. Neither is terminal. */
export type RunnerPhase = "running" | "paused" | "idle" | "stopped" | "error";

/** Breakers that pause the WHOLE runner. Each resolves to pause, never to proceed. */
export type RunnerPauseReason = "spend-ceiling" | "session-limit";

/** Breakers (and the dry backoff) that pause ONE repo while the others continue. */
export type RepoPauseReason = "repo-failures" | "branch-conflict" | "dry-backoff" | "dependency-install";

/** Per-repo runner bookkeeping, carried in `LoopDrive.repoStateJson`. */
export interface RepoRunnerState {
  repo: string;
  /** The branch the runner branch merges IN from and is merged back INTO — the paired repo's
   *  `origin/HEAD` branch, else the checkout's branch when the runner started. Null until resolved. */
  baseBranch: string | null;
  paused: RepoPauseReason | null;
  /** When a timed pause lifts (dry backoff). Null for a pause only the operator lifts. */
  pausedUntil: string | null;
  /** Why, in one sentence — the conflicting files, the failing lanes, the install error. */
  note: string | null;
  /** Consecutive guard-rejected or failed lanes. Reset by a lane that lands. */
  failureStreak: number;
  /** Consecutive runs with zero verified closes on this repo. Reset by a verified close. */
  dryStreak: number;
  lastMergeInSha: string | null;
  lastLandedSha: string | null;
  /** Commits on the runner branch not yet on the base branch — what "Merge runner" would bring in. */
  aheadOfBase: number | null;
}

/** The run dials a drive arms EVERY run with (`LoopDrive.dialsJson`). Null = the deployment default. */
export interface DriveDials {
  batchSize?: number | null;
  agentTimeoutMs?: number | null;
  verifyMode?: "on" | "off" | null;
  verifyTimeoutMs?: number | null;
  rescanCadence?: "cycle" | "run" | null;
  modelPolicy?: "single" | "ab" | null;
  models?: string[] | null;
}

// ── plans and directions ─────────────────────────────────────────────────────────────────────────

/** What counts as an ARCHITECTURE MOVE — the only class of change that waits for a human. Measured
 *  against the repo's module partition (`ModulePartition`), never guessed from prose. */
export type ArchitectureMoveKind = "module-created" | "module-removed" | "module-split" | "module-merged" | "cross-module-move";
export const ARCHITECTURE_MOVE_KINDS: readonly ArchitectureMoveKind[] = [
  "module-created",
  "module-removed",
  "module-split",
  "module-merged",
  "cross-module-move",
];

export interface ArchitectureMove {
  kind: ArchitectureMoveKind;
  /** The module (or path) the move starts from; null for `module-created`. */
  from: string | null;
  /** The module (or path) the move lands in; null for `module-removed`. */
  to: string | null;
}

/** One item's slice of a lane plan. `recommendationId` is the id the batch was dispatched with. */
export interface PlanItem {
  recommendationId: string;
  approach: string;
  /** Files the planner expects to touch for this item. A route amendment inside the same modules is
   *  not a violation; an undeclared ARCHITECTURE MOVE is. */
  files: string[];
  moves: ArchitectureMove[];
}

/** The structured plan a planning session returns, as one fenced ```json block. Version 1. */
export interface LanePlan {
  v: 1;
  intent: string;
  items: PlanItem[];
  /** The modules the plan will work in — the proposed fence when the plan is major. */
  modules: string[];
  /** The check that proves the work, in words. */
  check: string;
  risks: string[];
  /** What the plan deliberately does not do. */
  notDoing: string[];
}

export type PlanClass = "minor" | "major" | "minor-under-direction";
export type PlanClassReason = "no-moves" | "declared-moves" | "unreadable" | "undeclared-moves-in-diff" | "inside-direction-fence";

export type PlanStatus =
  | "executing"
  | "landed"
  | "held"
  | "pending"
  | "approved"
  | "revise"
  | "rejected"
  | "superseded"
  | "failed";

/** The statuses that mean "waiting on the operator" — the approval inbox's population. */
export const PLAN_AWAITING: readonly PlanStatus[] = ["pending"];
/** The statuses that keep a plan's items OUT of `openBatch` (their identity is spoken for). */
export const PLAN_HOLDS_ITEMS: readonly PlanStatus[] = ["pending", "revise", "approved"];

export type PlanDecision = "approve" | "revise" | "reject";
export type DirectionStatus = "active" | "done" | "exhausted" | "revoked";

/** How a repo is cut into modules for the architecture-move test, and which source said so. */
export interface ModulePartition {
  source: "context-map" | "workspace" | "directory";
  /** Module roots as repo-relative directory prefixes WITH a trailing slash, longest first. */
  modules: string[];
}

/** A plan row as the API and the ledger see it. */
export interface LoopPlanRecord {
  id: string;
  orgId: string;
  repo: string;
  runId: string | null;
  laneId: string | null;
  directionId: string | null;
  itemKeys: string[];
  recIds: string[];
  plan: LanePlan | null;
  planText: string;
  partition: ModulePartition | null;
  cls: PlanClass;
  clsReason: PlanClassReason | null;
  status: PlanStatus;
  sessionId: string | null;
  heldBranch: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoopDirectionRecord {
  id: string;
  orgId: string;
  repo: string;
  title: string;
  /** Module prefixes the direction may move. */
  fence: string[];
  checkText: string;
  budgetCycles: number;
  budgetMicros: number | null;
  usedCycles: number;
  usedMicros: number;
  status: DirectionStatus;
  originPlanId: string;
  approvedBy: string | null;
  approvedAt: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

/** The body of `POST /api/org/loop/plans/[id]`. `note` is mandatory on reject and revise. */
export interface PlanDecisionBody {
  decision: PlanDecision;
  note: string;
  /** Approve only: an edited fence (module prefixes). Omitted = the plan's own `modules`. */
  fence?: string[];
  budgetCycles?: number;
  budgetUsd?: number;
}

// ── the live signal ──────────────────────────────────────────────────────────────────────────────

/** One thing a running agent did, as the lane's bounded tail records it. */
export type LaneActivityKind = "read" | "search" | "edit" | "write" | "text" | "tool" | "result";

export interface LaneActivity {
  at: string;
  kind: LaneActivityKind;
  /** Repo-relative path, when the event names one. */
  path: string | null;
  /** The tool's own name (Read, Edit, Grep, …) when the event is a tool call. */
  tool: string | null;
  /** A short human line — the first line of assistant text, a search pattern. Bounded. */
  note: string | null;
}

/** A parsed stream event handed from the agent runner to the lane's activity sink. */
export interface AgentStreamEvent {
  kind: LaneActivityKind;
  path: string | null;
  tool: string | null;
  note: string | null;
  /** Running totals when the event carries them (a `result` event does). */
  turns?: number | null;
  costMicros?: number | null;
}

/** THE ONE PHASE VOCABULARY every surface maps from (`streaming-output/phase-derivation`). Derived
 *  from the lane's stage plus its recent activity; `agent-quiet` is the honest decay of a specific
 *  agent phase over a silent stream. Presentation only — program logic branches on typed state. */
export type LanePhase =
  | "queued"
  | "planning"
  | "baseline"
  | "agent-reading"
  | "agent-editing"
  | "agent-thinking"
  | "agent-quiet"
  | "verifying"
  | "installing"
  | "committing"
  | "landing"
  | "rescanning"
  | "held"
  | "done"
  | "error";

export interface LanePulse {
  laneId: string;
  repo: string;
  cycle: number;
  phase: LanePhase;
  /** When the lane entered `phase` (from `LoopRunLane.stageAt`), else null. */
  phaseSince: string | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  deadlineAt: string | null;
  /** The plan's current step, when the lane is planned and the stream says which step. */
  planStep: { index: number; total: number } | null;
  filesRead: string[];
  filesEdited: string[];
  diffStat: { files: number; plus: number; minus: number } | null;
  turns: number | null;
  costMicros: number | null;
  /** The newest few activity events, newest last. */
  tail: LaneActivity[];
}

/** A headline the theater's "latest" rail and the notifier can show. */
export interface PulseEvent {
  at: string;
  repo: string;
  kind: "landed" | "verified-close" | "plan-pending" | "paused" | "direction-done" | "rejected" | "failed";
  headline: string;
}

/** The runner as a pulse reader sees it — a projection of the continuous `LoopDrive`. */
export interface RunnerPulse {
  driveId: string;
  phase: RunnerPhase;
  pausedReason: RunnerPauseReason | null;
  pausedUntil: string | null;
  startedAt: string;
  lastBeatAt: string | null;
  runsDone: number;
  spendTodayMicros: number;
  spendCeilingMicros: number | null;
  repos: RepoRunnerState[];
}

/** `GET /api/org/loop/pulse` — everything a passive screen needs, from ONE lean read. */
export interface LoopPulse {
  org: string;
  /** When this pulse was assembled. A reader compares it to its own clock to say "last heard Nm ago". */
  at: string;
  runner: RunnerPulse | null;
  run: {
    id: string;
    seq: number | null;
    phase: string;
    cycle: number;
    maxCycles: number;
    startedAt: string;
  } | null;
  lanes: LanePulse[];
  /** Repos in the active run that have no lane row yet — waiting for a pool slot. */
  waiting: string[];
  needsYou: { plans: number; pausedRepos: number; runnerPaused: boolean };
  /** Since local midnight, server time. */
  today: { verifiedCloses: number; landed: number; liftPoints: number | null; spendMicros: number };
  /** Newest first, bounded. */
  latest: PulseEvent[];
}

/** `GET /api/org/loop/needs-you` — the notifier's cheap read. */
export interface NeedsYou {
  plans: { id: string; repo: string; title: string; createdAt: string }[];
  pausedRepos: { repo: string; reason: RepoPauseReason; note: string | null }[];
  runnerPaused: { reason: RunnerPauseReason; until: string | null } | null;
}

// ── the constants every package reads from one place ─────────────────────────────────────────────

/** Ceiling on one read-only planning session. */
export const PLAN_TIMEOUT_MS = 480_000;
/** The lane's activity tail keeps at most this many events. */
export const ACTIVITY_TAIL_MAX = 60;
/** A lane writes its activity tail at most this often. */
export const ACTIVITY_WRITE_THROTTLE_MS = 3_000;
/** How often the engine reads a working lane's worktree diff. */
export const WORKTREE_POLL_MS = 15_000;
/** A specific agent phase over a stream silent this long decays to `agent-quiet`. */
export const PHASE_QUIET_MS = 90_000;
/** Consecutive guard-rejected or failed lanes that pause a repo. */
export const REPO_FAILURE_STREAK = 3;
/** The dry backoff ladder: 1 h, 4 h, 12 h (the last repeats). */
export const DRY_BACKOFF_MS: readonly number[] = [3_600_000, 14_400_000, 43_200_000];
/** The default daily spend ceiling, MICRO-CENTS ($100). `0`/null on a drive = no ceiling. */
export const DEFAULT_SPEND_CEILING_MICROS = 100_000_000;
/** The theater's pulse cadence while visible. */
export const THEATER_PULSE_MS = 2_000;
/** The notifier's cadence — deliberately NOT visibility-gated (a hidden tab is when it matters). */
export const NOTIFIER_POLL_MS = 60_000;
/** At most one OS notification per this window. */
export const NOTIFY_BATCH_MS = 900_000;
