"use client";

import { useCallback, useState } from "react";
import { Card } from "@/components/org/ui";
import { REC_STATUSES, type RecEvent, type RecStatus } from "@/lib/types";
import type { BacklogItem, BacklogOwnerGroup, BacklogDueGroup, OrgBacklog } from "@/lib/db";

const STATUS_LABEL: Record<RecStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};

const STATUS_ACCENT: Record<string, string> = {
  open: "#64748b",
  in_progress: "#eab308",
  done: "#22c55e",
  dismissed: "#475569",
};

const EVENT_LABEL: Record<string, string> = {
  status: "Status",
  assignee: "Owner",
  target_date: "Due date",
};

/** Render a stored event value for display — status ids become labels; null reads as a dash. */
function eventValue(kind: string, v: string | null): string {
  if (v == null) return "—";
  if (kind === "status") return STATUS_LABEL[v as RecStatus] ?? v;
  return v;
}

/** "in 3 days" / "2 days ago" / "today" for a due date relative to its computed day offset. */
function dueLabel(item: BacklogItem): string | null {
  if (item.dueInDays == null) return null;
  const d = item.dueInDays;
  if (d === 0) return "due today";
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  return `due in ${d} day${d === 1 ? "" : "s"}`;
}

/**
 * The org-wide recommendation backlog: a stat strip, a By owner / By due date toggle, and inline
 * controls to set each item's status, owner, and due date. Every change PATCHes the recommendation
 * (recording an activity-timeline event) and re-reads the backlog so the groupings and counts stay
 * consistent. Each item exposes its history on demand.
 */
