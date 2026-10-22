// The /portfolio "book": which companies it opens on, how one click adds or drops one, and the
// company x dimension matrix that names each company's weakest dimension and the book-wide gap.
//
// PURE (no db, no cookies, no session): the page gathers the inputs and RE-GATES every slug through
// canReadOrg after resolveBook, so the default book can never widen what a viewer can read. The
// workspace options are already canReadOrg-filtered by resolveViewerWorkspace; the page checks again
// because a header convenience is not an authorization.

import { DIMENSIONS } from "@/lib/maturity/model";
import { PUBLIC_ORG } from "@/lib/org-constants";
import type { PortfolioCompany } from "@/lib/org/portfolio";

export interface BookInput {
  /** Slugs parsed from ?orgs= (already split/lowercased by the page). */
  requested: string[];
  /** True when ?orgs= was present at all, even empty: an emptied book stays empty. */
  explicit: boolean;
  /** resolveViewerWorkspace().options - the viewer's selectable orgs, "public" among them. */
  workspaceOptions: readonly string[];
}

export interface Book {
  orgs: string[];
  source: "workspace" | "query";
}

const MAX_BOOK = 50;

function normalize(slugs: readonly string[]): string[] {
  const out = new Set<string>();
  for (const s of slugs) {
    const v = s.trim().toLowerCase();
    if (v) out.add(v);
  }
  return [...out].slice(0, MAX_BOOK);
}

/** The orgs the page will gate and read. Public is never added implicitly (it is not a company). */
export function resolveBook(input: BookInput): Book {
  if (input.explicit) return { orgs: normalize(input.requested), source: "query" };
  return { orgs: normalize(input.workspaceOptions).filter((o) => o !== PUBLIC_ORG), source: "workspace" };
}

/** The href that toggles one org in or out of the current book (a plain link; works without JS). */
export function bookToggleHref(book: readonly string[], org: string): string {
  const slug = org.trim().toLowerCase();
  const next = book.includes(slug) ? book.filter((o) => o !== slug) : [...book, slug];
  return `/portfolio?orgs=${encodeURIComponent(next.join(","))}`;
}

/** The identity menu offers Portfolio once the viewer can read two or more real (non-public) orgs. */
export function showPortfolioEntry(workspaceOptions: readonly string[]): boolean {
  return normalize(workspaceOptions).filter((o) => o !== PUBLIC_ORG).length >= 2;
}

export interface MatrixRow {
  org: string;
  dims: Record<string, number>;
  /** Lowest PRESENT dimension (ties: DIMENSIONS order); null when nothing was measured. */
  weakest: string | null;
}

export interface BookGap {
  dimId: string;
  /** One vote per company that has the dimension. */
  mean: number;
  /** Companies that have the dimension (the denominator of `mean`). */
  n: number;
  /** Companies whose weakest dimension this is. */
  weakestIn: number;
}

export interface PortfolioMatrix {
  dimIds: string[];
  rows: MatrixRow[];
  means: Record<string, { mean: number; n: number }>;
  bookGap: BookGap | null;
}

const DIM_IDS = DIMENSIONS.map((d) => d.id);

function weakestOf(dims: Record<string, number>): string | null {
  let best: string | null = null;
  for (const id of DIM_IDS) {
    const v = dims[id];
    if (v == null) continue;
    if (best === null || v < dims[best]!) best = id;
  }
  return best;
}

/**
 * The company x dimension matrix. An absent dimension stays absent (never a 0). The book gap prefers a
 * dimension at least two companies share: a single company's low score is that company's weakness,
 * not the book's.
 */
export function portfolioMatrix(companies: readonly PortfolioCompany[]): PortfolioMatrix {
  const rows = companies.map((c) => ({ org: c.org, dims: c.dims, weakest: weakestOf(c.dims) }));
  const means: PortfolioMatrix["means"] = {};
  for (const id of DIM_IDS) {
    const vals = rows.map((r) => r.dims[id]).filter((v): v is number => v != null);
    if (vals.length) means[id] = { mean: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), n: vals.length };
  }
  const shared = DIM_IDS.filter((id) => (means[id]?.n ?? 0) >= 2);
  const pool = shared.length ? shared : DIM_IDS.filter((id) => means[id]);
  let gap: string | null = null;
  for (const id of pool) if (gap === null || means[id]!.mean < means[gap]!.mean) gap = id;
  const bookGap = gap
    ? { dimId: gap, mean: means[gap]!.mean, n: means[gap]!.n, weakestIn: rows.filter((r) => r.weakest === gap).length }
    : null;
  return { dimIds: DIM_IDS, rows, means, bookGap };
}

/** Short name for a dimension column header / gap line. */
export function dimName(id: string): string {
  return DIMENSIONS.find((d) => d.id === id)?.name ?? id;
}
