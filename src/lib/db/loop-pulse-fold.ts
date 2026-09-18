// THE PULSE, ASSEMBLED — pure: the rows `getLoopPulse` read, in; the `LoopPulse` a passive screen
// renders, out (spark theater-upgrade, 2026-09-18; WP4). No database, no clock but the `now` passed in,
// so every rule below is a table test (`loop-pulse.test.ts`).

import { firstLine } from "@/lib/local/agent-stream";
import { deriveLanePhase } from "@/lib/local/lane-phase";
import { driveRunsDone, type DriveRunRecord } from "@/lib/local/drive-types";
import {
  isBaseDisclosure,
  isReviewMarker,
  parseActivityColumn,
  parseDeliverables,
  parseDiffStatColumn,
  parseTargets,
} from "@/lib/db/loop-runs-types";
import { parseStringArray } from "@/lib/db/json-columns";
import type {
  LaneActivity,
  LanePulse,
  LoopPulse,
  PulseEvent,
  RepoRunnerState,
  RunnerPauseReason,
  RunnerPhase,
  RunnerPulse,
} from "@/lib/local/runner-types";

/** The live columns of one lane of the active run — exactly what the pulse selects, nothing more. */
export interface PulseLaneRow {
  id: string;
  repoFullName: string;
  cycle: number;
  phase: string;
  stage: string | null;
  stageAt: Date | null;
  heartbeatAt: Date | null;
  startedAt: Date | null;
  deadlineAt: Date | null;
  activityJson: string | null;
  diffStatJson: string | null;
  turns: number | null;
  costMicros: number | null;
  planId: string | null;
  commits: number;
}

export interface PulseRunRow {
  id: string;
  seq: number | null;
  phase: string;
  cycle: number;
  maxCycles: number;
  startedAt: Date;
  reposJson: string;
  lanes: PulseLaneRow[];
}

export interface PulseDriveRow {
  id: string;
  phase: string;
  pausedReason: string | null;
  pausedUntil: Date | null;
  startedAt: Date;
  lastBeatAt: Date | null;
  runsJson: string;
  runsBefore: number;
  spendCeilingMicros: number | null;
  repoStateJson: string | null;
}

/** A lane of the org that ended or landed inside the `latest` window. */
export interface PulseRecentLaneRow {
  repoFullName: string;
  cycle: number;
  phase: string;
  closedIdsJson: string;
  endedAt: Date | null;
  landedAt: Date | null;
  deliverablesJson: string | null;
  verifyVerdict: string | null;
  error: string | null;
}

export interface PulsePlanRow {
  repo: string;
  planJson: string;
  createdAt: Date;
}

export interface PulseInputs {
  org: string;
  now: Date;
  /** Local midnight, server time — where "today" starts. */
  midnight: Date;
  run: PulseRunRow | null;
  /** Lane ids whose plan is `held` (the post-hoc fence check parked their commits). */
  heldLaneIds: ReadonlySet<string>;
  drive: PulseDriveRow | null;
  pendingPlanCount: number;
  /** The newest pending plans (bounded by the read). */
  pendingPlans: PulsePlanRow[];
  recentLanes: PulseRecentLaneRow[];
  /** Micro-cents the org's lanes that ended since midnight cost (`orgLaneSpendSince`). */
  spendTodayMicros: number;
}

export const PULSE_LATEST_MAX = 12;
export const PULSE_TAIL = 6;
export const PULSE_FILES_MAX = 8;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const RUNNER_PHASES: readonly RunnerPhase[] = ["running", "paused", "idle", "stopped", "error"];

/** Distinct paths of the given kinds, newest first, bounded. */
export function recentPaths(tail: readonly LaneActivity[], kinds: readonly LaneActivity["kind"][], max = PULSE_FILES_MAX): string[] {
  const out: string[] = [];
  for (let i = tail.length - 1; i >= 0 && out.length < max; i -= 1) {
    const e = tail[i]!;
    if (e.path && kinds.includes(e.kind) && !out.includes(e.path)) out.push(e.path);
  }
  return out;
}

