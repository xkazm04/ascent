// Knowledge base view — the org's Reference Knowledge Bundles as published in the mapped registry
// repo (`knowledge/<domain>/`), read at the overview level only.
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
// Each bundle carries a generated `knowledge/<domain>/index.json` whose `meta` block is exactly this
// overview: subjects, techniques, applications, laws, categories, use_when_coverage. That file
// exists so a consumer can characterise a bundle WITHOUT reading its ~1,000 markdown documents —
// which is what makes this tab cheap enough to be an overview rather than an explorer.
//
// ## Where the numbers come from now
//
// The indexer reads each bundle's generated index on every pass and stores the summary on the
// registry row, so this view is a plain read of indexed truth. It used to serve a hand-read
// `PREVIEW_DOMAINS` constant behind a `provisional` flag; that flag now reports whether the lane
// has actually been indexed, and the constant is gone — a hand-maintained number displayed as fact
// drifts silently, which is exactly why it was flagged rather than trusted.

import { getRegistryView } from "./registry-view";
import { sortDomains } from "./knowledge-shape";
import type { KnowledgeDomain, KnowledgeView } from "./knowledge-shape";

// The view SHAPE lives in a client-safe sibling (see its header); re-exported so every existing
// `@/lib/org/knowledge-view` import keeps working. SERVER callers may use this barrel; a client
// component must import from "./knowledge-shape" directly or it drags Prisma into the browser.
export type { KnowledgeStatus, KnowledgeDomain, KnowledgeView } from "./knowledge-shape";
export { artifactTotal, sortDomains } from "./knowledge-shape";

/** `software-engineering` → `Software engineering`. The bundle's directory name is its identity;
 *  the title is presentation, so it is derived rather than stored twice. */
function titleOf(name: string): string {
  const spaced = name.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** `"0/624"` → `{ written: 0, total: 624 }`. Falls back to the bundle's technique count so a
 *  missing or malformed field reads as "none of them", never as a coverage of zero out of zero —
 *  which would render as 0% and 100% depending on which way the UI divides. */
function parseCoverage(raw: string | null, techniques: number): { written: number; total: number } {
  const m = raw?.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return { written: 0, total: techniques };
  return { written: Number(m[1]), total: Number(m[2]) };
}

export async function getKnowledgeView(slug: string): Promise<KnowledgeView> {
  const registry = await getRegistryView(slug);

  const empty: KnowledgeView = {
    status: "unmapped",
    domains: [],
    totals: { domains: 0, subjects: 0, techniques: 0, applications: 0 },
    provisional: false,
  };

  if (registry.status === "unmapped" || !registry.registry) return empty;

  if (registry.status === "error") {
    return {
      ...empty,
      status: "error",
      registry: {
        fullName: registry.registry.fullName,
        url: registry.registry.url,
        lastIndexedAt: registry.registry.lastIndexedAt,
      },
      ...(registry.error ? { error: registry.error } : {}),
    };
  }

  // One row per bundle, exactly as that bundle's own generated index states it.
  const domains = sortDomains(
    registry.bundles.map((b) => ({
      name: b.name,
      title: titleOf(b.name),
      subjects: b.subjects,
      techniques: b.techniques,
      applications: b.applications,
      laws: b.laws,
      categories: b.categories,
      useWhenCoverage: parseCoverage(b.useWhenCoverage, b.techniques),
    })),
  );

  return {
    status: domains.length === 0 ? "empty" : "indexed",
    registry: {
      fullName: registry.registry.fullName,
      url: registry.registry.url,
      lastIndexedAt: registry.registry.lastIndexedAt,
    },
    domains,
    totals: {
      domains: domains.length,
      subjects: domains.reduce((n, d) => n + d.subjects, 0),
      techniques: domains.reduce((n, d) => n + d.techniques, 0),
      applications: domains.reduce((n, d) => n + d.applications, 0),
    },
    // Indexed truth once a pass has read the lane; an empty lane is not a preview.
    provisional: false,
  };
}
