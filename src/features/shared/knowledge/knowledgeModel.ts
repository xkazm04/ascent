// Pure derivations for the Knowledge base surfaces. No JSX, no hooks — the tree, the matrix, the
// repo board and the dispatch composer all read the SAME shapes, so they cannot disagree about what
// an absent verdict means.
//
// The vocabulary is the contract's: `KNOWLEDGE_CELL_STATES` in `@/lib/org/knowledge-shape`. Eleven
// states, and every one of them renders differently, because collapsing any two turns the
// instrument into a decoration. Verdicts are the repo's own; absences are the registry's
// classification (`build-fleet-map.mjs`), and "no map" is the one that says nothing can be known.
// Labels, glyphs and tones live in the co-located `knowledgeVocabulary.ts`, re-exported here.

import type {
  KnowledgeCategory,
  KnowledgeCell,
  KnowledgeCellState,
  KnowledgeRepo,
  KnowledgeSubject,
  KnowledgeView,
} from "@/lib/org/knowledge-shape";
import { titleOfSlug } from "@/lib/org/knowledge-shape";
import { STATE_RANK } from "./knowledgeVocabulary";

export * from "./knowledgeVocabulary";

export const cellKey = (subject: string, repositoryId: string) => `${subject} ${repositoryId}`;

export interface CellIndex {
  get(subject: string, repositoryId: string): KnowledgeCell | undefined;
}

export function indexCells(cells: KnowledgeCell[]): CellIndex {
  const m = new Map<string, KnowledgeCell>();
  for (const c of cells) m.set(cellKey(c.subject, c.repositoryId), c);
  return { get: (s, r) => m.get(cellKey(s, r)) };
}

export type StateCounts = Record<KnowledgeCellState, number>;

export const emptyCounts = (): StateCounts =>
  Object.fromEntries(Object.keys(STATE_RANK).map((k) => [k, 0])) as StateCounts;

/** Fold a set of cells to per-state counts — the spectrum a repo card or a subject row shows. */
export function countStates(cells: Iterable<KnowledgeCell>): StateCounts {
  const out = emptyCounts();
  for (const c of cells) out[c.state] += 1;
  return out;
}

export function worstState(cells: Iterable<KnowledgeCell>): KnowledgeCellState {
  let best: KnowledgeCellState = "no-map";
  for (const c of cells) if (STATE_RANK[c.state] > STATE_RANK[best]) best = c.state;
  return best;
}

/** Repos that are matrix columns: the ones with a map, most deviations first, then by name. */
export function columnRepos(repos: KnowledgeRepo[]): KnowledgeRepo[] {
  return repos.filter((r) => r.hasMap).sort((a, b) => b.deviations - a.deviations || a.fullName.localeCompare(b.fullName));
}

/** Repos with no map yet — the strip that carries the populate / map call to action. */
export const unmappedRepos = (repos: KnowledgeRepo[]) => repos.filter((r) => !r.hasMap);

export interface TreeGroup {
  category: KnowledgeCategory;
  /** Subjects directly under the category, resolved to rows. */
  subjects: KnowledgeSubject[];
  subcategories: { id: string; title: string; subjects: KnowledgeSubject[] }[];
  total: number;
}

/**
 * The bundle's taxonomy resolved to subject rows. When the index pass predates the taxonomy mirror
 * (`taxonomy: []`), the tree is rebuilt from the subjects' own category / subcategory ids with
 * derived titles — the same shape with worse labels, never a different one.
 */
export function buildTree(taxonomy: KnowledgeCategory[], subjects: KnowledgeSubject[]): TreeGroup[] {
  const bySlug = new Map(subjects.map((s) => [s.slug, s]));
  const pick = (slugs: string[]) => slugs.map((s) => bySlug.get(s)).filter((s): s is KnowledgeSubject => !!s);
  const cats: KnowledgeCategory[] = taxonomy.length ? taxonomy : fallbackTaxonomy(subjects);
  return [...cats]
    .sort((a, b) => a.order - b.order)
    .map((category) => {
      const direct = pick(category.subjects);
      const subcategories = category.subcategories
        .map((sc) => ({ id: sc.id, title: sc.title, subjects: pick(sc.subjects) }))
        .filter((sc) => sc.subjects.length);
      return { category, subjects: direct, subcategories, total: direct.length + subcategories.reduce((n, sc) => n + sc.subjects.length, 0) };
    })
    .filter((g) => g.total > 0);
}

function fallbackTaxonomy(subjects: KnowledgeSubject[]): KnowledgeCategory[] {
  const cats = new Map<string, KnowledgeCategory>();
  subjects.forEach((s) => {
    const id = s.category ?? "uncategorised";
    const cat = cats.get(id) ?? { id, title: titleOfSlug(id), order: cats.size, subjects: [], subcategories: [] };
    if (s.subcategory) {
      const sc = cat.subcategories.find((x) => x.id === s.subcategory) ?? { id: s.subcategory, title: titleOfSlug(s.subcategory), subjects: [] };
      if (!cat.subcategories.includes(sc)) cat.subcategories.push(sc);
      sc.subjects.push(s.slug);
    } else cat.subjects.push(s.slug);
    cats.set(id, cat);
  });
  return [...cats.values()];
}

/** Every subject of the tree in display order — the matrix's row order. */
export const flattenTree = (tree: TreeGroup[]): KnowledgeSubject[] =>
  tree.flatMap((g) => [...g.subjects, ...g.subcategories.flatMap((sc) => sc.subjects)]);

export function domainOf(view: KnowledgeView, name: string | null) {
  return view.domains.find((d) => d.name === name) ?? view.domains[0] ?? null;
}

/** The subjects of one bundle. */
export const subjectsOf = (view: KnowledgeView, bundle: string) => view.subjects.filter((s) => s.bundle === bundle);

/** ISO → "3h ago"-style age, or the honest word for never. */
export function sweepAge(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const h = Math.max(0, (now - new Date(iso).getTime()) / 36e5);
  return h < 1 ? "under an hour ago" : h < 48 ? `${Math.round(h)}h ago` : `${(h / 24).toFixed(1)}d ago`;
}

/** Micro-format for a cost the CLI reported in micro-dollars; null stays "—". */
export const fmtCost = (micros: number | null) => (micros == null ? "—" : `$${(micros / 1e6).toFixed(2)}`);

/** "14 consults · 9 deviations", with — for a key no contributor reported and "no witness" for none. */
export function readSignal(s: { contributors: number; consults: number | null; deviations: number | null } | null): string {
  if (!s || s.contributors === 0) return "no witness";
  const n = (v: number | null) => (v == null ? "—" : v.toLocaleString());
  return `${n(s.consults)} consults · ${n(s.deviations)} deviations`;
}
