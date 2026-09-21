// THE PULSE — everything a passive screen needs, from ONE lean read
// (spark theater-upgrade, 2026-09-18; WP4).
//
// Deliberately NOT `getLoopRunDetail`: that read runs the stale sweep, lists 20 runs, prices the org and
// compares scans per lane — right for a detail view, wrong for a 2-second poll. This one reads the
// active run and its lanes' LIVE columns (phase, stage, stageAt, heartbeatAt, deadlineAt, activityJson,
// diffStatJson, costMicros, turns, planId), the continuous drive's row, the pending plans' count and
// newest few, the held plans' lane ids, the last 24 hours of ended/landed lanes (for "today" and the
// "latest" rail) and the day's spend — seven small queries in ONE parallel round after the org lookup —
// and hands them to the pure fold (`loop-pulse-fold.ts`), which derives each lane's phase with
// `deriveLanePhase`.
//
// WHAT IT DOES NOT DO: it runs no stale-run sweep (the cockpit's GET and the boot sweep own that), it
// computes no lift (two scans per lane — `today.liftPoints` is null, "not computed here"), and it never
// writes. A read that FAILS throws rather than rendering zeros: "0 landed today" is a claim, and a
// screen told nothing must say "reconnecting", not report an empty day.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { orgLaneSpendSince } from "@/lib/db/runner-spend";
import { foldLoopPulse, PULSE_LATEST_MAX } from "@/lib/db/loop-pulse-fold";
import type { LoopPulse } from "@/lib/local/runner-types";

/** The live columns — and only those. `log`, the scan ids, the brief and the report stay unread. */
const LANE_SELECT = {
  id: true,
  repoFullName: true,
  cycle: true,
  phase: true,
  stage: true,
  stageAt: true,
  heartbeatAt: true,
  startedAt: true,
  deadlineAt: true,
  activityJson: true,
  diffStatJson: true,
  turns: true,
  costMicros: true,
  planId: true,
  commits: true,
  // WHICH ARM RAN THIS LANE. Selected because the fold joins it to the run's `armsJson` below: a
  // field the query does not populate is a field that does not exist, however carefully the type
  // declares it — which is exactly how the theater's arm label rendered nothing for a day.
  armId: true,
} as const;

/** Where "today" starts: local midnight on the server's clock. */
export function startOfLocalDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getLoopPulse(orgSlug: string, now: Date = new Date()): Promise<LoopPulse | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const prisma = getPrisma();
  const midnight = startOfLocalDay(now);
  const windowStart = new Date(now.getTime() - 24 * 3_600_000);

  const [run, drive, pendingPlanCount, pendingPlans, heldPlans, recentLanes, spend] = await Promise.all([
    prisma.loopRun.findFirst({
      where: { orgId: org.id, phase: { in: ["curating", "running"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        seq: true,
        phase: true,
        cycle: true,
        maxCycles: true,
        startedAt: true,
        reposJson: true,
        // The other half of the join: `armId` alone cannot be labelled, and inventing words for an id
        // is the fabrication `armLabel` refuses. One extra TEXT column on ONE row per read.
        armsJson: true,
        lanes: { select: LANE_SELECT, orderBy: [{ cycle: "asc" }, { repoFullName: "asc" }] },
      },
    }),
    prisma.loopDrive.findFirst({
      where: { orgId: org.id, mode: "continuous", endedAt: null },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        phase: true,
        pausedReason: true,
        pausedUntil: true,
        startedAt: true,
        lastBeatAt: true,
        runsJson: true,
        runsBefore: true,
        spendCeilingMicros: true,
        repoStateJson: true,
      },
    }),
    prisma.loopPlan.count({ where: { orgId: org.id, status: "pending" } }),
    prisma.loopPlan.findMany({
      where: { orgId: org.id, status: "pending" },
      orderBy: { createdAt: "desc" },
      take: PULSE_LATEST_MAX,
      select: { repo: true, planJson: true, createdAt: true },
    }),
    prisma.loopPlan.findMany({
      where: { orgId: org.id, status: "held", laneId: { not: null }, updatedAt: { gte: windowStart } },
      select: { laneId: true },
    }),
    prisma.loopRunLane.findMany({
      where: { run: { is: { orgId: org.id } }, OR: [{ endedAt: { gte: windowStart } }, { landedAt: { gte: windowStart } }] },
      orderBy: { endedAt: "desc" },
      take: 1_000,
      select: {
        repoFullName: true,
        cycle: true,
        phase: true,
        closedIdsJson: true,
        endedAt: true,
        landedAt: true,
        deliverablesJson: true,
        verifyVerdict: true,
        error: true,
      },
    }),
    // THE ONE SPEND READ the runner's ceiling breaker also uses — one authority for "what today cost".
    orgLaneSpendSince(orgSlug, midnight),
  ]);

  return foldLoopPulse({
    org: org.slug,
    now,
    midnight,
    run,
    heldLaneIds: new Set(heldPlans.map((p) => p.laneId).filter((id): id is string => id != null)),
    drive,
    pendingPlanCount,
    pendingPlans,
    recentLanes,
    spendTodayMicros: spend ?? 0,
  });
}
