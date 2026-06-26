import { Tile } from "@/components/org/ui";
import type { BacklogOwnerGroup, OrgBacklog } from "@/lib/db";

export function SummaryStrip({ b }: { b: OrgBacklog }) {
  // Use the canonical Tile (brand Surface + Stat) so these tiles match every other dashboard surface,
  // instead of a local Stat copy that drifted (bordered box, text-2xl vs the canonical text-3xl).
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="Active" value={b.active} />
      <Tile label="Overdue" value={b.overdue} color={b.overdue ? "#f97316" : undefined} />
      <Tile label="Due ≤ 7d" value={b.dueSoon} color={b.dueSoon ? "#eab308" : undefined} />
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
