// The Knowledge base tab's EPISTEMIC derivations: every reading that has to answer "did we measure
// this, or is there simply nothing here?" before a shape is drawn. Pure — no JSX, no hooks — so the
// coverage matrix, the loom's warp and the subject reader cannot disagree about what an absence is.
//
// The Knowledge base has no per-repo adoption state (that is why `ORG_NAV_GROUPS` puts it last in
// Shared), so there is no fleet posture to draw. What it does have is STRUCTURE — coverage, freshness
// and provenance — and that is what these functions reduce the view to.
//
// The rule every function here exists to enforce: a count of zero is only ever emitted when zero was
// MEASURED. Where the instrument never ran, the count is `null` and the state is `missing` or
// `not-judged`, which `rendersValue()` then refuses to print a numeral for.

import type { VizState } from "@/components/org/viz";
import type { KnowledgeCell, KnowledgeDomain, KnowledgeRepo, KnowledgeSubject, KnowledgeView } from "@/lib/org/knowledge-shape";
import { type CellIndex, CELL_VIZ_STATE, columnRepos, subjectsOf } from "./knowledgeModel";

/** A judged pair — the three states `/conform` actually writes. `unknown` is the matcher's, not a verdict. */
const JUDGED = new Set(["conformant", "deviation", "not-applicable"]);

/** One axis of the coverage matrix: a share, plus whether that share was measured at all. */
export type CoverageAxis = {
  state: VizState;
  /** 0..100, or null where the state forbids a value. Never 0 as a stand-in for "unknown". */
  score: number | null;
  /** The raw pair, for the unit line and the sr-only table. `null` denominators stay null. */
  have: number | null;
  of: number | null;
};

export type BundleCoverage = {
  domain: KnowledgeDomain;
  /** Subjects the index mirrored as rows, against the count the bundle publishes. */
  mirrored: CoverageAxis;
  /** Techniques carrying a `use_when` trigger — the share an agent can be ROUTED to, not just read. */
  routable: CoverageAxis;
  /** Pairs the fleet has judged, against the pairs that exist. Absent instrument ⇒ no number. */
  judged: CoverageAxis;
};

const share = (have: number, of: number): CoverageAxis => ({
  state: "measured",
  score: of > 0 ? Math.round((have / of) * 100) : 0,
  have,
  of,
});

const noReading = (state: VizState, of: number | null = null): CoverageAxis => ({ state, score: null, have: null, of });

/**
 * How much of ONE bundle we hold, and how much of it the fleet has judged.
 *
 * `mirrored` is `declared` — not a zero — when the bundle publishes subjects and the index mirrored
 * none of them: the registry DECLARES them, this Ascent has never resolved one. `judged` is `missing`
 * when the fleet was never swept (the instrument never ran) and `not-judged` when no repo carries a
 * registry map (there is nothing the sweep could have read).
 */
export function bundleCoverage(view: KnowledgeView, domain: KnowledgeDomain): BundleCoverage {
  const mirroredRows = subjectsOf(view, domain.name);
  const published = domain.subjects;
  const mirrored =
    published <= 0 ? noReading("missing") : mirroredRows.length === 0 ? noReading("declared", published) : share(mirroredRows.length, published);

  const { written, total } = domain.useWhenCoverage;
  const routable = total <= 0 ? noReading("missing") : share(written, total);

  const cols = columnRepos(view.repos);
  const slugs = new Set(mirroredRows.map((s) => s.slug));
  const ids = new Set(cols.map((r) => r.repositoryId));
  const pairs = view.cells.filter((c) => slugs.has(c.subject) && ids.has(c.repositoryId));
  const judged =
    view.sweep.lastAt == null
      ? noReading("missing")
      : cols.length === 0 || pairs.length === 0
        ? noReading("not-judged", pairs.length || null)
        : share(pairs.filter((c) => JUDGED.has(c.state) && !c.stale).length, pairs.length);

  return { domain, mirrored, routable, judged };
}

export const bundleCoverageRows = (view: KnowledgeView): BundleCoverage[] => view.domains.map((d) => bundleCoverage(view, d));

/**
 * A subject's PROVENANCE, on the kit's axis — the warp's own state, drawn beside each row label:
 *   missing   the subject's bundle is not in this view at all: nothing about it can be read here
 *   declared  the registry declares the subject and this index never resolved it to content
 *             (no digest) or to a freshness reading (no revision)
 *   measured  we hold the subject's digest AND a revision, so "how old is this" has an answer
 */
export function subjectVizState(view: KnowledgeView, subject: KnowledgeSubject): VizState {
  if (!view.domains.some((d) => d.name === subject.bundle)) return "missing";
  if (subject.digest == null || subject.revision == null) return "declared";
  return "measured";
}

export type ImpactRow = { repo: KnowledgeRepo; contexts: number; stale: number; state: VizState; cellState: KnowledgeCell["state"] };

/**
 * A subject's blast radius, with the absence honestly typed. `contexts`/`repos`/`stale` are `null` —
 * never 0 — whenever the fleet was never swept or no repo carries a map: a zero there would claim the
 * subject governs nothing, when what happened is that nobody looked.
 */
export type SubjectImpact = {
  state: VizState;
  contexts: number | null;
  repos: number | null;
  stale: number | null;
  rows: ImpactRow[];
};

export function subjectImpact(view: KnowledgeView, subject: KnowledgeSubject, cells: CellIndex): SubjectImpact {
  const cols = columnRepos(view.repos);
  if (view.sweep.lastAt == null) return { state: "missing", contexts: null, repos: null, stale: null, rows: [] };
  if (cols.length === 0) return { state: "not-judged", contexts: null, repos: null, stale: null, rows: [] };

  const rows: ImpactRow[] = cols.flatMap((repo) => {
    const cell = cells.get(subject.slug, repo.repositoryId);
    if (!cell) return [];
    return [
      {
        repo,
        contexts: cell.contextRows.length,
        stale: cell.contextRows.filter((c) => c.stale).length,
        state: CELL_VIZ_STATE[cell.state],
        cellState: cell.state,
      },
    ];
  });
  const withContexts = rows.filter((r) => r.contexts > 0);
  return {
    state: "measured",
    contexts: withContexts.reduce((n, r) => n + r.contexts, 0),
    repos: withContexts.length,
    stale: withContexts.reduce((n, r) => n + r.stale, 0),
    rows,
  };
}
