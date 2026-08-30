// The READ half of the loop-run store, up to the run DETAIL view — every lane resolved to its
// before/after scan pair and the diff between them.
//
// Import from the `@/lib/db/loop-runs` barrel; this module is an implementation split.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { getScanComparison } from "@/lib/db/scans-read";
import { diffScans } from "@/lib/report/compare";
import { attributeDelivered } from "@/lib/maturity/attribution";
import { deriveLaneDeliverables } from "@/lib/local/lane-deliverables";
import type { ComparableScan } from "@/lib/db/scans";
import {
  laneKindOf,
  toLaneRecord,
  toRunRecord,
  type LoopLaneKind,
  type LoopLaneOutcome,
  type LoopLaneRecord,
  type LoopRunDetail,
  type LoopRunRecord,
  type LoopRunSummary,
} from "@/lib/db/loop-runs-types";

// ── reads ────────────────────────────────────────────────────────────────────────────────────────

export async function getLoopRun(id: string): Promise<LoopRunRecord | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe(async () => {
    const row = await getPrisma().loopRun.findUnique({ where: { id } });
    return row ? toRunRecord(row) : null;
  }, null);
}

export async function getLane(id: string): Promise<LoopLaneRecord | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe(async () => {
    const row = await getPrisma().loopRunLane.findUnique({ where: { id } });
    return row ? toLaneRecord(row) : null;
  }, null);
}

export async function listLanes(runId: string): Promise<LoopLaneRecord[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<LoopLaneRecord[]>(async () => {
    const rows = await getPrisma().loopRunLane.findMany({
      where: { runId },
      orderBy: [{ cycle: "asc" }, { repoFullName: "asc" }],
    });
    return rows.map(toLaneRecord);
  }, []);
}

/** A lane of a run that is still marked `running` — enough to find its worktree on disk. */
export interface InFlightLane {
  runId: string;
  orgSlug: string;
  repoFullName: string;
  /** The branch the lane's worktree has checked out. Its identity, on disk and in git. */
  branch: string;
}

/**
 * Every lane of every run still marked `running` — read by the BOOT SWEEP, immediately before it
 * marks those runs stopped, so the temp worktrees they stranded can be removed by name.
 *
 * Read BEFORE the sweep, deliberately: after it, a lane interrupted by a restart is indistinguishable
 * from one that errored a week ago, and the sweep would be removing worktrees it never stopped.
 * Lanes with no branch are dropped — they died before `git worktree add` ran, so there is nothing on
 * disk with their name on it.
 */
export async function listInFlightLanes(): Promise<InFlightLane[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<InFlightLane[]>(async () => {
    const rows = await getPrisma().loopRunLane.findMany({
      where: { branch: { not: null }, run: { is: { phase: "running" } } },
      select: { runId: true, repoFullName: true, branch: true, run: { select: { org: { select: { slug: true } } } } },
    });
    return rows.flatMap((r) =>
      r.branch && r.run.org.slug
        ? [{ runId: r.runId, orgSlug: r.run.org.slug, repoFullName: r.repoFullName, branch: r.branch }]
        : [],
    );
  }, []);
}

/**
 * The id of a repo's latest persisted scan — a lane's `before` end, captured at dispatch time.
 *
 * Ordering mirrors scans-read's SCAN_ORDER exactly (scannedAt, then createdAt, then id): `scannedAt`
 * is not unique, so a bare desc sort resolves ties arbitrarily and this could bracket the lane
 * against a DIFFERENT "latest" scan than the comparison view later reads.
 */
export async function getLatestScanIdForRepo(orgSlug: string, fullName: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return null;
    const prisma = getPrisma();
    const repo = await prisma.repository.findUnique({
      where: { orgId_fullName: { orgId: org.id, fullName: fullName.toLowerCase() } },
      select: { id: true },
    });
    if (!repo) return null;
    const scan = await prisma.scan.findFirst({
      where: { repoId: repo.id },
      orderBy: [{ scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    return scan?.id ?? null;
  }, null);
}

/** The org's newest un-ended run, or null. There is at most one by construction (the engine refuses
 *  a second start), so this reads that invariant rather than picking among many. */
export async function getActiveLoopRun(orgSlug: string): Promise<LoopRunRecord | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return null;
    const row = await getPrisma().loopRun.findFirst({
      where: { orgId: org.id, phase: { in: ["curating", "running"] } },
      orderBy: { createdAt: "desc" },
    });
    return row ? toRunRecord(row) : null;
  }, null);
}

