// THE STALE-RUN SWEEP, split out of loop-runs-write.ts (spark theater-upgrade, 2026-09-18) so the write
// module stays a screenful: pure relocation, re-exported from `loop-runs-write` so every caller — and the
// `@/lib/db/loop-runs` barrel — imports exactly what it did.

import { parseStringArray } from "./json-columns";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";

/** The lane executors this process does NOT drive, and whose runs the liveness sweep must not judge.
 *  `hosted-worker` (ADR-0001) joins them for exactly the reason the ADR names: a hosted lane's expiry
 *  is decided by `leaseUntil`, never by whether this process happens to hold a registry entry — and
 *  without this row a cockpit READ would stop every healthy hosted run on the deployment. */
const EXTERNAL_EXECUTORS = ["remote-agent", "hosted-worker", "human"];

/**
 * Reconcile `running` rows left behind by a process that died. The engine's live handles only ever
 * exist in the process that started a run, so a `running` row this process does not own cannot be
 * resumed — mark it stopped, with a note, instead of leaving a job that looks alive forever.
 *
 * THE PREDICATE IS ONLY VALID FOR RUNS THIS PROCESS COULD BE DRIVING (UAT `PRIYA-L1-701`). The whole
 * inference is "no live handle ⇒ the process that owned it is gone", and that holds exactly while a
 * live handle is something the run would HAVE. A remote run never gets one: `startRemoteRun` creates
 * no registry entry by design — its work is done by an agent in someone else's harness, reached over
 * MCP — so `isLive` is false for it by construction, not by death. With `GET /api/org/loop` firing
 * this sweep on every read, reading the cockpit would stop a perfectly healthy remote run, and the
 * lanes it stopped would take their claims down with them.
 *
 * A local run was never at risk *because of its registry entry* — a live local run survived six reads
 * from a second client over ~24 s in the L2 capture. That is the isolation, not the excuse: the one
 * class of run that has no entry to be spared by is the one the sweep would always kill.
 *
 * **The remote consequence is a HYPOTHESIS**, recorded as such: the missing predicate is fact (grep
 * `executor` in this file — three lane-creation paths, nothing in the sweep), but the remote path was
 * `not reproducible on this host` and the kill was never observed live. The exclusion below is pinned
 * by unit tests rather than by a reproduction.
 *
 * @param orgSlug scope to one org; omit to sweep every org (the boot sweep).
 * @returns how many runs were reconciled.
 */
export async function markStaleRunsStopped(
  orgSlug?: string,
  /**
   * Which run ids THIS process is still driving. Without it every `running` row is treated as
   * orphaned — correct for the boot sweep (a fresh process drives nothing) and wrong for every
   * later call: the loop route reconciles on each GET, so with no predicate a page load during a
   * run stopped the run it was rendering (found 2026-08-26 when the drive door's first run died
   * 35 seconds into cycle 1 on the very poll that was watching it). Pass the engine's
   * `isLoopRunLive`; it is backed by a process-wide registry, so every route chunk agrees.
   */
  isLive: (id: string) => boolean = () => false,
): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  let orgId: string | undefined;
  if (orgSlug) {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return 0;
    orgId = org.id;
  }
  const where = { phase: "running", ...(orgId ? { orgId } : {}) };
  const running = await prisma.loopRun.findMany({ where, select: { id: true } }).catch(() => []);
  const stale = running.filter((r) => !isLive(r.id));
  if (stale.length === 0) return 0;
  // The executor exclusion. Asked as "does this run have ANY lane this process does not drive" and
  // not "are all of them remote", because the sweep's only verb is stopping the WHOLE run: one
  // externally-driven lane is enough to make the liveness inference wrong for the row it would stop.
  // A read failure excludes nothing, which is the pre-existing behaviour and the recoverable
  // direction — a run wrongly left running is stopped by the next sweep, a run wrongly stopped is
  // work already thrown away.
  const external = await prisma.loopRunLane
    .findMany({
      where: { runId: { in: stale.map((r) => r.id) }, executor: { in: EXTERNAL_EXECUTORS } },
      select: { runId: true },
      distinct: ["runId"],
    })
    .catch(() => [] as { runId: string }[]);
  const externalIds = new Set(external.map((l) => l.runId));
  const ids = stale.map((r) => r.id).filter((id) => !externalIds.has(id));
  if (ids.length === 0) return 0;
  await prisma.loopRun.updateMany({
    where: { id: { in: ids } },
    data: {
      phase: "stopped",
      endedAt: new Date(),
      error: "Interrupted — the server restarted while this run was in flight.",
    },
  });
  // A dead run's CLAIMS die with it too. Its lanes marked backlog rows in_progress before the agent
  // ran; with nobody left to rescan, those rows are zombies — never re-dispatched (openBatch takes
  // `open` only) and kept in_progress by the movement-gated resolve rule. Drive #1 (2026-08-26) left
  // ten of eleven rows claimed this way and the next drive found "no open follow-ups" on a fleet with
  // 350 points of debt. Release them, with a ledger event per row saying why.
  try {
    const lanes = await prisma.loopRunLane.findMany({
      where: { runId: { in: ids }, phase: { in: ["queued", "dispatching", "rescanning"] } },
      select: { batchIdsJson: true },
    });
    const recIds = [
      ...new Set(
        lanes.flatMap((l) => parseStringArray(l.batchIdsJson) ?? []),
      ),
    ];
    if (recIds.length > 0) {
      const claimed = await prisma.recommendation.findMany({
        where: { id: { in: recIds }, status: "in_progress" },
        select: { id: true },
      });
      if (claimed.length > 0) {
        // THE CLAIM FIELDS GO WITH THE STATUS. `status: "open"` alone left `claimActor`,
        // `claimExecutor` and `leaseUntil` standing, so a released row read as open-and-still-held:
        // the worklist rendered a holder nobody could reach, and the claim path's compare-and-set
        // over (status, leaseUntil) had a lease to reason about for a claim that no longer existed.
        // A release that leaves the evidence of the claim behind is half a release.
        await prisma.recommendation.updateMany({
          where: { id: { in: claimed.map((r) => r.id) } },
          data: { status: "open", claimActor: null, claimExecutor: null, leaseUntil: null },
        });
        await prisma.recommendationEvent.createMany({
          data: claimed.map((r) => ({
            recommendationId: r.id,
            actor: "autopilot",
            kind: "status",
            fromValue: "in_progress",
            toValue: "open",
            note: "Released: the loop run that claimed this item was interrupted before its rescan could adjudicate.",
          })),
        });
      }
    }
  } catch {
    // Best-effort: a failed release leaves rows a human can still reopen from the ledger.
  }
  // In-flight lanes die with the process too; leaving them "dispatching" would spin forever.
  await prisma.loopRunLane
    .updateMany({
      where: { runId: { in: ids }, phase: { in: ["queued", "dispatching", "rescanning"] } },
      // Same rule as the rows above: a lane that ended holds no lease. These are local lanes by
      // construction now (an externally-driven run never reaches here), so this clears nothing today
      // — it states the invariant where a future executor would otherwise inherit a dangling claim.
      data: { phase: "error", error: "Interrupted by a server restart.", endedAt: new Date(), stage: null, claimedBy: null, leaseUntil: null },
    })
    .catch(() => null);
  return ids.length;
}
