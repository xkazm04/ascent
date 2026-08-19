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
// ## Status of the wiring (read this before trusting the counts)
//
// The registry indexer does not parse `knowledge/**` yet — it walks skills/practices/memory. Until
// it does, `getKnowledgeView` reports the mapping state truthfully from the registry row and serves
// domain rows from `PREVIEW_DOMAINS`, whose numbers are the REAL current contents of
// xkazm04/ai-registry (verified 2026-08-19), not invented placeholders. The `provisional` flag is
// on the view rather than in a comment so the UI can SAY SO to the user; a preview that cannot
// admit it is a preview is just a wrong number.

import { getRegistryView } from "./registry-view";

export type KnowledgeStatus = "unmapped" | "empty" | "indexed" | "error";

/** One domain bundle's overview row. Mirrors `index.json`'s `meta` block. */
export type KnowledgeDomain = {
  /** Directory name under `knowledge/`, e.g. `software-engineering`. */
  name: string;
  /** Display title derived from the name. */
  title: string;
  subjects: number;
  techniques: number;
  applications: number;
  /** Cross-cutting laws cited by this bundle's techniques. */
  laws: number;
  /** Category ids declared by the bundle, in declaration order. */
  categories: string[];
  /**
   * How many techniques carry a `use_when` trigger, as `written/total`. This is the field an agent
   * selects on, so a low ratio is the difference between a bundle that can be consulted
   * automatically and one that can only be read by a human.
   */
  useWhenCoverage: { written: number; total: number };
};

export type KnowledgeView = {
  status: KnowledgeStatus;
  /** The mapped registry repo, when there is one. */
  registry?: { fullName: string; url: string; lastIndexedAt: string | null };
  /** Sorted by artifact weight, largest first — see `sortDomains`. */
  domains: KnowledgeDomain[];
  totals: { domains: number; subjects: number; techniques: number; applications: number };
  /**
   * True while the counts come from the seeded preview rather than a real index pass. The UI must
   * surface this; see the file header.
   */
  provisional: boolean;
  error?: { message: string; at: string };
};

/**
 * The real contents of xkazm04/ai-registry, verified 2026-08-19 against
 * `knowledge/software-engineering/index.json`. Replace with indexer output — do not "update" these
 * by hand as the bundle grows, because a hand-maintained number drifts silently and this one is
 * displayed as fact.
 */
const PREVIEW_DOMAINS: KnowledgeDomain[] = [
  {
    name: "software-engineering",
    title: "Software engineering",
    subjects: 105,
    techniques: 624,
    applications: 236,
    laws: 9,
    categories: [
      "ui-surfaces",
      "client-architecture",
      "llm-agent",
      "backend-platform",
      "operations",
      "security",
      "integration",
      "engineering-process",
    ],
    useWhenCoverage: { written: 0, total: 624 },
  },
];

/** Total published artifacts across the three layers that publish. */
export function artifactTotal(d: KnowledgeDomain): number {
  return d.subjects + d.techniques + d.applications;
}

/**
 * Sort order for the ledger: heaviest bundle first, ties broken by name so the order is stable
 * across renders (two bundles of equal weight must not swap places between page loads).
 */
export function sortDomains(domains: KnowledgeDomain[]): KnowledgeDomain[] {
  return [...domains].sort((a, b) => artifactTotal(b) - artifactTotal(a) || a.name.localeCompare(b.name));
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

  const domains = sortDomains(PREVIEW_DOMAINS);

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
    provisional: true,
  };
}
