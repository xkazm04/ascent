// playbooks-1: the db half of re-rolling an edited playbook to the repos still on an older version.
//
//   · readPlaybookRevision joins the adoption marks (PlaybookApplication.appliedVersion) with the #33
//     ledger rows (`playbook:<id>`) and folds them through the pure playbookRevisionModel. It also hands
//     the route, and ONLY the route, each revisable repo's landed path and landed digest: the digest is
//     the replace guard openDraftPr checks against the base file's real bytes, and the path is the file
//     that landed, so a playbook whose title changed since is updated in place, never seeded a second
//     time beside itself.
//   · stampRevisionLanded moves a repo's appliedVersion when a rescan sees the revision's bytes on the
//     default branch (reconcilePracticeAdoption's rebaseline edge). A draft nobody merges never moves it.
//
// ORG-INTERNAL, like the ledger: nothing here reaches a public surface.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { LANDED_BY_SCAN } from "@/lib/db/playbook-adoption";
import { foldRevisionSets, isRevisable, classify, pickLedgerRow, type RevisionSets } from "@/lib/org/playbookRevisionModel";

/** A repo the revision rollout may write to, with what it needs to write safely. Server-side only. */
export interface RevisionTarget {
  repo: string;
  appliedVersion: number | null;
  artifactPath: string;
  adoptedHash: string;
}

const EMPTY = (version: number): RevisionSets => ({ version, behind: [], diverged: [], unversioned: [], current: [], inFlight: [] });

export async function readPlaybookRevision(
  orgId: string,
  playbookId: string,
  version: number,
): Promise<{ sets: RevisionSets; targets: RevisionTarget[] }> {
  if (!isDbConfigured()) return { sets: EMPTY(version), targets: [] };
  const prisma = getPrisma();
  const [apps, rows] = await Promise.all([
    prisma.playbookApplication.findMany({
      where: { orgId, playbookId },
      select: { repoFullName: true, appliedVersion: true },
    }),
    prisma.practiceAdoption.findMany({
      where: { orgId, practiceId: `playbook:${playbookId}`, state: { not: "superseded" } },
      select: { repoFullName: true, state: true, adoptedHash: true, patternVersion: true, artifactPath: true },
    }),
  ]);
  const versionByRepo = new Map(apps.map((a) => [a.repoFullName, a.appliedVersion]));
  const rowsByRepo = new Map<string, typeof rows>();
  for (const r of rows) rowsByRepo.set(r.repoFullName, [...(rowsByRepo.get(r.repoFullName) ?? []), r]);

  const repos = [...new Set([...versionByRepo.keys(), ...rowsByRepo.keys()])];
  const entries = repos.map((repo) => ({
    repo,
    appliedVersion: versionByRepo.get(repo) ?? null,
    ledger: pickLedgerRow(rowsByRepo.get(repo) ?? []),
  }));
  const targets: RevisionTarget[] = [];
  for (const e of entries) {
    const standing = classify({ playbookVersion: version, appliedVersion: e.appliedVersion, ledger: e.ledger });
    if (e.ledger && isRevisable(standing, e.ledger)) {
      targets.push({ repo: e.repo, appliedVersion: e.appliedVersion, artifactPath: e.ledger.artifactPath, adoptedHash: e.ledger.adoptedHash! });
    }
  }
  return { sets: foldRevisionSets(version, entries), targets };
}

/**
 * A revision landed: move the repo's mark to the version it carried. Scoped to the org that owns the
 * playbook (the reconciler has only the org id). The mark's actor and date stay as they are (history);
 * only the version moves. Never throws: the scan that called it has already landed.
 */
export async function stampRevisionLanded(orgId: string, playbookId: string, repoFullName: string, version: number): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
    const prisma = getPrisma();
    const pb = await prisma.playbook.findFirst({ where: { id: playbookId, orgId }, select: { id: true } });
    if (!pb) return false;
    await prisma.playbookApplication.upsert({
      where: { playbookId_repoFullName: { playbookId, repoFullName } },
      update: { appliedVersion: version },
      create: { playbookId, orgId, repoFullName, appliedBy: LANDED_BY_SCAN, appliedVersion: version },
    });
    return true;
  } catch (err) {
    console.error("[playbooks] failed to stamp a landed revision", { playbookId, repoFullName }, err instanceof Error ? err.message : err);
    return false;
  }
}