export function BacklogPanel({ slug, initial }: { slug: string; initial: OrgBacklog }) {
  const [backlog, setBacklog] = useState<OrgBacklog>(initial);
  const [view, setView] = useState<"owner" | "due">("owner");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setSaving = (id: string, on: boolean) =>
    setSavingIds((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/org/backlog?org=${encodeURIComponent(slug)}`);
    if (res.ok) {
      const data = (await res.json()) as { backlog: OrgBacklog | null };
      if (data.backlog) setBacklog(data.backlog);
    }
  }, [slug]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setSaving(id, true);
      setErrors((e) => {
        if (!e[id]) return e;
        const next = { ...e };
        delete next[id];
        return next;
      });
      try {
        const res = await fetch(`/api/recommendations/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const msg = (await res.json().catch(() => ({})))?.error ?? "Couldn’t save that change.";
          setErrors((e) => ({ ...e, [id]: msg }));
          return;
        }
        await refresh();
      } catch {
        setErrors((e) => ({ ...e, [id]: "Network error — check your connection and retry." }));
      } finally {
        setSaving(id, false);
      }
    },
    [refresh],
  );

  const groups: { key: string; header: React.ReactNode; items: BacklogItem[] }[] =
    view === "owner"
      ? backlog.byOwner.map((g) => ({ key: g.login ?? "__unassigned", header: <OwnerHeader group={g} />, items: g.items }))
      : backlog.byDue.map((g: BacklogDueGroup) => ({
          key: g.bucket,
          header: (
            <span className={`text-sm font-semibold ${g.bucket === "overdue" ? "text-orange-300" : "text-white"}`}>
              {g.label} <span className="font-mono text-[11px] text-slate-500">· {g.items.length}</span>
            </span>
          ),
          items: g.items,
        }));

  return (
    <div className="space-y-5">
      <SummaryStrip b={backlog} />

      <div className="flex items-center gap-1 text-xs">
        <span className="mr-1 font-mono text-[11px] uppercase tracking-widest text-slate-500">Group by</span>
        {(["owner", "due"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-lg border px-3 py-1.5 font-medium transition ${
              view === v ? "border-accent/50 bg-accent/10 text-white" : "border-slate-700 text-slate-400 hover:text-white"
            }`}
          >
            {v === "owner" ? "Owner" : "Due date"}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">
            Nothing active in the backlog — every recommendation is done or dismissed. 🎉
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.key}>
              <div className="mb-3">{g.header}</div>
              <div className="space-y-3">
                {g.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    assignees={backlog.assignees}
                    saving={savingIds.has(item.id)}
                    error={errors[item.id]}
                    onPatch={patch}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="font-mono text-2xl font-bold tabular-nums" style={{ color: color ?? "#fff" }}>
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
    </div>
  );
}

function SummaryStrip({ b }: { b: OrgBacklog }) {
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

function OwnerHeader({ group }: { group: BacklogOwnerGroup }) {
  const name = group.login ?? "Unassigned";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`text-sm font-semibold ${group.login ? "text-white" : "text-amber-300"}`}>
        {group.login ? `@${name}` : name}
      </span>
      <span className="font-mono text-[11px] text-slate-500">
        {group.active} active
        {group.overdue > 0 && <span className="text-orange-300"> · {group.overdue} overdue</span>}
      </span>
    </div>
  );
}

function ItemRow({
  item,
  assignees,
  saving,
  error,
  onPatch,
}: {
  item: BacklogItem;
  assignees: string[];
  saving: boolean;
  error?: string;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [history, setHistory] = useState<RecEvent[] | "loading" | null>(null);

  // The current owner may no longer be a tracked contributor — keep them selectable.
  const options = item.assigneeLogin && !assignees.includes(item.assigneeLogin)
    ? [item.assigneeLogin, ...assignees]
    : assignees;

  async function toggleHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    setHistory("loading");
    try {
      const res = await fetch(`/api/recommendations/${item.id}/events`);
      const data = res.ok ? ((await res.json()) as { events: RecEvent[] }) : { events: [] };
      setHistory(data.events);
    } catch {
      setHistory([]);
    }
  }

  const due = dueLabel(item);

  return (
    <div
      aria-busy={saving}
      className="rounded-xl border bg-slate-900/40 p-4"
      style={{ borderLeftWidth: 3, borderLeftColor: item.overdue ? "#f97316" : STATUS_ACCENT[item.status] }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-white">{item.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-slate-500">
            <span className="text-slate-400">{item.repo}</span>
            <span>· {item.dimId} {item.dimLabel}</span>
            <span>· impact {item.impact}</span>
            <span>· effort {item.effort}</span>
          </div>
        </div>
        {due && (
          <span className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] ${item.overdue ? "bg-orange-500/10 text-orange-300" : "text-slate-400"}`}>
            {due}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
          status
          <select
            value={item.status}
            disabled={saving}
            onChange={(e) => onPatch(item.id, { status: e.target.value })}
            aria-label="Status"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-accent disabled:opacity-50"
            style={{ color: STATUS_ACCENT[item.status] }}
          >
            {REC_STATUSES.map((s) => (
              <option key={s} value={s} className="text-slate-200">
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
          owner
          <select
            value={item.assigneeLogin ?? ""}
            disabled={saving}
            onChange={(e) => onPatch(item.id, { assigneeLogin: e.target.value || null })}
            aria-label="Owner"
            className="max-w-[10rem] rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">Unassigned</option>
            {options.map((login) => (
              <option key={login} value={login}>
                @{login}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
          due
          <input
            type="date"
            value={item.targetDate ?? ""}
            disabled={saving}
            onChange={(e) => onPatch(item.id, { targetDate: e.target.value || null })}
            aria-label="Due date"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 outline-none focus:border-accent disabled:opacity-50"
          />
        </label>

        <button
          onClick={toggleHistory}
          className="ml-auto rounded-md border border-slate-700 px-2 py-1 font-mono text-[11px] text-slate-400 transition hover:text-white"
        >
          {history ? "Hide history" : "History"}
        </button>
        {saving && <span className="font-mono text-[11px] text-slate-500">saving…</span>}
      </div>

      {error && <p className="mt-2 text-xs text-orange-300">{error}</p>}

      {history && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          {history === "loading" ? (
            <p className="font-mono text-[11px] text-slate-500">Loading history…</p>
          ) : history.length === 0 ? (
            <p className="font-mono text-[11px] text-slate-500">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {history.map((ev) => (
                <li key={ev.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-400">
                  <span className="font-mono text-[10px] text-slate-600">{new Date(ev.at).toLocaleString()}</span>
                  <span className="text-slate-300">{ev.actor ? `@${ev.actor}` : "system"}</span>
                  <span>
                    set {EVENT_LABEL[ev.kind] ?? ev.kind} {eventValue(ev.kind, ev.from)} → <span className="text-slate-200">{eventValue(ev.kind, ev.to)}</span>
                  </span>
                  {ev.note && <span className="text-slate-500">“{ev.note}”</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
