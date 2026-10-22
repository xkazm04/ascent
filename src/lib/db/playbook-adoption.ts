// Playbook ADOPTION: the counts every surface reads (the Practices tab card + rollout strip, the library
// summary, the executive briefing's proof line) and the one machine stamp that turns a landed playbook
// PR into an adoption mark. Split out of playbooks.ts (which re-exports it) so the CRUD module stays
// small.
//
// ADOPTED MEANS LANDED (row 40, backlog develop-2026-09-17). Opening a playbook's draft PR used to
// stamp the `PlaybookApplication` mark on the spot, so a draft nobody merged counted toward "Adopted
// by N" and its later scans toward lift. Now:
//   · the PR route records only the #33 ledger row (`PracticeAdoption`, `playbook:<uuid>`, `proposed`);
//   · `stampLandedPlaybook` writes the mark when a rescan finds the playbook file on the default branch
//     (called from reconcilePracticeAdoption, the existing detector, on the proposed → adopted edge);
//   · `getPlaybookAdoption` reads a repo whose playbook PR is still `proposed` as PROPOSED, never
//     adopted. That same read re-derives the marks the PR route stamped at draft-open before row 40:
//     nothing is deleted, they stop counting until the file lands. A `loop` stamp is exempt, because
//     it is already a verified close (stampPlaybookApplications).

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { readPlaybookLiftPairs } from "@/lib/db/playbook-lift";
import { foldLift, type LiftPair, type LiftUnpaired } from "@/lib/org/playbookLiftModel";

export interface PlaybookAdoption {
  repos: number; // distinct repos that applied this playbook
  appliedRepos: string[];
  /** Avg dimension-score lift (the playbook's dim) over the applications with a PAIRED before/after
   *  reading (src/lib/org/playbookLiftModel.ts); null when none pairs. `measured` is how many did. */
  lift: number | null;
  measured: number;
  /** Why every other application has no number: `measured` + the four counts = applications. Present
   *  whenever the playbook has an application; absent on fixtures written before it existed. */
  unpaired?: LiftUnpaired;
  /** Repos with this playbook's draft PR open but not yet seen landed. Not counted in `repos`. Absent
   *  on fixtures written before row 40, which a reader treats as none. */
  proposedRepos?: string[];
}

/** `appliedBy` of a mark stamped because a rescan found the playbook file on the default branch. */
export const LANDED_BY_SCAN = "scan";

/**
 * Stamp the adoption mark for a playbook PR a rescan just found landed. Keyed by org id (the
 * reconciler has no slug). An existing mark (a human's, or a draft-open stamp from before row 40) is
 * CONFIRMED and left as it is: its actor and date are history. Never throws: the scan that called it
 * has already landed.
 */
export async function stampLandedPlaybook(orgId: string, playbookId: string, repoFullName: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
    const prisma = getPrisma();
    const pb = await prisma.playbook.findFirst({ where: { id: playbookId, orgId }, select: { version: true } });
    if (!pb) return false;
    await prisma.playbookApplication.upsert({
      where: { playbookId_repoFullName: { playbookId, repoFullName } },
      update: {},
      create: { playbookId, orgId, repoFullName, appliedBy: LANDED_BY_SCAN, appliedVersion: pb.version },
    });
    return true;
  } catch (err) {
    console.error("[playbooks] failed to stamp a landed playbook", { playbookId, repoFullName }, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Adoption analytics per playbook: how many repos applied it, and the average dimension-score lift in
 * those repos since they applied it (the latest scan minus the latest scan strictly before the
 * adoption boundary; see playbookLiftModel.ts for the boundary and the named statuses). Never counts a
 * repo whose playbook PR is still open (see the header). Keyed by playbook id.
 */
export async function getPlaybookAdoption(orgSlug: string): Promise<Record<string, PlaybookAdoption>> {
  if (!isDbConfigured()) return {};
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return {};

  const [playbooks, allApps, openPrs] = await Promise.all([
    prisma.playbook.findMany({ where: { orgId }, select: { id: true, dimId: true } }),
    prisma.playbookApplication.findMany({
      where: { orgId },
      select: { playbookId: true, repoFullName: true, appliedAt: true, appliedBy: true },
    }),
    prisma.practiceAdoption.findMany({
      where: { orgId, practiceId: { startsWith: "playbook:" }, state: "proposed" },
      select: { practiceId: true, repoFullName: true },
    }),
  ]);
  const key = (pid: string, repo: string) => `${pid}\u0000${repo}`;
  const proposed = new Map<string, Set<string>>();
  const pending = new Set<string>();
  for (const r of openPrs) {
    const pid = r.practiceId.slice("playbook:".length);
    pending.add(key(pid, r.repoFullName));
    const set = proposed.get(pid) ?? new Set<string>();
    set.add(r.repoFullName);
    proposed.set(pid, set);
  }
  const apps = allApps.filter((a) => a.appliedBy === "loop" || !pending.has(key(a.playbookId, a.repoFullName)));
  // A loop-stamped repo is adopted, so it is not also listed as proposed.
  for (const a of apps) proposed.get(a.playbookId)?.delete(a.repoFullName);
  if (apps.length === 0 && [...proposed.values()].every((s) => s.size === 0)) return {};
  const dimByPlaybook = new Map(playbooks.map((p) => [p.id, p.dimId]));

  const fullNames = [...new Set(apps.map((a) => a.repoFullName))];
  const repos = await prisma.repository.findMany({ where: { orgId, fullName: { in: fullNames } }, select: { id: true, fullName: true } });
  const repoIdByName = new Map(repos.map((r) => [r.fullName, r.id]));

  // Lift: one before/after pair per application, read through the latest-scan door (playbook-lift.ts)
  // and classified by the pure model (src/lib/org/playbookLiftModel.ts).
  const liftPairs = await readPlaybookLiftPairs(
    prisma,
    apps.map((a) => ({
      repoId: repoIdByName.get(a.repoFullName),
      dimId: dimByPlaybook.get(a.playbookId),
      appliedAt: a.appliedAt,
      scanStamped: a.appliedBy === LANDED_BY_SCAN,
    })),
  );

  const out: Record<string, PlaybookAdoption> = {};
  const byPlaybook = new Map<string, { repo: string; pair: LiftPair }[]>();
  for (const pid of proposed.keys()) byPlaybook.set(pid, []);
  apps.forEach((a, i) => {
    const arr = byPlaybook.get(a.playbookId) ?? [];
    arr.push({ repo: a.repoFullName, pair: liftPairs[i]! });
    byPlaybook.set(a.playbookId, arr);
  });
  for (const [pid, list] of byPlaybook) {
    const open = [...(proposed.get(pid) ?? [])].sort();
    if (list.length === 0 && open.length === 0) continue;
    const { lift, measured, unpaired } = foldLift(list.map((l) => l.pair));
    const applied = [...new Set(list.map((l) => l.repo))];
    out[pid] = {
      repos: applied.length,
      appliedRepos: applied,
      lift,
      measured,
      ...(list.length > 0 ? { unpaired } : {}),
      ...(open.length > 0 ? { proposedRepos: open } : {}),
    };
  }
  return out;
}
