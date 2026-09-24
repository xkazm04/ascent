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

export interface PlaybookAdoption {
  repos: number; // distinct repos that applied this playbook
  appliedRepos: string[];
  /** Avg dimension-score lift (the playbook's dim) in applied repos since they applied it; null when
   *  not measurable (no post-application scan). `measured` is how many applications backed the number. */
  lift: number | null;
  measured: number;
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
 * those repos since they applied it (current score − the score at apply time). Honest — only counts an
 * application toward `lift` when there's a scan after the apply date, and never counts a repo whose
 * playbook PR is still open (see the header). Keyed by playbook id.
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

  // Per applied repo, the timeline of each dimension's score (oldest→newest), to find before/after.
  const scanRows = await prisma.scan.findMany({
    where: { repoId: { in: [...repoIdByName.values()] } },
    select: { repoId: true, scannedAt: true, dimensions: { select: { dimId: true, score: true } } },
    orderBy: { scannedAt: "asc" },
  });
  const timeline = new Map<string, Map<string, { at: Date; score: number }[]>>();
  for (const s of scanRows) {
    const byDim = timeline.get(s.repoId) ?? new Map<string, { at: Date; score: number }[]>();
    timeline.set(s.repoId, byDim);
    for (const d of s.dimensions) {
      const arr = byDim.get(d.dimId) ?? [];
      arr.push({ at: s.scannedAt, score: d.score });
      byDim.set(d.dimId, arr);
    }
  }

  const out: Record<string, PlaybookAdoption> = {};
  const byPlaybook = new Map<string, typeof apps>();
  for (const pid of proposed.keys()) byPlaybook.set(pid, []);
  for (const a of apps) {
    const arr = byPlaybook.get(a.playbookId) ?? [];
    arr.push(a);
    byPlaybook.set(a.playbookId, arr);
  }
  for (const [pid, list] of byPlaybook) {
    const open = [...(proposed.get(pid) ?? [])].sort();
    if (list.length === 0 && open.length === 0) continue;
    const dimId = dimByPlaybook.get(pid);
    let liftSum = 0;
    let measured = 0;
    if (dimId) {
      for (const a of list) {
        const repoId = repoIdByName.get(a.repoFullName);
        const series = repoId ? timeline.get(repoId)?.get(dimId) : undefined;
        if (!series || series.length === 0) continue;
        const baseline = [...series].reverse().find((p) => p.at <= a.appliedAt);
        const current = series[series.length - 1];
        if (baseline && current && current.at > baseline.at) {
          liftSum += current.score - baseline.score;
          measured += 1;
        }
      }
    }
    out[pid] = {
      repos: new Set(list.map((a) => a.repoFullName)).size,
      appliedRepos: [...new Set(list.map((a) => a.repoFullName))],
      lift: measured > 0 ? Math.round(liftSum / measured) : null,
      measured,
      ...(open.length > 0 ? { proposedRepos: open } : {}),
    };
  }
  return out;
}
