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
import { listRunOutcomes } from "@/lib/db/lane-outcomes";
import type { LaneImpactInput } from "@/lib/db/improvement-events";
import { laneEconomics, priceList, type LaneEconomics, type RemediationPriceList } from "@/lib/local/lane-economics";
import {
  isReviewMarker,
  laneKindOf,
  parseTargets,
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
      // `costMicros` rides along in the SAME batched read that folds the lift — the strip prints
      // both, and two queries for one row would be two chances for them to disagree.
      select: { runId: true, beforeScanId: true, afterScanId: true, commits: true, costMicros: true },
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
    // Cost is summed over the lanes that RECORDED one. A run where no lane did stays absent from the
    // map and reads `null` — "not measured", which is a different fact from a run that cost nothing.
    // Note this fold does NOT answer to the attribution rule the lift does: money was spent whether
    // or not the movement it bought can be claimed, and hiding unattributable spend would flatter it.
    const costByRun = new Map<string, number>();
    for (const l of lanes) {
      if (l.costMicros != null) costByRun.set(l.runId, (costByRun.get(l.runId) ?? 0) + l.costMicros);
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
        costMicros: costByRun.has(r.id) ? (costByRun.get(r.id) as number) : null,
      };
    });
  }, []);
}

/**
 * The Practice Library ids this loop has ALREADY DISPATCHED into one repo — the once-per-repo memory
 * behind `proposeLaneKind`'s practice rule.
 *
 * WHY THE LOOP'S OWN HISTORY IS THE SOURCE OF TRUTH, and not the file on disk: the presence test
 * `proposeLaneKind` used to make ("is the starter's literal path in the tree?") reads a REMOVAL as an
 * omission. On `systedo-case` the loop installed the 18-line `ai-review.yml` starter, a later agent
 * consolidated it into a 122-line `agent-review.yml` and deleted the thin one, and the next run
 * reinstalled the starter — forever, never reaching a backlog or craft lane. A practice a human or an
 * agent removed is a STANDING DECISION, which the scoring prompt already describes as "context you
 * were missing, not a reason to re-raise".
 *
 * "ALREADY DISPATCHED" is: the repo has a CYCLE-1 lane with a non-null `startedAt`, in a run whose
 * targets name that practice for that repo. Both halves are deliberate:
 *
 *   • cycle 1, because a lane kind is a cycle-1 fact (`laneKindOf`) — cycles 2+ are always backlog;
 *   • `startedAt`, because `runLane` stamps it in the SAME write that leaves `queued` for
 *     `dispatching`, immediately before the install runs. A lane that never got a worktree is written
 *     by `recordLaneSetupFailure` with `phase: "error"` and NO `startedAt`, so a broken pairing does
 *     not burn the practice's one shot — while a lane that ran and then errored DOES, because by then
 *     the starter has either landed or failed for a reason a retry would hit again.
 *
 * Reading `phase: "done"` instead would be strictly worse: a lane that installed the starter and then
 * failed its rescan would re-propose the same install on every subsequent run, which is the very
 * pathology this read exists to end.
 */
export async function listDispatchedPractices(orgSlug: string, repoFullName: string): Promise<Set<string>> {
  if (!isDbConfigured()) return new Set<string>();
  return dbReadSafe<Set<string>>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return new Set<string>();
    const runs = await getPrisma().loopRun.findMany({
      where: {
        orgId: org.id,
        lanes: { some: { repoFullName: { equals: repoFullName, mode: "insensitive" }, cycle: 1, startedAt: { not: null } } },
      },
      select: { reposJson: true },
    });
    const key = repoFullName.toLowerCase();
    const out = new Set<string>();
    for (const run of runs) {
      for (const t of parseTargets(run.reposJson)) {
        if (t.kind === "practice" && t.practiceId && t.repo.toLowerCase() === key) out.add(t.practiceId);
      }
    }
    return out;
  }, new Set<string>());
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
  // The economics ride ALONGSIDE the outcomes, folded from the very same pair — so the ledger's
  // ¢/point and its before → after can never come from two different readings of one lane.
  return { run, lanes, outcomes, economics: outcomes.map(laneEconomics), itemOutcomes: await listRunOutcomes(id) };
}

/**
 * The lane-side rows the improvement union folds (moonshot #26).
 *
 * ONE query for the org, not one per run, and one batched scan read for the whole set — the same
 * shape `listLoopRuns` already uses, and for the same reason: the ledger renders a window of work,
 * and a per-lane comparison read would make an executive page N round trips deep.
 *
 * Only lanes with a `dimId` produce a dimension delta; a lane without one still appears (so it can be
 * counted as work) but joins no `byDim` bucket. `dimPoints` is `null` unless BOTH scan ends carry the
 * dimension — never 0, which the ledger would sum as "measured, moved nothing".
 */
