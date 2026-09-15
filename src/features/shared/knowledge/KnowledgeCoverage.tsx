// FIRST SIGHT for the Knowledge base: how much of each published bundle this Ascent actually holds,
// and how much of what it holds the fleet has judged.
//
// The honest graphic for THIS tab. The Knowledge base carries no per-repo adoption state — it is
// reference about reference — so there is no fleet posture to draw and none is drawn. What it has is
// structure: coverage (subjects mirrored against subjects published), provenance/routability
// (techniques carrying a `use_when` trigger, the share an agent can be routed to rather than merely
// read), and freshness (pairs judged, which is `missing` outright when the sweep never ran).
//
// Server-safe: no hooks and no handlers of its own — `MatrixGrid` and `WhyChip` carry their own
// client boundary. Every encoding comes from `@/components/org/viz`; nothing here paints a state.

import { Kicker } from "@/components/ui";
import { Legend, MatrixGrid, WhyChip, type MatrixRow, type VizState } from "@/components/org/viz";
import type { KnowledgeView } from "@/lib/org/knowledge-shape";
import { sweepAge } from "./knowledgeModel";
import { type BundleCoverage, bundleCoverageRows } from "./knowledgeViz";

export const COVERAGE_AXES = ["Mirrored", "Routable", "Judged"] as const;

/** Row labels are drawn into a 104-unit gutter at 10px; longer names would run into the first cell. */
const LABEL_MAX = 18;
const truncate = (s: string) => (s.length <= LABEL_MAX ? s : `${s.slice(0, LABEL_MAX - 1).trimEnd()}…`);

/**
 * The (D) Disclosed destinations for the captions this panel does NOT print above the picture. One
 * sentence per column, reachable on focus, absent at first sight.
 */
export const COVERAGE_HINT: Record<(typeof COVERAGE_AXES)[number], string> = {
  Mirrored:
    "Subjects this Ascent holds as rows, against the count the bundle's own index publishes. A dashed cell means the bundle declares subjects and no index pass ever resolved one — the registry's claim, never this Ascent's reading.",
  Routable:
    "Techniques carrying a `use_when` trigger. This is the field an agent selects on, so the share is the difference between a bundle that can be consulted automatically and one that can only be read by a human.",
  Judged:
    "Pairs of (subject × mapped repo) carrying a current verdict from the repo's own /conform. Hatched means no repository carries a registry map, so there is nothing a sweep could have read; empty means the fleet was never swept at all.",
};

function rowOf(c: BundleCoverage): MatrixRow {
  return {
    id: c.domain.name,
    label: truncate(c.domain.title),
    cells: [c.mirrored, c.routable, c.judged].map((a) => ({ state: a.state, score: a.score })),
  };
}

export function KnowledgeCoverage({ view, className = "" }: { view: KnowledgeView; className?: string }) {
  const coverage = bundleCoverageRows(view);
  if (coverage.length === 0) return null;
  const rows = coverage.map(rowOf);
  const states: VizState[] = rows.flatMap((r) => r.cells.map((c) => c.state));
  const mirrored = coverage.reduce((n, c) => n + (c.mirrored.have ?? 0), 0);
  const published = coverage.reduce((n, c) => n + (c.mirrored.of ?? 0), 0);

  return (
    <section className={`space-y-3 rounded-2xl border border-divider bg-ink px-4 py-3 ${className}`} aria-label="Bundle coverage">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker>Bundle coverage</Kicker>
        {/* ≤60 chars of unit and window — never the meaning of the picture below it. */}
        <span className="type-mono-sm text-slate-500">
          {mirrored}/{published} subjects · swept {sweepAge(view.sweep.lastAt)}
        </span>
      </div>

      <div className="max-w-lg">
        <MatrixGrid axes={[...COVERAGE_AXES]} rows={rows} title={`Coverage of ${coverage.length} knowledge bundle${coverage.length === 1 ? "" : "s"}`} />
      </div>

      <Legend states={states} />

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {COVERAGE_AXES.map((axis) => (
          <li key={axis} className="flex items-center gap-1.5">
            <Kicker tone="muted" as="span">
              {axis}
            </Kicker>
            <WhyChip hint={COVERAGE_HINT[axis]} label={axis} />
          </li>
        ))}
      </ul>
    </section>
  );
}
