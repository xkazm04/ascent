// Shapes, constants and row→record projections for the loop-run tables — the PARSING half of the
// store, split out of loop-runs.ts to keep each module readable. The JSON-in-TEXT decoding lives
// here because it is the one place a malformed column turns into a crash three layers up in a React
// tree, and it is worth being able to test without a database in the room.
//
// Import from the `@/lib/db/loop-runs` barrel; this module is an implementation split.

import type { ScanDiff } from "@/lib/report/compare";
import type { ComparableScan } from "@/lib/db/scans";

/** Lanes in flight at once. 4 local `claude -p` sessions already saturate a developer box. */
export const LOOP_CONCURRENCY_CAP = 4;
export const LOOP_DEFAULT_CONCURRENCY = 2;
/** Same ceiling the single-repo autopilot always had — a bounded loop, never an open-ended agent. */
export const LOOP_MAX_CYCLES_CAP = 5;
/** Per-lane log ceiling, in lines. Matches the old in-memory autopilot's bound. */
export const LANE_LOG_LINES = 200;

export type LoopRunPhase = "curating" | "running" | "done" | "stopped" | "error";
export type LoopLanePhase = "queued" | "dispatching" | "rescanning" | "done" | "error";

export interface LoopRunRecord {
  id: string;
  orgId: string;
  createdBy: string | null;
  phase: LoopRunPhase;
  repos: string[];
  concurrency: number;
  maxCycles: number;
  cycle: number;
  curated: boolean;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface LoopLaneRecord {
  id: string;
  runId: string;
  repoFullName: string;
  cycle: number;
  phase: LoopLanePhase;
  branch: string | null;
  batchIds: string[];
  closedIds: string[];
  commits: number;
  beforeScanId: string | null;
  afterScanId: string | null;
  /** Live rescan sub-stage (fetch | tree | files | analyze | score | compose), or null. */
  stage: string | null;
  /** The lane's log, newest last, already bounded to LANE_LOG_LINES. */
  log: string[];
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface LoopRunSummary {
  id: string;
  phase: LoopRunPhase;
  repos: string[];
  cycle: number;
  maxCycles: number;
  startedAt: string;
  endedAt: string | null;
  /** Summed overall-score movement across the lanes that have BOTH ends. Null when none do —
   *  "not measurable yet", which is not the same number as zero movement. */
  lift?: number | null;
}

/** One lane's before/after, as the detail view needs it. */
export interface LoopLaneOutcome {
  lane: LoopLaneRecord;
  before: ComparableScan | null;
  after: ComparableScan | null;
  diff: ScanDiff | null;
  closedFollowUpIds: string[];
  commits: number;
}

export interface LoopRunDetail {
  run: LoopRunRecord;
  lanes: LoopLaneRecord[];
  outcomes: LoopLaneOutcome[];
}

// ── row → record ─────────────────────────────────────────────────────────────────────────────────

const parseList = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

type RunRow = {
  id: string;
  orgId: string;
  createdBy: string | null;
  phase: string;
  reposJson: string;
  concurrency: number;
  maxCycles: number;
  cycle: number;
  curated: boolean;
  startedAt: Date;
  endedAt: Date | null;
  error: string | null;
  createdAt: Date;
};

type LaneRow = {
  id: string;
  runId: string;
  repoFullName: string;
  cycle: number;
  phase: string;
  branch: string | null;
  batchIdsJson: string;
  closedIdsJson: string;
  commits: number;
  beforeScanId: string | null;
  afterScanId: string | null;
  stage: string | null;
  log: string;
  error: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
};

export function toRunRecord(row: RunRow): LoopRunRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    createdBy: row.createdBy,
    phase: row.phase as LoopRunPhase,
    repos: parseList(row.reposJson),
    concurrency: row.concurrency,
    maxCycles: row.maxCycles,
    cycle: row.cycle,
    curated: row.curated,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toLaneRecord(row: LaneRow): LoopLaneRecord {
  return {
    id: row.id,
    runId: row.runId,
    repoFullName: row.repoFullName,
    cycle: row.cycle,
    phase: row.phase as LoopLanePhase,
    branch: row.branch,
    batchIds: parseList(row.batchIdsJson),
    closedIds: parseList(row.closedIdsJson),
    commits: row.commits,
    beforeScanId: row.beforeScanId,
    afterScanId: row.afterScanId,
    stage: row.stage,
    log: row.log ? row.log.split("\n") : [],
    error: row.error,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

/** Trim a log to the last LANE_LOG_LINES lines. Pure — exported for the engine and its tests. */
export function boundLog(lines: readonly string[]): string[] {
  return lines.length > LANE_LOG_LINES ? lines.slice(lines.length - LANE_LOG_LINES) : [...lines];
}

