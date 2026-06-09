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

/** Resolve the org slug owning a playbook, so a per-row route can authorize the caller. Null if absent. */
export async function getPlaybookOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const p = await getPrisma().playbook.findUnique({ where: { id }, select: { org: { select: { slug: true } } } });
  return p?.org.slug ?? null;
}
