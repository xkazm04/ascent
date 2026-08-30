// Shapes, constants and row→record projections for the loop-run tables — the PARSING half of the
// store, split out of loop-runs.ts to keep each module readable. The JSON-in-TEXT decoding lives
// here because it is the one place a malformed column turns into a crash three layers up in a React
// tree, and it is worth being able to test without a database in the room.
//
// Import from the `@/lib/db/loop-runs` barrel; this module is an implementation split.

import type { ScanDiff } from "@/lib/report/compare";
import type { ComparableScan } from "@/lib/db/scans";
import type { DimensionId } from "@/lib/types";

/**
 * What a lane DID, as one headline per deliverable — the outcome cell's unit of display.
 *
 *   • `closed`    — a follow-up the agent claimed RESOLVED (`covers` = its id).
 *   • `installed` — a foundation/practice lane's deterministic install.
 *   • `hardened`  — an attributable upward dimension movement not already covered by a close.
 *   • `regressed` — the same, downward. Reported: a regression the loop caused is a deliverable too.
 *   • `noted`     — something worth a line that is none of the above (reserved; the deriver does
 *                   not emit it today).
 */
export type LaneDeliverableKind = "closed" | "installed" | "hardened" | "regressed" | "noted";

export interface LaneDeliverable {
  /** ≤ 8 words, verb-first past tense: "Hardened GitHub CI/CD". */
  headline: string;
  dimId: DimensionId | null;
  kind: LaneDeliverableKind;
  /** Follow-up ids / signal names this covers. */
  covers: string[];
  /** One line of evidence for the expanded view. */
  evidence: string | null;
}

const DELIVERABLE_KINDS: readonly LaneDeliverableKind[] = ["closed", "installed", "hardened", "regressed", "noted"];

