import type { BacklogOwnerGroup, OrgBacklog } from "@/lib/db";

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="font-mono text-2xl font-bold tabular-nums" style={{ color: color ?? "#fff" }}>
        {value}
      </div>
      <div className="mt-0.5 font-mono text-sm uppercase tracking-widest text-slate-500">{label}</div>
    </div>
  );
}

export function SummaryStrip({ b }: { b: OrgBacklog }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Active" value={b.active} />
      <Stat label="Overdue" value={b.overdue} color={b.overdue ? "#f97316" : undefined} />
      <Stat label="Due ≤ 7d" value={b.dueSoon} color={b.dueSoon ? "#eab308" : undefined} />
      <Stat label="Unassigned" value={b.unassigned} color={b.unassigned ? "#fbbf24" : undefined} />
      <Stat label="In progress" value={b.inProgress} />
      <Stat label="Done" value={b.done} color={b.done ? "#22c55e" : undefined} />
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
