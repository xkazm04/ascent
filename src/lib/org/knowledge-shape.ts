// The client-safe SHAPE of the Knowledge base view: its types and the two pure helpers that read
// them. Split out of `knowledge-view.ts` because that module reaches the database (via
// `registry-view` → `@/lib/db` → Prisma → `pg`) and `KnowledgeLedger` rendered under a
// `"use client"` panel. A single VALUE import of `artifactTotal` from there pulled the whole
// Prisma/pg chain into the browser bundle, which fails to resolve Node's `tls` and `util/types`
// and 500s every /org/<slug> route. Types alone would have been erased; the value import is what
// crossed the boundary, so the values live here where the client may have them.
//
// The prototype switcher that made the panel a client component is GONE (Ledger won; the whole
// tab is server-rendered now), so nothing in this feature currently crosses that boundary. The
// split stays anyway: the failure it prevents is one `"use client"` away, and the seam costs a
// file. Do not fold it back in on the grounds that nothing needs it today.
//
// Rule of thumb for this pair: anything a client component needs goes in this file; anything that
// touches the database stays in `knowledge-view.ts`.

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