export async function listLaneImpactInputs(
  orgSlug: string,
  window: { start: Date | null; end: Date | null } = { start: null, end: null },
): Promise<LaneImpactInput[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<LaneImpactInput[]>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return [];
    const prisma = getPrisma();
    const lanes = await prisma.loopRunLane.findMany({
      where: {
        run: { is: { orgId: org.id } },
        phase: "done",
        ...(window.start || window.end
          ? { endedAt: { ...(window.start ? { gte: window.start } : {}), ...(window.end ? { lte: window.end } : {}) } }
          : {}),
      },
      orderBy: [{ endedAt: "desc" }, { id: "desc" }],
      take: 500,
    });
    if (lanes.length === 0) return [];
    const scanIds = [
      ...new Set(lanes.flatMap((l) => [l.beforeScanId, l.afterScanId]).filter((x): x is string => !!x)),
    ];
    const scans = scanIds.length
      ? await prisma.scan.findMany({
          where: { id: { in: scanIds } },
          select: { id: true, overallScore: true, dimensions: { select: { dimId: true, score: true } } },
        })
      : [];
    const byScan = new Map(scans.map((s) => [s.id, s]));
    return lanes.map((l) => {
      const before = l.beforeScanId ? byScan.get(l.beforeScanId) : undefined;
      const after = l.afterScanId ? byScan.get(l.afterScanId) : undefined;
      const dimOf = (s: typeof before, dimId: string) => s?.dimensions.find((d) => d.dimId === dimId)?.score ?? null;
      const b = l.dimId ? dimOf(before, l.dimId) : null;
      const a = l.dimId ? dimOf(after, l.dimId) : null;
      return {
        laneId: l.id,
        runId: l.runId,
        repoFullName: l.repoFullName,
        cycle: l.cycle,
        dimId: l.dimId ?? null,
        // Both ends or nothing — the same refusal `diffScans` makes, never widened here.
        dimPoints: b != null && a != null ? a - b : null,
        overall: before && after ? after.overallScore - before.overallScore : null,
        endedAt: l.endedAt ? l.endedAt.toISOString() : null,
        beforeScanId: l.beforeScanId,
        afterScanId: l.afterScanId,
        prNumber: l.prNumber ?? null,
        prUrl: l.prUrl ?? null,
        commits: l.commits,
      };
    });
  }, []);
}

/**
 * The org's remediation price list: what a verified maturity point has cost, per model, per dimension.
 *
 * Reads the org's most recent lanes that carry BOTH a model and an after-scan, resolves each pair
 * through the SAME `getScanComparison` → `diffScans` path the ledger uses (never a second diff
 * implementation), and folds them with the pure `priceList`. Returns `null` when there is no database
 * or no org — an empty list is a real answer ("nothing priced yet") and a missing one is not.
 *
 * BOUNDED to the most recent `limit` lanes (200 by default) because each priced lane costs one
 * comparison read; a price list is a standing summary, not an archive scan.
 */
export async function getOrgPriceList(
  orgSlug: string,
  opts: { since?: Date; limit?: number } = {},
): Promise<RemediationPriceList | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe<RemediationPriceList | null>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return null;
    const take = Math.max(1, Math.min(200, Math.trunc(opts.limit ?? 200) || 200));
    const rows = await getPrisma().loopRunLane.findMany({
      where: {
        run: { is: { orgId: org.id } },
        model: { not: null },
        afterScanId: { not: null },
        ...(opts.since ? { startedAt: { gte: opts.since } } : {}),
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take,
    });
    const lanes: LaneEconomics[] = [];
    for (const row of rows) {
      const lane = toLaneRecord(row);
      // `kind` is irrelevant to economics (a deterministic install lane costs nothing and moves what
      // it moves), so it is not resolved here — `backlog` is the shape the fold reads.
      lanes.push(laneEconomics(await laneOutcome(lane, orgSlug, "backlog")));
    }
    return priceList(lanes);
  }, null);
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
  // closed ids, the recs that moved to done, and the attributable part of the diff. REVIEW MARKERS
  // (a ruling recorded against a row that was never persisted — see `reviewDeliverable`) do not
  // count as content: a marker-only column still backfills, and the markers ride along so the
  // client can attach each ruling to the row it re-derives.
  const markers = lane.deliverables.filter(isReviewMarker);
  const deliverables =
    lane.deliverables.length > markers.length
      ? lane.deliverables
      : [...deriveLaneDeliverables({ kind, agentClaims: [], diff, before, after, verdict, closedFollowUpIds: lane.closedIds }), ...markers];
  return { ...base, before, after, diff, deliverables };
}

