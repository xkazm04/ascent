// THE ROUNDS READ — one lean row per lane, for the Live desk's flight log and arm league (contest
// live-fleet-rounds, 2026-09-25).
//
// The chronicle (`listLoopRuns`) folds a run into one row: lanes, closes, cost, lift. The flight log
// draws ONE MARK PER LANE (its verdict) and the arm league groups lanes by what they ran on, so both
// need the lane grain — but none of the lane's heavy columns (log, brief, report, activity). This read
// returns exactly the columns those two surfaces print, for a set of runs the caller already listed,
// constrained to the caller's org so a run id from another org is simply not found.
//
// Timestamps are ISO STRINGS (the wire-safe rule, `src/lib/db/wire-safe.ts`): the desk is a client.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { toLaneRecord, toRunRecord, type LoopLanePhase } from "@/lib/db/loop-runs-types";
import { armLabel } from "@/lib/local/arm";
import type { VerifyVerdict } from "@/lib/local/verify-options";

export interface RoundLane {
  id: string;
  runId: string;
  repo: string;
  cycle: number;
  phase: LoopLanePhase;
  /** The A/B guard's verdict. NULL is a lane written before the guard existed: UNKNOWN, never skipped. */
  verdict: VerifyVerdict | null;
  /** The rescan's adjudicated closes — never the agent's claim. */
  closes: number;
  commits: number;
  /** Null = no cost was recorded, which is not the same fact as $0. */
  costMicros: number | null;
  /** What the lane ran on, as a label: the run's arm when it has one, else the recorded model. Null =
   *  genuinely unknown (a lane from before either was recorded). */
  armLabel: string | null;
  model: string | null;
  errored: boolean;
  landedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

/** Every lane of `runIds` that belongs to `orgSlug`, oldest first within a run. */
export async function listRoundLanes(orgSlug: string, runIds: readonly string[]): Promise<RoundLane[]> {
  if (!isDbConfigured() || runIds.length === 0) return [];
  return dbReadSafe<RoundLane[]>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return [];
    const prisma = getPrisma();
    // gate-then-constrain: only runs of THIS org, so a foreign id contributes nothing.
    const runs = await prisma.loopRun.findMany({ where: { orgId: org.id, id: { in: [...runIds] } } });
    if (runs.length === 0) return [];
    const armsByRun = new Map(runs.map((r) => [r.id, toRunRecord(r).arms]));
    const rows = await prisma.loopRunLane.findMany({
      where: { runId: { in: runs.map((r) => r.id) } },
      orderBy: [{ runId: "asc" }, { cycle: "asc" }, { repoFullName: "asc" }],
    });
    return rows.map((row) => {
      const l = toLaneRecord(row);
      const arm = (armsByRun.get(l.runId) ?? []).find((a) => a.id === l.armId) ?? null;
      return {
        id: l.id,
        runId: l.runId,
        repo: l.repoFullName,
        cycle: l.cycle,
        phase: l.phase,
        verdict: l.verifyVerdict,
        closes: l.closedIds.length,
        commits: l.commits,
        costMicros: l.costMicros,
        armLabel: armLabel(arm) ?? l.model,
        model: l.model,
        errored: l.phase === "error",
        landedAt: l.landedAt,
        startedAt: l.startedAt,
        endedAt: l.endedAt,
      };
    });
  }, []);
}