export function toLanePulse(row: PulseLaneRow, held: boolean, now: Date): LanePulse {
  const tail = parseActivityColumn(row.activityJson);
  const phase = deriveLanePhase(
    {
      phase: row.phase,
      stage: row.stage,
      tail,
      heartbeatAt: iso(row.heartbeatAt),
      stageAt: iso(row.stageAt),
      planned: row.planId != null,
      held,
    },
    now.getTime(),
  );
  return {
    laneId: row.id,
    repo: row.repoFullName,
    cycle: row.cycle,
    phase,
    phaseSince: iso(row.stageAt),
    heartbeatAt: iso(row.heartbeatAt),
    startedAt: iso(row.startedAt),
    deadlineAt: iso(row.deadlineAt),
    // The stream does not say which step of a plan the agent is on, so this is not guessed.
    planStep: null,
    filesRead: recentPaths(tail, ["read"]),
    filesEdited: recentPaths(tail, ["edit", "write"]),
    diffStat: parseDiffStatColumn(row.diffStatJson),
    turns: row.turns ?? null,
    costMicros: row.costMicros ?? null,
    tail: tail.slice(-PULSE_TAIL),
  };
}

/**
 * Repos of the run with no lane row in the CURRENT cycle — waiting for a pool slot. A repo the engine
 * DROPPED (its previous cycle made no progress) is not waiting for anything; the row does not record
 * "progressed", so it is read as "the previous cycle ended `done` with commits".
 */
export function waitingRepos(run: PulseRunRow): string[] {
  const repos = [...new Set(parseTargets(run.reposJson).map((t) => t.repo))];
  return repos.filter((repo) => {
    const mine = run.lanes.filter((l) => l.repoFullName === repo);
    if (mine.some((l) => l.cycle === run.cycle)) return false;
    if (run.cycle <= 1) return true;
    return mine.some((l) => l.cycle === run.cycle - 1 && l.phase === "done" && l.commits > 0);
  });
}

function asRepoStates(raw: string | null): RepoRunnerState[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((r): r is RepoRunnerState => r != null && typeof r === "object" && typeof (r as RepoRunnerState).repo === "string") : [];
  } catch {
    return [];
  }
}

function asRuns(raw: string): DriveRunRecord[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as DriveRunRecord[]) : [];
  } catch {
    return [];
  }
}

export function toRunnerPulse(drive: PulseDriveRow, spendTodayMicros: number): RunnerPulse {
  const reason = drive.pausedReason === "spend-ceiling" || drive.pausedReason === "session-limit" ? (drive.pausedReason as RunnerPauseReason) : null;
  return {
    driveId: drive.id,
    // A phase the runner vocabulary does not have (a bounded drive's `green`, an `interrupted` row not
    // yet ended) is not running: it reads as stopped rather than as a guess at something live.
    phase: (RUNNER_PHASES as readonly string[]).includes(drive.phase) ? (drive.phase as RunnerPhase) : "stopped",
    pausedReason: reason,
    pausedUntil: iso(drive.pausedUntil),
    startedAt: drive.startedAt.toISOString(),
    lastBeatAt: iso(drive.lastBeatAt),
    runsDone: driveRunsDone({ runs: asRuns(drive.runsJson), runsBefore: drive.runsBefore }),
    spendTodayMicros,
    spendCeilingMicros: drive.spendCeilingMicros ?? null,
    repos: asRepoStates(drive.repoStateJson),
  };
}

/** A pause that needs the operator. `dry-backoff` lifts on its own timer — it is what an idle runner
 *  that has run out of work looks like, and counting it would light the badge on a healthy runner. */
export const needsOperator = (r: RepoRunnerState): boolean => r.paused != null && r.paused !== "dry-backoff";

function planIntent(planJson: string): string | null {
  try {
    const v: unknown = JSON.parse(planJson);
    return v && typeof v === "object" ? firstLine((v as { intent?: unknown }).intent, 140) : null;
  } catch {
    return null;
  }
}

/** The lane's first real headline — never a review marker or a base disclosure. */
function headlineOf(deliverablesJson: string | null): string | null {
  return parseDeliverables(deliverablesJson).find((d) => !isReviewMarker(d) && !isBaseDisclosure(d))?.headline ?? null;
}

