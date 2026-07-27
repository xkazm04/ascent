// The DB half of the adoption→outcome loop. Split from skill-outcomes.ts for the same reason as
// skill-usage-load.ts: SkillOutcomes renders inside the "use client" SkillsPanel, and one value import
// of a `@/lib/db` symbol would bundle Prisma (dns/fs/net/tls) for the browser. Pure logic stays in
// skill-outcomes.ts; every read lives here, where only server components reach it.

import { getRepositoryHistory, listOrgSkillAdoptionRows, type HistoryPoint } from "@/lib/db";
import { skillOutcomesFor, type OutcomeScan, type SkillOutcome } from "@/lib/org/skill-outcomes";

const HISTORY_LIMIT = 100;

const toOutcomeScan = (p: HistoryPoint): OutcomeScan => ({
  id: p.id,
  scannedAt: p.scannedAt,
  overallScore: p.overallScore,
  dimensions: p.dimensions,
});

/**
 * Server entry point: outcomes per skill id for an org. One history read per DISTINCT adopted repo (a
 * skill adopted by 20 repos, and 20 skills adopted by one repo, both cost one read per repo). {} when
 * persistence is off or nothing has been adopted.
 */
export async function getOrgSkillOutcomes(orgSlug: string): Promise<Record<string, SkillOutcome[]>> {
  const adoptions = await listOrgSkillAdoptionRows(orgSlug);
  if (!adoptions.length) return {};
  const repos = Array.from(new Set(adoptions.map((a) => a.repoFullName)));
  const scansByRepo = new Map<string, OutcomeScan[]>();
  await Promise.all(
    repos.map(async (fullName) => {
      const [owner, name] = fullName.split("/");
      if (!owner || !name) return;
      const history = await getRepositoryHistory(owner, name, { orgSlug, limit: HISTORY_LIMIT }).catch(() => null);
      scansByRepo.set(fullName, (history?.scans ?? []).map(toOutcomeScan));
    }),
  );
  return skillOutcomesFor(adoptions, scansByRepo);
}
