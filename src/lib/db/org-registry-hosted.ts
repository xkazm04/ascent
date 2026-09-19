// The rows the migration PR exports: everything still HOSTED in ascent's own tables.
//
// Reads `origin != "registry"` rather than `origin == "hosted"` so pre-migration rows (written before
// the column existed, or by a path that forgot to set it) are included — a row that is not proven to
// live in the registry is by definition still hosted, and leaving it behind would silently lose it.
//
// Shaped for `@/lib/registry/migrate`'s `HostedArtifacts` so the API route stays a thin adapter.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import type { HostedArtifacts } from "@/lib/registry/migrate";

/** Cap per type — a migration PR beyond this is unreviewable, which is the failure we're avoiding. */
export const MAX_MIGRATION_ROWS = 300;

function parseTags(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const EMPTY: HostedArtifacts = { skills: [], practices: [], memory: [] };

/** Every live, hosted artifact of `slug`, in a stable order. Empty when persistence is off. */
export async function listHostedArtifacts(slug: string): Promise<HostedArtifacts> {
  if (!isDbConfigured()) return EMPTY;
  const orgId = await getOrgId(slug);
  if (!orgId) return EMPTY;
  const prisma = getPrisma();
  const where = { orgId, archived: false, origin: { not: "registry" } };

  const [skills, practices, memory] = await Promise.all([
    prisma.orgSkill.findMany({ where, orderBy: { name: "asc" }, take: MAX_MIGRATION_ROWS }),
    prisma.orgPracticeShape.findMany({ where, orderBy: { slug: "asc" }, take: MAX_MIGRATION_ROWS }),
    prisma.orgMemory.findMany({
      where: { ...where, supersededBy: null },
      orderBy: { createdAt: "asc" },
      take: MAX_MIGRATION_ROWS,
    }),
  ]);

  return {
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      category: s.category,
      content: s.content,
      tags: parseTags(s.tags),
    })),
    practices: practices.map((p) => ({
      slug: p.slug,
      practiceId: p.practiceId,
      dimension: p.dimension,
      title: p.title,
      appliesWhen: p.appliesWhen,
      content: p.content,
    })),
    memory: memory.map((m) => ({
      kind: m.kind,
      namespace: m.namespace,
      confidence: m.confidence,
      source: m.source,
      content: m.content,
    })),
  };
}
