// One cohort of the v2 fleet rollup: a ruled group, not a card. The head names the cohort with its average as a
// figure and its net move; the rows are the shared row (RepoCategoryRollupRow) separated by hairlines. A cohort
// with no live-scored repo has NO average: it says so in words and draws no bar (never a 0).
import { Display } from "@/components/kit";
import { deltaHex, fmtDelta } from "@/components/ui/format";
import { scoreHex } from "@/lib/ui";
import { agg, type Group } from "./repoCategoryRollupLogic";
import { RepoCategoryRollupRow } from "./RepoCategoryRollupRow";

export function FleetGroup({ g, orgSlug }: { g: Group; orgSlug: string }) {
  const { avg, realScored, net } = agg(g.rows);
  const mock = g.rows.length - realScored;
  const rows = [...g.rows].sort((a, b) => b.overall - a.overall);
  return (
    <section data-role="fleet-group" aria-label={g.label} className="mt-8 border-t border-divider pt-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <Display as="h3" level="named" className="flex items-center gap-2">
          {g.badge}
          {g.label}
          <span className="font-normal text-slate-400">· {g.rows.length}</span>
        </Display>
        {avg == null ? (
          <span className="type-caption text-slate-400" title={`No live-scored repositories in this group${mock > 0 ? ` (all ${mock} carry a deterministic mock score)` : ""}`}>
            No live score
          </span>
        ) : (
          <span
            className="type-caption text-slate-400"
            title={`Average over the ${realScored} live-scored repo${realScored === 1 ? "" : "s"}${mock > 0 ? ` · ${mock} mock placeholder${mock === 1 ? "" : "s"} excluded` : ""}`}
          >
            avg <span className="font-mono type-body font-semibold tabular-nums" style={{ color: scoreHex(avg) }}>{avg}</span>
            {mock > 0 && <span className="ml-2 tabular-nums">{mock} mock excluded</span>}
          </span>
        )}
        {net != null && (
          <span className="type-caption tabular-nums" style={{ color: deltaHex(net) }}>
            {fmtDelta(net)} avg move
          </span>
        )}
      </div>
      <div className="mt-2 divide-y divide-divider border-y border-divider">
        {rows.map((r) => (
          <RepoCategoryRollupRow key={r.fullName} r={r} orgSlug={orgSlug} />
        ))}
      </div>
    </section>
  );
}
