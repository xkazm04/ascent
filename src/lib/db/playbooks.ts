// Org-authored best-practice playbooks (Direction #3) — the company's own reusable standards per
// maturity dimension, authored in-app by owners/admins. CRUD layer behind /api/org/playbooks. Distinct
// from the DERIVED practice library (getOrgPractices), which is inferred from scans. `steps` is stored
// as a JSON string[]; this module is the single place it's (de)serialized + bounded.

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";

export interface PlaybookRow {
  id: string;
  title: string;
  dimId: string;
  summary: string;
  steps: string[];
  createdBy: string | null;
  createdAt: string;
}

export interface PlaybookInput {
  title: string;
  dimId: string;
  summary?: string;
  steps?: string[];
}

function parseSteps(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Trim/cap the steps and serialize to JSON — bounds free-text storage (≤20 steps, ≤300 chars each). */
function cleanSteps(steps: string[] | undefined): string {
  const out = (steps ?? [])
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => s.trim().slice(0, 300))
    .slice(0, 20);
  return JSON.stringify(out);
}

export async function listPlaybooks(orgSlug: string): Promise<PlaybookRow[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return [];
  const rows = await prisma.playbook.findMany({ where: { orgId: org.id, archived: false }, orderBy: { createdAt: "desc" } });
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    dimId: p.dimId,
    summary: p.summary,
    steps: parseSteps(p.steps),
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function createPlaybook(
  orgSlug: string,
  input: PlaybookInput,
  createdBy?: string | null,
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { slug: orgSlug, name: orgSlug },
    select: { id: true },
  });
  return prisma.playbook.create({
    data: {
      orgId: org.id,
      title: input.title.trim().slice(0, 200),
      dimId: input.dimId,
      summary: (input.summary ?? "").trim().slice(0, 1000),
      steps: cleanSteps(input.steps),
      createdBy: createdBy ?? null,
    },
    select: { id: true },
  });
}

export async function updatePlaybook(
  id: string,
  patch: Partial<PlaybookInput> & { archived?: boolean },
): Promise<void> {
  if (!isDbConfigured()) return;
  const data: Prisma.PlaybookUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title.trim().slice(0, 200);
  if (patch.dimId !== undefined) data.dimId = patch.dimId;
  if (patch.summary !== undefined) data.summary = patch.summary.trim().slice(0, 1000);
  if (patch.steps !== undefined) data.steps = cleanSteps(patch.steps);
  if (patch.archived !== undefined) data.archived = patch.archived;
  await getPrisma().playbook.update({ where: { id }, data });
}

export async function deletePlaybook(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().playbook.delete({ where: { id } });
}

/** Fetch one playbook by id (content + dimension), for the per-row apply route. Null if absent. */
export async function getPlaybook(id: string): Promise<PlaybookRow | null> {
  if (!isDbConfigured()) return null;
  const p = await getPrisma().playbook.findUnique({ where: { id } });
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    dimId: p.dimId,
    summary: p.summary,
    steps: parseSteps(p.steps),
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Resolve the org slug owning a playbook, so a per-row route can authorize the caller. Null if absent. */
export async function getPlaybookOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const p = await getPrisma().playbook.findUnique({ where: { id }, select: { org: { select: { slug: true } } } });
  return p?.org.slug ?? null;
}

/** Record that a playbook was applied to a repo (idempotent per playbook+repo). False if org/playbook
 *  unknown — defense-in-depth alongside the route's authz. */
export async function applyPlaybook(
  orgSlug: string,
  playbookId: string,
  repoFullName: string,
  appliedBy?: string | null,
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return false;
  const pb = await prisma.playbook.findFirst({ where: { id: playbookId, orgId: org.id }, select: { id: true } });
  if (!pb) return false;
  await prisma.playbookApplication.upsert({
    where: { playbookId_repoFullName: { playbookId, repoFullName } },
    update: { appliedBy: appliedBy ?? null, appliedAt: new Date() },
    create: { playbookId, orgId: org.id, repoFullName, appliedBy: appliedBy ?? null },
  });
  return true;
}

/** Remove a playbook→repo application. */
export async function unapplyPlaybook(playbookId: string, repoFullName: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().playbookApplication.deleteMany({ where: { playbookId, repoFullName } });
}

export interface PlaybookAdoption {
  repos: number; // distinct repos that applied this playbook
  appliedRepos: string[];
  /** Avg dimension-score lift (the playbook's dim) in applied repos since they applied it; null when
   *  not measurable (no post-application scan). `measured` is how many applications backed the number. */
  lift: number | null;
  measured: number;
}

/**
 * Adoption analytics per playbook: how many repos applied it, and the average dimension-score lift in
 * those repos since they applied it (current score − the score at apply time). Honest — only counts an
 * application toward `lift` when there's a scan after the apply date. Keyed by playbook id.
 */
export async function getPlaybookAdoption(orgSlug: string): Promise<Record<string, PlaybookAdoption>> {
  if (!isDbConfigured()) return {};
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return {};

  const [playbooks, apps] = await Promise.all([
    prisma.playbook.findMany({ where: { orgId: org.id }, select: { id: true, dimId: true } }),
    prisma.playbookApplication.findMany({ where: { orgId: org.id }, select: { playbookId: true, repoFullName: true, appliedAt: true } }),
  ]);
  if (apps.length === 0) return {};
  const dimByPlaybook = new Map(playbooks.map((p) => [p.id, p.dimId]));

  const fullNames = [...new Set(apps.map((a) => a.repoFullName))];
  const repos = await prisma.repository.findMany({ where: { orgId: org.id, fullName: { in: fullNames } }, select: { id: true, fullName: true } });
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
  for (const a of apps) {
    const arr = byPlaybook.get(a.playbookId) ?? [];
    arr.push(a);
    byPlaybook.set(a.playbookId, arr);
  }
  for (const [pid, list] of byPlaybook) {
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
    };
  }
  return out;
}
