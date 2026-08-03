// One category group card (header aggregates + repo rows) inside RepoCategoryRollup. Split out of
// RepoCategoryRollup.tsx per docs/ORG-TABS-REFACTOR.md (JSX regions → sibling components) to keep the
// parent under the 200-LOC cap.
import { Meter } from "@/components/org/shared/ui";
import { fmtDelta, deltaHex } from "@/components/ui/format";
import { scoreHex } from "@/lib/ui";
import { agg, type Group } from "./repoCategoryRollupLogic";
import { RepoCategoryRollupRow } from "./RepoCategoryRollupRow";

export function RepoCategoryRollupGroup({ g, orgSlug }: { g: Group; orgSlug: string }) {
  const { avg, realScored, net } = agg(g.rows);
  const rows = [...g.rows].sort((a, b) => b.overall - a.overall);
  const mock = g.rows.length - realScored;
  return (
    <div className="overflow-hidden rounded-2xl border border-divider bg-surface/40">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-divider px-4 py-3">
        <span className="flex items-center gap-2 font-mono text-sm text-slate-100">
          {g.badge}
          {g.label}
          <span className="text-slate-500">· {g.rows.length}</span>
        </span>
        {/* The cohort average excludes deterministic-mock placeholders (agg → avgRealScore), so it is
            a measurement over repos that were actually measured. A cohort with none of those has no
            average at all: render the same "—" no-score treatment the net-move figure uses, and no
            Meter — a 0-width bar in scoreHex(0) alarm-red would read as a real, terrible score. */}
        {avg == null ? (
          <span
            className="font-mono text-sm text-slate-600"
            title={`No live-scored repositories in this group${mock > 0 ? ` — all ${mock} carry a deterministic mock score` : ""}`}
          >
            — no score
          </span>
        ) : (
          <span
            className="flex items-center gap-2"
            title={`Average over the ${realScored} live-scored repo${realScored === 1 ? "" : "s"}${mock > 0 ? ` · ${mock} mock placeholder${mock === 1 ? "" : "s"} excluded` : ""}`}
          >
            <span className="font-mono text-lg font-bold tabular-nums" style={{ color: scoreHex(avg) }}>
              {avg}
            </span>
            <Meter value={avg} size="sm" color={scoreHex(avg)} className="w-24" />
            {mock > 0 && <span className="font-mono text-xs tabular-nums text-slate-500">{mock} mock excl.</span>}
          </span>
        )}
        {net != null && (
          <span className="font-mono text-xs tabular-nums" style={{ color: deltaHex(net) }}>
            {fmtDelta(net)} avg move
          </span>
        )}
      </div>
      <div className="divide-y divide-divider">
        {rows.map((r) => (
          <RepoCategoryRollupRow key={r.fullName} r={r} orgSlug={orgSlug} />
        ))}
      </div>
    </div>
  );
}
