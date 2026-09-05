// Knowledge base view — the org's Reference Knowledge Bundles as published in the mapped registry
// repo (`knowledge/<domain>/`), and how the FLEET stands against them.
//
// This is the FOURTH thing the registry distributes, alongside skills / practices / memory, and it
// reads the same way: the repo is the source of truth, ascent indexes and never writes. What makes
// it different from the other three is granularity — a bundle is not a flat list of files but a
// four-layer hierarchy (Golden Path → Technique → Application → Evidence), and only the top three
// layers publish. Evidence is consumer-side by construction, so a count of it here would always be
// zero and would read as "nobody wrote any" rather than "it isn't ours to hold".
//
// ## Where the numbers come from
//
// The indexer reads each bundle's generated `index.json` (+ `taxonomy.json`) on every pass and
// stores the summary on the registry row and one `OrgKnowledgeSubject` per subject, so the corpus
// half of this view is a plain read of indexed truth. The fleet half is the last conformance sweep:
// one `RepoConformanceMap` row per swept repo (mapped or not) and the judged pairs, folded into one
// cell per (subject × repo) by `knowledge-fleet.ts`. Dispatches are ascent's own ledger.
//
// SERVER-ONLY: this module reaches the database. The view SHAPE lives in the client-safe
// `knowledge-shape.ts` (see its header for why) and is re-exported below.

import { getRegistryView, CONFORMANCE_PAIR_CAP } from "./registry-view";
import { sortDomains, titleOfSlug } from "./knowledge-shape";
import type { KnowledgeView } from "./knowledge-shape";
import { buildKnowledgeFleet, lastSweepAt, sweepWarnings, toKnowledgeSubject } from "./knowledge-fleet";
import { getOrgId } from "@/lib/db/org-rollup";
import { listOrgKnowledgeSubjects } from "@/lib/db/org-registry-subjects";
import { listConformance, listConformanceMaps } from "@/lib/db/org-registry-conformance";
import { listDispatches } from "@/lib/db/org-registry-dispatch";
import { hasOrgRole } from "@/lib/authz";
import { selfHosted } from "@/lib/env";

// The view SHAPE lives in a client-safe sibling (see its header); re-exported so every existing
// `@/lib/org/knowledge-view` import keeps working. SERVER callers may use this barrel; a client
// component must import from "./knowledge-shape" directly or it drags Prisma into the browser.
export type { KnowledgeStatus, KnowledgeDomain, KnowledgeView } from "./knowledge-shape";
export { artifactTotal, sortDomains } from "./knowledge-shape";

/** `"0/624"` → `{ written: 0, total: 624 }`. Falls back to the bundle's technique count so a
 *  missing or malformed field reads as "none of them", never as a coverage of zero out of zero —
 *  which would render as 0% and 100% depending on which way the UI divides. */
function parseCoverage(raw: string | null, techniques: number): { written: number; total: number } {
  const m = raw?.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return { written: 0, total: techniques };
  return { written: Number(m[1]), total: Number(m[2]) };
}

/**
 * What THIS viewer may do. `canSweep` is the Registry tab's write gate (admin floor + an
 * installation ascent can mint a token for — a sweep spends GitHub requests). `canBrief` is the
 * admin floor alone: composing a brief writes nothing to GitHub. `canRunLocal` additionally needs
 * an OWNER on a self-hosted deployment whose operator consented to the autopilot
 * (`ASCENT_AUTOPILOT=1`) — the agent module is imported lazily so the tab's render never loads the
 * spawn machinery on a deployment that will never use it.
 */
async function capabilitiesOf(slug: string, canWrite: boolean): Promise<KnowledgeView["capabilities"]> {
  const [admin, owner] = await Promise.all([hasOrgRole(slug, "admin").catch(() => false), hasOrgRole(slug, "owner").catch(() => false)]);
  let canRunLocal = false;
  if (owner && selfHosted()) {
    const { autopilotEnabled } = await import("@/lib/local/agent");
    canRunLocal = autopilotEnabled();
  }
  return { canSweep: canWrite, canBrief: admin, canRunLocal };
}

export async function getKnowledgeView(slug: string): Promise<KnowledgeView> {
  const registry = await getRegistryView(slug);

  const noFleet: Pick<KnowledgeView, "subjects" | "repos" | "cells" | "signals" | "dispatches" | "sweep" | "capabilities"> = {
    subjects: [],
    repos: [],
    cells: [],
    signals: [],
    dispatches: [],
    sweep: { lastAt: null, warnings: [], truncated: false },
    capabilities: { canSweep: false, canBrief: false, canRunLocal: false },
  };

  const empty: KnowledgeView = {
    status: "unmapped",
    domains: [],
    totals: { domains: 0, subjects: 0, techniques: 0, applications: 0 },
    ...noFleet,
  };

  if (registry.status === "unmapped" || !registry.registry) return empty;

  const header = {
    fullName: registry.registry.fullName,
    url: registry.registry.url,
    lastIndexedAt: registry.registry.lastIndexedAt,
  };

  if (registry.status === "error") {
    return { ...empty, status: "error", registry: header, ...(registry.error ? { error: registry.error } : {}) };
  }

  // One row per bundle, exactly as that bundle's own generated index states it.
  const domains = sortDomains(
    registry.bundles.map((b) => ({
      name: b.name,
      title: titleOfSlug(b.name),
      subjects: b.subjects,
      techniques: b.techniques,
      applications: b.applications,
      laws: b.laws,
      categories: b.categories,
      useWhenCoverage: parseCoverage(b.useWhenCoverage, b.techniques),
      taxonomy: b.taxonomy ?? [],
    })),
  );

  // The fleet half. Every read degrades on its own — a failed dispatch read must not cost the tab
  // its matrix — and the pairs are the registry view's already-capped list, so the two tabs never
  // disagree about what was truncated.
  const orgId = await getOrgId(slug).catch(() => null);
  const [subjectRows, maps, dispatches, pairs] = orgId
    ? await Promise.all([
        listOrgKnowledgeSubjects(orgId).catch(() => []),
        listConformanceMaps(orgId).catch(() => []),
        listDispatches(orgId, { limit: 50 }).catch(() => []),
        registry.conformance
          ? Promise.resolve(registry.conformance.pairs)
          : listConformance(orgId, { limit: CONFORMANCE_PAIR_CAP + 1 }).catch(() => []),
      ])
    : [[], [], [], []];
  const subjects = subjectRows.map(toKnowledgeSubject);
  const truncated = registry.conformance?.truncated ?? pairs.length > CONFORMANCE_PAIR_CAP;
  const { repos, cells } = buildKnowledgeFleet(subjects, maps, pairs.slice(0, CONFORMANCE_PAIR_CAP));

  return {
    status: domains.length === 0 ? "empty" : "indexed",
    registry: header,
    domains,
    totals: {
      domains: domains.length,
      subjects: domains.reduce((n, d) => n + d.subjects, 0),
      techniques: domains.reduce((n, d) => n + d.techniques, 0),
      applications: domains.reduce((n, d) => n + d.applications, 0),
    },
    subjects,
    repos,
    cells,
    signals: registry.signals?.subjects ?? [],
    dispatches,
    sweep: { lastAt: lastSweepAt(maps), warnings: sweepWarnings(maps), truncated },
    capabilities: await capabilitiesOf(slug, registry.capabilities.canWrite),
  };
}
