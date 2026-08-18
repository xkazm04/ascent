// The org-scoped read behind practice mining (W6).
//
// Reads each repo's LATEST scan's `practiceShape` blob plus its per-dimension scores, and hands the
// pair to the pure miner (src/lib/org/practice-mining.ts). Same latest-scan-blobs pattern as
// org-rework.ts and the W4 merge-sha index.
//
// ORG-SCOPED BY CONSTRUCTION. A mined pattern is one organization's private structure — its own
// headings, its own layout. This function takes a slug and filters on that org's id; there is no
// cross-org variant and there must not be one. Nothing derived from it may reach a public report or
// the shared public corpus.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { parsePracticeShape } from "@/lib/analyze/practice-shape";
import type { ShapeSource } from "@/lib/org/practice-mining";

/**
 * One row of the `OrgPracticeShape` TABLE — the org's CHOSEN, published practice shapes.
 *
 * NOT the same thing as `getOrgPracticeShapes` below, despite the shared noun: that function MINES
 * structure out of each repo's latest scan blob and never touches this table. This is the registry
 * mirror surface — `practices/<slug>/PRACTICE.md` indexed out of the customer's registry repo
 * (`origin === "registry"`), beside anything ascent authored itself (`origin === "hosted"`).
 */
export interface PracticeShapeRow {
  id: string;
  slug: string;
  practiceId: string;
  dimension: string;
  title: string;
  appliesWhen: string;
  origin: "hosted" | "registry";
  registryPath: string | null;
  updatedAt: string;
}

/**
 * Every live shape row of `orgSlug`, registry-mirrored ones first. Empty when persistence is off or
 * the org is unknown — a tab that renders nothing is honest; a throw would take the tab down.
 */
export async function listOrgPracticeShapeRows(orgSlug: string): Promise<PracticeShapeRow[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  const rows = await getPrisma().orgPracticeShape.findMany({
    where: { orgId: org.id, archived: false },
    orderBy: [{ origin: "desc" }, { slug: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    practiceId: r.practiceId,
    dimension: r.dimension,
    title: r.title,
    appliesWhen: r.appliesWhen,
    origin: r.origin === "registry" ? "registry" : "hosted",
    registryPath: r.registryPath ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Every repo in `orgSlug` whose latest scan carried a practice shape, with that scan's per-dimension
 * scores. Repos without a shape are omitted rather than included empty — the miner counts exemplars,
 * and a repo that contributed no structure is not an exemplar of anything.
 */
export async function getOrgPracticeShapes(orgSlug: string): Promise<ShapeSource[] | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const repos = await getPrisma().repository.findMany({
    where: { orgId: org.id },
    select: {
      fullName: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { practiceShape: true, dimensions: { select: { dimId: true, score: true } } },
      },
    },
  });

  const out: ShapeSource[] = [];
  for (const r of repos) {
    const scan = r.scans[0];
    const shape = parsePracticeShape(scan?.practiceShape);
    if (!shape || shape.entries.length === 0) continue;
    const dims: Record<string, number> = {};
    for (const d of scan?.dimensions ?? []) dims[d.dimId] = d.score;
    out.push({ repoFullName: r.fullName, shape, dims });
  }
  // Stable order so the miner's tie-breaks and the rendered output are deterministic across runs.
  return out.sort((a, b) => a.repoFullName.localeCompare(b.repoFullName));
}
