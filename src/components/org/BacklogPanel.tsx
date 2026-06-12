"use client";

import { useCallback, useState } from "react";
import { Card } from "@/components/org/ui";
import type { BacklogItem, BacklogDueGroup, OrgBacklog } from "@/lib/db";
import { OwnerHeader, SummaryStrip } from "@/components/org/BacklogSummary";
import { ItemRow } from "@/components/org/BacklogItemRow";

/**
 * The org-wide recommendation backlog: a stat strip, a By owner / By due date toggle, and inline
 * controls to set each item's status, owner, and due date. Every change PATCHes the recommendation
 * (recording an activity-timeline event) and re-reads the backlog so the groupings and counts stay
 * consistent. Each item exposes its history on demand.
 */
export function BacklogPanel({ slug, initial }: { slug: string; initial: OrgBacklog }) {
  const [backlog, setBacklog] = useState<OrgBacklog>(initial);
  const [view, setView] = useState<"owner" | "due" | "points">("owner");
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

  // "Projected points" is a flat cross-repo ranking on the engine-true ROI each item carries
  // (projectedPoints — overall-score upside of closing the gap), so cross-repo leverage the
  // per-repo report can't show sorts to the top. Items without a projection (pre-dimension
  // scans) sink below scored ones; impact words break ties.
  const IMPACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const byPoints = backlog.byOwner
    .flatMap((g) => g.items)
    .sort(
      (a, b) =>
        (b.projectedPoints ?? -1) - (a.projectedPoints ?? -1) ||
        (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0) ||
        b.lastActivityAt.localeCompare(a.lastActivityAt),
    );

  const groups: { key: string; header: React.ReactNode; items: BacklogItem[] }[] =
    view === "owner"
      ? backlog.byOwner.map((g) => ({ key: g.login ?? "__unassigned", header: <OwnerHeader group={g} />, items: g.items }))
      : view === "due"
        ? backlog.byDue.map((g: BacklogDueGroup) => ({
            key: g.bucket,
            header: (
              <span className={`text-base font-semibold ${g.bucket === "overdue" ? "text-orange-300" : "text-white"}`}>
                {g.label} <span className="font-mono text-sm text-slate-500">· {g.items.length}</span>
              </span>
            ),
            items: g.items,
          }))
        : [
            {
              key: "__points",
              header: (
                <span className="text-base font-semibold text-white">
                  Highest projected gain first{" "}
                  <span className="font-mono text-sm text-slate-500">
                    · engine points if the gap is fully closed
                  </span>
                </span>
              ),
              items: byPoints,
            },
          ];

  return (
    <div className="space-y-5">
      <SummaryStrip b={backlog} />

      <div className="flex items-center gap-1 text-sm">
        <span className="mr-1 font-mono text-sm uppercase tracking-widest text-slate-500">Group by</span>
        {(["owner", "due", "points"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-lg border px-3 py-1.5 font-medium transition ${
              view === v ? "border-accent/50 bg-accent/10 text-white" : "border-slate-700 text-slate-400 hover:text-white"
            }`}
          >
            {v === "owner" ? "Owner" : v === "due" ? "Due date" : "Projected points"}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <Card>
          <p className="text-base text-slate-500">
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