/** `deliverablesJson` → the list; anything malformed is an empty list, never a crash in a React tree. */
export function parseDeliverables(raw: string | null | undefined): LaneDeliverable[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.flatMap((d): LaneDeliverable[] => {
      if (!d || typeof d !== "object") return [];
      const e = d as Partial<LaneDeliverable>;
      if (typeof e.headline !== "string" || !e.headline.trim()) return [];
      const kind = (DELIVERABLE_KINDS as readonly string[]).includes(e.kind as string) ? (e.kind as LaneDeliverableKind) : "noted";
      return [
        {
          headline: e.headline,
          dimId: typeof e.dimId === "string" ? (e.dimId as DimensionId) : null,
          kind,
          covers: Array.isArray(e.covers) ? e.covers.filter((x): x is string => typeof x === "string") : [],
          evidence: typeof e.evidence === "string" ? e.evidence : null,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** Lanes in flight at once. 4 local `claude -p` sessions already saturate a developer box. */
export const LOOP_CONCURRENCY_CAP = 4;
export const LOOP_DEFAULT_CONCURRENCY = 2;
/** Same ceiling the single-repo autopilot always had — a bounded loop, never an open-ended agent. */
export const LOOP_MAX_CYCLES_CAP = 5;
/** Per-lane log ceiling, in lines. Matches the old in-memory autopilot's bound. */
export const LANE_LOG_LINES = 200;

export type LoopRunPhase = "curating" | "running" | "done" | "stopped" | "error";
export type LoopLanePhase = "queued" | "dispatching" | "rescanning" | "done" | "error";

/**
 * What a lane DOES, not just which repo it does it to.
 *
 *   • `backlog`   — the original lane: dispatch the repo's open follow-ups to a local Claude session.
 *   • `foundation`— install the generated `.ai/` standard (no agent call: deterministic file writes).
 *   • `practice`  — install one Practice Library starter (same, one file).
 *
 * The two deterministic kinds exist because UC1's loop is "scan → gaps → apply practice / `.ai/`
 * foundation → rescan", and until now the local loop could only do the middle step through an agent
 * while the other two lived behind a GitHub-App draft-PR door the loop never opened.
 */
export type LoopLaneKind = "backlog" | "foundation" | "practice";

/** One repo in a run, with the kind of lane its FIRST cycle was armed for. */
export interface LoopTarget {
  repo: string;
  kind: LoopLaneKind;
  /** Practice Library id — set only on a `practice` target. */
  practiceId: string | null;
}

export const LANE_KINDS: readonly LoopLaneKind[] = ["backlog", "foundation", "practice"];

const asKind = (v: unknown): LoopLaneKind =>
  typeof v === "string" && (LANE_KINDS as readonly string[]).includes(v) ? (v as LoopLaneKind) : "backlog";

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
  /** The run's repos WITH the lane kind each was armed for — see `parseTargets`. Always the same
   *  length and order as `repos`, which is derived from it. */
  targets: LoopTarget[];
  /** The RESOLVED model this run's agent sessions were armed with; null on a row written before the
   *  column, which is unknown — never "the default". */
  model: string | null;
  /** The reasoning effort passed to the CLI, or null when none was chosen (the flag is then not
   *  passed at all — see src/lib/local/agent.ts). */
  effort: string | null;
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
  /** What the lane delivered, as headlines — written at lane end (src/lib/local/lane-deliverables.ts).
   *  Empty on a row written before the column; the read side then derives them from the diff. */
  deliverables: LaneDeliverable[];
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
  /** The agent configuration this run's lift was produced under — the history strip prints it beside
   *  the number, because comparing two lifts means comparing two setups. Null = unknown. */
  model?: string | null;
  effort?: string | null;
}

/** One lane's before/after, as the detail view needs it. */
export interface LoopLaneOutcome {
  lane: LoopLaneRecord;
  /** What this lane did — resolved from the run's targets, so the ledger never has to guess. */
  kind: LoopLaneKind;
  before: ComparableScan | null;
  after: ComparableScan | null;
  diff: ScanDiff | null;
  closedFollowUpIds: string[];
  commits: number;
  /** The lane's headlines: the persisted list, or — for a row without one — the deterministic
   *  derivation from the persisted claims and diff, so old rows render headlines too. */
  deliverables: LaneDeliverable[];
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

/**
 * `reposJson` → the run's targets, accepting BOTH encodings.
 *
 * The column has always held `["owner/name", …]`. A lane kind is a per-repo fact that has to survive
 * a restart (the outcome ledger renders it long after the run ended), and the loop tables have no
 * spare JSON payload to put it in. Rather than add a column — which on this checkout would mean
 * regenerating the Prisma client into a `node_modules` shared with the operator's own working copy —
 * the existing JSON-in-TEXT column is WIDENED: an entry may now also be `{repo, kind, practiceId}`.
 * Every row written before this parses as `backlog`, which is exactly what those runs were. Same
 * technique the schema already uses for `runsJson` / `measurementJson`, and the reason the schema
 * header calls out "bulky string arrays are stored as serialized JSON in text columns".
 */
export function parseTargets(raw: string | null | undefined): LoopTarget[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: LoopTarget[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string") {
      out.push({ repo: entry, kind: "backlog", practiceId: null });
      continue;
    }
    if (entry && typeof entry === "object" && typeof (entry as { repo?: unknown }).repo === "string") {
      const e = entry as { repo: string; kind?: unknown; practiceId?: unknown };
      out.push({
        repo: e.repo,
        kind: asKind(e.kind),
        practiceId: typeof e.practiceId === "string" ? e.practiceId : null,
      });
    }
  }
  return out;
}

/**
 * The kind a given lane ran as.
 *
 * A foundation/practice lane is a CYCLE-1 lane: once the standard (or the starter) is installed, the
 * repo's next cycle is ordinary backlog work with the new floor in place. That is the same shape the
 * curated batch already has — `loop-engine.ts` applies `input.batches` to cycle 1 only — and it is
 * what makes "install, then rescan, then work the gaps" one run instead of two.
 */
export function laneKindOf(
  targets: readonly LoopTarget[],
  lane: Pick<LoopLaneRecord, "repoFullName" | "cycle">,
): LoopLaneKind {
  if (lane.cycle !== 1) return "backlog";
  return targets.find((t) => t.repo === lane.repoFullName)?.kind ?? "backlog";
}

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
  model?: string | null;
  effort?: string | null;
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
  deliverablesJson?: string | null;
};

export function toRunRecord(row: RunRow): LoopRunRecord {
  const targets = parseTargets(row.reposJson);
  return {
    id: row.id,
    orgId: row.orgId,
    createdBy: row.createdBy,
    phase: row.phase as LoopRunPhase,
    repos: targets.map((t) => t.repo),
    targets,
    concurrency: row.concurrency,
    maxCycles: row.maxCycles,
    cycle: row.cycle,
    curated: row.curated,
    model: row.model ?? null,
    effort: row.effort ?? null,
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
    deliverables: parseDeliverables(row.deliverablesJson),
  };
}

/** Trim a log to the last LANE_LOG_LINES lines. Pure — exported for the engine and its tests. */
export function boundLog(lines: readonly string[]): string[] {
  return lines.length > LANE_LOG_LINES ? lines.slice(lines.length - LANE_LOG_LINES) : [...lines];
}