const PAUSE_WORDS: Record<RunnerPauseReason, string> = {
  "spend-ceiling": "the day's spend ceiling was reached",
  "session-limit": "the account hit its session limit",
};

export function latestEvents(input: PulseInputs, runner: RunnerPulse | null): PulseEvent[] {
  const since = input.now.getTime() - 24 * 3_600_000;
  const inWindow = (d: Date | null): d is Date => d != null && d.getTime() >= since;
  const out: PulseEvent[] = [];
  for (const l of input.recentLanes) {
    const repo = l.repoFullName;
    if (inWindow(l.landedAt)) {
      out.push({ at: l.landedAt.toISOString(), repo, kind: "landed", headline: headlineOf(l.deliverablesJson) ?? `Landed ${repo} cycle ${l.cycle}` });
    }
    if (!inWindow(l.endedAt)) continue;
    const closed = (parseStringArray(l.closedIdsJson) ?? []).length;
    if (closed > 0) {
      out.push({ at: l.endedAt.toISOString(), repo, kind: "verified-close", headline: `${closed} follow-up${closed === 1 ? "" : "s"} verified closed` });
    }
    if (l.verifyVerdict === "rejected") {
      out.push({ at: l.endedAt.toISOString(), repo, kind: "rejected", headline: headlineOf(l.deliverablesJson) ?? "Discarded — repository checks regressed" });
    } else if (l.phase === "error") {
      out.push({ at: l.endedAt.toISOString(), repo, kind: "failed", headline: firstLine(l.error, 140) ?? `Cycle ${l.cycle} failed` });
    }
  }
  for (const p of input.pendingPlans) {
    out.push({ at: p.createdAt.toISOString(), repo: p.repo, kind: "plan-pending", headline: planIntent(p.planJson) ?? "A plan is waiting for your approval" });
  }
  if (runner?.phase === "paused") {
    // The row keeps no "paused at", so the event is dated by the runner's last beat — the newest moment
    // it is known to have been alive and paused.
    out.push({
      at: runner.lastBeatAt ?? runner.startedAt,
      repo: "",
      kind: "paused",
      headline: `Runner paused — ${runner.pausedReason ? PAUSE_WORDS[runner.pausedReason] : "a breaker fired"}`,
    });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, PULSE_LATEST_MAX);
}

export function foldLoopPulse(input: PulseInputs): LoopPulse {
  const { run, now, midnight } = input;
  const today = midnight.getTime();
  const runner = input.drive ? toRunnerPulse(input.drive, input.spendTodayMicros) : null;
  // The lanes a passive screen shows: the current cycle's, plus any still in flight from an earlier one.
  const live = run ? run.lanes.filter((l) => l.cycle === run.cycle || l.phase === "queued" || l.phase === "dispatching" || l.phase === "rescanning") : [];
  const endedToday = input.recentLanes.filter((l) => l.endedAt != null && l.endedAt.getTime() >= today);
  return {
    org: input.org,
    at: now.toISOString(),
    runner,
    run: run
      ? { id: run.id, seq: run.seq ?? null, phase: run.phase, cycle: run.cycle, maxCycles: run.maxCycles, startedAt: run.startedAt.toISOString() }
      : null,
    lanes: live.map((l) => toLanePulse(l, input.heldLaneIds.has(l.id), now)),
    waiting: run ? waitingRepos(run) : [],
    needsYou: {
      plans: input.pendingPlanCount,
      pausedRepos: runner ? runner.repos.filter(needsOperator).length : 0,
      runnerPaused: runner?.phase === "paused",
    },
    today: {
      verifiedCloses: endedToday.reduce((n, l) => n + (parseStringArray(l.closedIdsJson) ?? []).length, 0),
      landed: input.recentLanes.filter((l) => l.landedAt != null && l.landedAt.getTime() >= today).length,
      // Lift needs two scans per lane and the scorer's comparison — `getLoopRunDetail`'s job, not a
      // 2-second poll's. Null is "not computed here", never zero movement.
      liftPoints: null,
      spendMicros: input.spendTodayMicros,
    },
    latest: latestEvents(input, runner),
  };
}
