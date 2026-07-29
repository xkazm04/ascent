// One category group card (header aggregates + repo rows) inside RepoCategoryRollup. Split out of
// RepoCategoryRollup.tsx per docs/ORG-TABS-REFACTOR.md (JSX regions → sibling components) to keep the
// parent under the 200-LOC cap.
import { Meter } from "@/components/org/shared/ui";
import { fmtDelta, deltaHex } from "@/components/ui/format";
import { scoreHex } from "@/lib/ui";
import { agg, type Group } from "./repoCategoryRollupLogic";
import { RepoCategoryRollupRow } from "./RepoCategoryRollupRow";

export function RepoCategoryRollupGroup({ g, orgSlug }: { g: Group; orgSlug: string }) {
  const { avg, net } = agg(g.rows);
  const rows = [...g.rows].sort((a, b) => b.overall - a.overall);
  return (
    <div className="overflow-hidden rounded-2xl border border-divider bg-surface/40">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-divider px-4 py-3">
        <span className="flex items-center gap-2 font-mono text-sm text-slate-100">
          {g.badge}
          {g.label}
          <span className="text-slate-500">· {g.rows.length}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-lg font-bold tabular-nums" style={{ color: scoreHex(avg) }}>
            {avg}
          </span>
          <Meter value={avg} size="sm" color={scoreHex(avg)} className="w-24" />
        </span>
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
