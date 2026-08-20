// The DB half of the adoption→outcome loop. Split from skill-outcomes.ts for the same reason as
// skill-usage-load.ts: SkillOutcomes renders inside the "use client" SkillsPanel, and one value import
// of a `@/lib/db` symbol would bundle Prisma (dns/fs/net/tls) for the browser. Pure logic stays in
// skill-outcomes.ts; every read lives here, where only server components reach it.

import { getRepositoryHistory, listOrgSkillAdoptionRows, type HistoryPoint } from "@/lib/db";
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
  return skillOutcomesFor(adoptions, scansByRepo);
}