export async function listLoopRuns(orgSlug: string, limit = 20): Promise<LoopRunSummary[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<LoopRunSummary[]>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return [];
    const prisma = getPrisma();
    const rows = await prisma.loopRun.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(100, Math.trunc(limit) || 20)),
    });
    if (rows.length === 0) return [];
    // One extra query for the whole page, not one per run: collect every bracketing scan id the
    // page's lanes name, score them in a single read, then fold each run's lift out of that map.
    const lanes = await prisma.loopRunLane.findMany({
      where: { runId: { in: rows.map((r) => r.id) } },
      // `commits` rides along because the strip's lift answers to the DURABILITY rule too: a lane
      // that committed nothing measured a worktree the run then deleted, and folding that into a
      // green number here would have the history strip claim a lift the ledger refuses (L2-B-01).
      select: { runId: true, beforeScanId: true, afterScanId: true, commits: true },
    });
    const ids = [
      ...new Set(lanes.flatMap((l) => [l.beforeScanId, l.afterScanId]).filter((x): x is string => !!x)),
    ];
    const scans = ids.length
      ? await prisma.scan.findMany({
          where: { id: { in: ids } },
          // The engine columns ride along with the score: the history strip's lift is the same claim
          // the outcome ledger makes, so it answers to the same attribution rule. Without them this
          // read would fold a mock/real pair — or a run of pure model wobble — into a green number
          // the ledger beside it refuses to print.
          select: { id: true, overallScore: true, engineProvider: true, engineDegraded: true },
        })
      : [];
    const score = new Map(scans.map((s) => [s.id, s]));
    const liftByRun = new Map<string, number>();
    for (const l of lanes) {
      const b = l.beforeScanId ? score.get(l.beforeScanId) : undefined;
      const a = l.afterScanId ? score.get(l.afterScanId) : undefined;
      const verdict = attributeDelivered(b, a, l.commits);
      if (verdict.kind !== "attributable") continue;
      liftByRun.set(l.runId, (liftByRun.get(l.runId) ?? 0) + verdict.delta);
    }
    return rows.map((row) => {
      const r = toRunRecord(row);
      return {
        id: r.id,
        phase: r.phase,
        repos: r.repos,
        cycle: r.cycle,
        maxCycles: r.maxCycles,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        lift: liftByRun.has(r.id) ? (liftByRun.get(r.id) as number) : null,
        // The configuration the lift was produced under travels with it: a strip of numbers whose
        // setups differ is a comparison nobody can make.
        model: r.model,
        effort: r.effort,
      };
    });
  }, []);
}

/**
 * A run plus every lane, each resolved to its before/after scan pair and the diff between them.
 *
 * The diff comes from the SAME `diffScans` the report's compare view uses, fed by
 * `getScanComparison` — so a lane's "what moved" and the repo's own comparison page can never tell
 * two different stories about the same pair of scans.
 */
export async function getLoopRunDetail(id: string): Promise<LoopRunDetail | null> {
  if (!isDbConfigured()) return null;
  const run = await getLoopRun(id);
  if (!run) return null;
  const org = await getPrisma()
    .organization.findUnique({ where: { id: run.orgId }, select: { slug: true } })
    .catch(() => null);
  const lanes = await listLanes(id);
  const outcomes: LoopLaneOutcome[] = [];
  for (const lane of lanes) outcomes.push(await laneOutcome(lane, org?.slug, laneKindOf(run.targets, lane)));
  return { run, lanes, outcomes };
}

/**
 * The two ends of a lane's comparison, exactly the pair the lane recorded — or null when either is
 * missing. Shared by the read side (`laneOutcome`) and the lane itself at its end (loop-lane.ts
 * derives the deliverable headlines from the same pair the ledger will later render).
 *
 * getScanComparison picks its own baseline when beforeId is absent; a lane with no recorded `before`
 * legitimately has nothing to diff AGAINST, so only the pair we asked for is trusted.
 */
export async function getLanePair(args: {
  orgSlug: string | null | undefined;
  repoFullName: string;
  beforeScanId: string | null;
  afterScanId: string | null;
}): Promise<{ before: ComparableScan | null; after: ComparableScan | null } | null> {
  if (!isDbConfigured()) return null;
  const [owner, name] = args.repoFullName.split("/");
  if (!owner || !name || !args.orgSlug || !args.afterScanId) return null;
  const cmp = await getScanComparison(owner, name, {
    orgSlug: args.orgSlug,
    beforeId: args.beforeScanId ?? undefined,
    afterId: args.afterScanId,
  });
  if (!cmp) return null;
  return { before: args.beforeScanId ? cmp.before : null, after: cmp.after };
}

async function laneOutcome(
  lane: LoopLaneRecord,
  orgSlug: string | undefined,
  kind: LoopLaneKind,
): Promise<LoopLaneOutcome> {
  const base: LoopLaneOutcome = {
    lane,
    kind,
    before: null,
    after: null,
    diff: null,
    closedFollowUpIds: lane.closedIds,
    commits: lane.commits,
    deliverables: lane.deliverables,
  };
  const pair = await getLanePair({ orgSlug, repoFullName: lane.repoFullName, beforeScanId: lane.beforeScanId, afterScanId: lane.afterScanId });
  if (!pair) return base;
  const { before, after } = pair;
  const verdict = attributeDelivered(before, after, lane.commits);
  let diff = before && after ? diffScans(before, after) : null;
  // THE PROSE ANSWERS TO THE SAME RULE AS THE NUMBER. A lane whose pair is undelivered, mock, within
  // noise or unmeasured has its delta refused by `attributeDelivered`; its movement lines are the same
  // claim in words and are refused with it. The raw evidence (`movementDetail`) stays — it is what
  // was observed, not what is claimed.
  if (diff && verdict.kind !== "attributable") diff = { ...diff, movements: [] };
  // BACKFILL ON READ: a row written before `deliverablesJson` (or a lane that never reached its
  // derivation) still renders headlines — the deterministic derivation from what IS persisted: the
  // closed ids, the recs that moved to done, and the attributable part of the diff.
  const deliverables =
    lane.deliverables.length > 0
      ? lane.deliverables
      : deriveLaneDeliverables({ kind, agentClaims: [], diff, before, after, verdict, closedFollowUpIds: lane.closedIds });
  return { ...base, before, after, diff, deliverables };
}

