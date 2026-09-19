// `OrgKnowledgeSubject` — the mirror of every subject in the registry's `knowledge/` bundles (#18).
//
// Same shape of contract as the skill/practice/memory mirrors: the registry is the source of truth,
// these rows exist so the org's own surfaces (and the conformance matrix) can name a subject without
// a network round-trip. Upserted on `(registryId, bundle, slug)` so re-indexing the same head is a
// no-op, and SOFT-ARCHIVED when a subject disappears — a conformance row may still cite it, and a
// hard delete would turn a real judgement into a dangling id.
//
// Not barrel-exported, following the standing `org-registry*` convention.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import type { KnowledgeSubject } from "@/lib/registry/subjects";

/** One subject, client-facing. `indexedAt` is an ISO string, per the wire-safe-dates rule. */
export interface KnowledgeSubjectRow {
  bundle: string;
  slug: string;
  category: string | null;
  subcategory: string | null;
  status: string | null;
  file: string;
  techniqueCount: number;
  useWhen: string[];
  laws: string[];
  /** `sha256:…` from the index; null when the index pass predates the digest mirror. */
  digest: string | null;
  /** The subject's derived revision from the index; null when the index predates revisions. */
  revision: number | null;
  /** `YYYY-MM-DD` of the subject's last change; null when the index predates it. */
  changedAt: string | null;
  indexedAt: string;
}

const parseList = (raw: string): string[] => {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** Every live subject for an org, bundle then slug. [] when persistence is off or nothing indexed. */
export async function listOrgKnowledgeSubjects(orgId: string, bundle?: string): Promise<KnowledgeSubjectRow[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().orgKnowledgeSubject.findMany({
    where: { orgId, archived: false, ...(bundle ? { bundle } : {}) },
    orderBy: [{ bundle: "asc" }, { slug: "asc" }],
  });
  return rows.map((r) => ({
    bundle: r.bundle,
    slug: r.slug,
    category: r.category,
    subcategory: r.subcategory,
    status: r.status,
    file: r.file,
    techniqueCount: r.techniqueCount,
    useWhen: parseList(r.useWhenJson),
    laws: parseList(r.lawsJson),
    digest: r.digest ?? null,
    revision: r.revision ?? null,
    changedAt: r.changedAt ?? null,
    indexedAt: r.indexedAt.toISOString(),
  }));
}

/**
 * Mirror one index pass's subjects. Returns `{ written, archived }`.
 *
 * The archive sweep is keyed on the pass's own `(bundle, slug)` set, exactly like
 * `archiveVanishedRegistryRows`. An EMPTY set is deliberately NOT honoured here — see the caller's
 * truncated-tree guard: a pass that read no bundle indexes has not observed that the subjects are
 * gone, and archiving the whole corpus on that basis would empty the conformance matrix.
 */
export async function replaceRegistrySubjects(
  registryId: string,
  orgId: string,
  subjects: KnowledgeSubject[],
): Promise<{ written: number; archived: number }> {
  if (!isDbConfigured() || !subjects.length) return { written: 0, archived: 0 };
  const prisma = getPrisma();
  const indexedAt = new Date();
  let written = 0;
  for (const s of subjects) {
    const bundle = s.bundle.slice(0, 200);
    const slug = s.slug.slice(0, 200);
    if (!bundle || !slug) continue;
    const data = {
      category: s.category,
      subcategory: s.subcategory,
      status: s.status,
      file: s.file.slice(0, 500),
      techniqueCount: s.techniqueCount,
      useWhenJson: JSON.stringify(s.useWhen),
      lawsJson: JSON.stringify(s.laws),
      digest: s.digest ? s.digest.slice(0, 200) : null,
      revision: s.revision,
      changedAt: s.changedAt ? s.changedAt.slice(0, 40) : null,
      archived: false,
      indexedAt,
    };
    try {
      await prisma.orgKnowledgeSubject.upsert({
        where: { registryId_bundle_slug: { registryId, bundle, slug } },
        update: data,
        create: { registryId, orgId, bundle, slug, ...data },
      });
      written += 1;
    } catch {
      /* one malformed subject degrades itself, never the pass */
    }
  }
  // Anything this pass did not touch, in a bundle this pass DID read, has gone from the corpus.
  const bundles = Array.from(new Set(subjects.map((s) => s.bundle.slice(0, 200))));
  const { count } = await prisma.orgKnowledgeSubject.updateMany({
    where: { registryId, bundle: { in: bundles }, archived: false, indexedAt: { lt: indexedAt } },
    data: { archived: true },
  });
  return { written, archived: count };
}
