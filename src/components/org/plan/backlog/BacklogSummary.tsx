import { Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import type { BacklogOwnerGroup, OrgBacklog } from "@/lib/db";

export function SummaryStrip({ b }: { b: OrgBacklog }) {
  // Use the canonical Tile ledger so these tiles match every other dashboard surface, instead of a
  // local Stat copy that drifted; only the column rhythm (4-across) is local. The Overdue and
  // Due-soon tiles moved to the Debt Ledger masthead above this panel (W5) — duplicating them here
  // would show the same debt twice on one tab; this strip keeps the WORKFLOW counts.
  return (
    <div className={`${TILE_LEDGER} grid-cols-2 lg:grid-cols-4`}>
      <Tile label="Active" value={b.active} />
      <Tile label="Unassigned" value={b.unassigned} color={b.unassigned ? "#fbbf24" : undefined} />
      <Tile label="In progress" value={b.inProgress} />
      <Tile label="Done" value={b.done} color={b.done ? "#22c55e" : undefined} />
    </div>
  );
}

export function OwnerHeader({ group }: { group: BacklogOwnerGroup }) {
  const name = group.login ?? "Unassigned";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`text-base font-semibold ${group.login ? "text-white" : "text-amber-300"}`}>
        {group.login ? `@${name}` : name}
      </span>
      <span className="font-mono text-sm text-slate-500">
        {group.active} active
        {group.overdue > 0 && <span className="text-orange-300"> · {group.overdue} overdue</span>}
      </span>
    </div>
  );
}
