// "Cheapest path to green" card — failing repos closest to passing, linked to the practice that
// clears each dimension. Extracted from the old governance page.tsx JSX
// (docs/ORG-TABS-REFACTOR.md JSX-region split).

import Link from "next/link";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { GovernanceOverview } from "@/lib/org/governance";

export function GovernanceClosestToGreenCard({ slug, g }: { slug: string; g: GovernanceOverview }) {
  if (g.closestToGreen.length === 0) return null;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Cheapest path to green"
        description="Failing repos closest to passing — fewest conditions and smallest gap first. Apply the linked practice to clear each dimension."
      />
      <div className="mt-3 space-y-3">
        {g.closestToGreen.map((r) => (
          <div key={r.fullName} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-sm text-slate-200">{r.fullName}</span>
              <span className="font-mono text-xs text-slate-500">
                {r.failCount} condition{r.failCount === 1 ? "" : "s"}
                {r.gap > 0 && <> · +{r.gap} pts to clear</>}
              </span>
            </div>
            {r.dims.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.dims.map((d) => {
                  const label = `${d.dimId} ${d.name}: ${d.score}→${d.floor} (+${d.gap})`;
                  return d.practiceId ? (
                    <Link
                      key={d.dimId}
                      href={`${orgTabHref(slug, "practices")}#practice-${d.practiceId}`}
                      className="rounded-full border border-accent/40 bg-accent/5 px-2 py-0.5 font-mono text-sm text-accent transition hover:border-accent hover:text-white"
                      title={`Apply the ${d.name} practice`}
                    >
                      {label} →
                    </Link>
                  ) : (
                    <span key={d.dimId} className="rounded-full border border-slate-700 px-2 py-0.5 font-mono text-sm text-slate-400">
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
            {r.blockers.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {r.blockers.map((b, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-500">
                    <span aria-hidden className="select-none text-amber-400/70">!</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {/* Every failing repo is a green-path candidate, so the full count is g.failing; this list is
          capped to the closest. Communicate the cap so it reconciles with the Failing tile. */}
      {g.failing > g.closestToGreen.length && (
        <p className="mt-3 font-mono text-sm text-slate-500">
          Showing the {g.closestToGreen.length} closest of {g.failing} failing repos.
        </p>
      )}
    </Card>
  );
}
