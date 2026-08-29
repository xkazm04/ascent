// The DB half of the adoption→outcome loop. Split from skill-outcomes.ts for the same reason as
// skill-usage-load.ts: SkillOutcomes renders inside the "use client" SkillsPanel, and one value import
// of a `@/lib/db` symbol would bundle Prisma (dns/fs/net/tls) for the browser. Pure logic stays in
// skill-outcomes.ts; every read lives here, where only server components reach it.

import { getRepositoryHistory, listOrgSkillAdoptionRows, type HistoryPoint } from "@/lib/db";
import { recordOutcomes, type OutcomeInput } from "@/lib/db/outcomes";
import { resolveOrgId } from "@/lib/db/scans-shared";
import { mapPool } from "@/lib/pool";
import { skillOutcomesFor, type OutcomeScan, type SkillOutcome } from "@/lib/org/skill-outcomes";

const HISTORY_LIMIT = 100;

/**
 * Lanes for the per-repo history fan-out. `HISTORY_LIMIT` bounds each call's ROWS but never bounded the
 * NUMBER of calls: this used to be one uncapped `Promise.all` over every distinct adopted repo, so a
 * widely-adopted skill in a large org fired hundreds of concurrent history queries from a single page
 * render — the Skills page got slower exactly as a skill succeeded and spread, which is backwards.
 *
 * A BOUND, not a cap: every adopted repo is still read, just at most `HISTORY_CONCURRENCY` at a time, so
 * the outcome numbers are bit-identical to the unbounded version and nothing has to be disclosed as
 * truncated in the UI. Batching into one query was the other option, but `getRepositoryHistory` is shared
 * by the report/comparison contexts and takes the newest N scans PER repo — a shape a single flat query
 * can't express without a redesign this direction explicitly excludes.
 *
 * 6 mirrors the reasoning behind SCAN_CONCURRENCY (4): these are cheap indexed DB reads rather than
 * network+LLM work, so a slightly wider pool is safe while still capping connection-pool pressure.
 */
export const HISTORY_CONCURRENCY = 6;

// The instrument fields ride along deliberately: `skillOutcomesFor` refuses to publish a delta
// unless the before and after sides were scored under the same rubric revision AND the same engine
// family. Dropping them here would silence that check by making every production pair read
// "instrument-unknown" — the gate would be present in the code and absent in the product.
const toOutcomeScan = (p: HistoryPoint): OutcomeScan => ({
  id: p.id,
  scannedAt: p.scannedAt,
  overallScore: p.overallScore,
  dimensions: p.dimensions,
  rubricVersion: p.rubricVersion,
  engineProvider: p.engineProvider,
});

/**
 * Server entry point: outcomes per skill id for an org. One history read per DISTINCT adopted repo (a
 * skill adopted by 20 repos, and 20 skills adopted by one repo, both cost one read per repo), run at
 * most `HISTORY_CONCURRENCY` at a time. Every repo is still read — the bound is on how many are in
 * flight, never on how many are visited. {} when persistence is off or nothing has been adopted.
 */
export async function getOrgSkillOutcomes(orgSlug: string): Promise<Record<string, SkillOutcome[]>> {
  const adoptions = await listOrgSkillAdoptionRows(orgSlug);
  if (!adoptions.length) return {};
  const repos = Array.from(new Set(adoptions.map((a) => a.repoFullName)));
  const scansByRepo = new Map<string, OutcomeScan[]>();
  // mapPool's `fn` must never throw or it rejects the whole pool (see src/lib/pool.ts) — the per-repo
  // .catch keeps one unreadable repo from costing the whole page its outcomes, exactly as before.
  await mapPool(repos, HISTORY_CONCURRENCY, async (fullName) => {
    const [owner, name] = fullName.split("/");
    if (!owner || !name) return;
    const history = await getRepositoryHistory(owner, name, { orgSlug, limit: HISTORY_LIMIT }).catch(() => null);
    scansByRepo.set(fullName, (history?.scans ?? []).map(toOutcomeScan));
  });
  const outcomes = skillOutcomesFor(adoptions, scansByRepo);
  // Mirror the MEASURED outcomes into the intervention outcome ledger (moonshot #9). `measured` is the
  // only status that may cross: every other one — no-before-scan, no-after-scan, instrument-mismatch,
  // instrument-unknown — is an honest gap, and a fact table that accepted them would be diluted by
  // rows that measured nothing. Fire-and-forget (`void`): this is a page-render read path, and the
  // write is an upsert on the pair identity, so a re-render adds no rows.
  void mirrorMeasuredOutcomes(orgSlug, outcomes);
  return outcomes;
}

/**
 * The ledger mirror. Server-only, best-effort, and silent on failure — the Skills page's outcomes are
 * computed and rendered whether or not the ledger accepts them.
 */
async function mirrorMeasuredOutcomes(
  orgSlug: string,
  outcomes: Record<string, SkillOutcome[]>,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(orgSlug);
    if (!orgId) return;
    const inputs: OutcomeInput[] = [];
    for (const [skillId, list] of Object.entries(outcomes)) {
      for (const o of list) {
        // Every field below is non-null exactly when the status is `measured` — the pure module
        // guarantees it — so this never has to invent one.
        if (o.status !== "measured" || !o.before || !o.after || o.overallDelta === null || !o.instrument) continue;
        const dim = o.dimensionDeltas[0] ?? null;
        inputs.push({
          orgId,
          repoFullName: o.repoFullName,
          kind: "skill",
          identityKey: skillId,
          // The strongest mover, not a sum: a skill's outcome is attributed to the dimension it moved
          // most. Null when the pair scored no shared dimension — never a fabricated "D1 0".
          dimId: dim?.dimId ?? null,
          dimDelta: dim?.delta ?? null,
          beforeScanId: o.before.id,
          afterScanId: o.after.id,
          interventionAt: new Date(o.adoptedAt),
          overallDelta: o.overallDelta,
          rubricVersion: o.instrument.rubricVersion,
          engineProvider: o.instrument.engineProvider,
          gapDays: (o.beforeGapDays ?? 0) + (o.afterGapDays ?? 0),
          withinBound: o.withinPairingBound === true,
        });
      }
    }
    await recordOutcomes(inputs);
  } catch {
    // A ledger mirror is never a reason for the Skills page to lose its outcomes.
  }
}
