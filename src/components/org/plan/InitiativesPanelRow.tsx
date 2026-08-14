"use client";

// One tracked initiative row (status, accountability inputs, link to its starter practice) — split
// out of InitiativesPanel.tsx (200-LOC cap). Pure display + inline edits; state lives in the parent's
// useInitiativesPanel hook.

import Link from "next/link";
import { REC_STATUSES } from "@/lib/types";
import { Meter } from "@/components/org/shared/ui";
import { STATUS_LABEL } from "@/components/org/shared/backlogShared";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { GoalOption, InitiativeView } from "@/components/org/plan/InitiativesPanelTypes";

export function InitiativesPanelRow({
  slug,
  i,
  goals,
  onPatch,
}: {
  slug: string;
  i: InitiativeView;
  goals: GoalOption[];
  onPatch: (id: string, body: Partial<Pick<InitiativeView, "status" | "assigneeLogin" | "targetDate" | "goalId">>) => void;
}) {
  const pct = i.progress.total ? Math.round((i.progress.atTarget / i.progress.total) * 100) : 0;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* min-w-0 (above) lets the block title truncate to one line; full title on hover. */}
          <div className="truncate text-base font-medium text-white" title={i.title}>{i.title}</div>
          <div className="font-mono text-sm text-slate-500">
            {i.dimId} {i.dimLabel} · target {i.targetScore} · {i.progress.atTarget}/{i.progress.total} repos there
            {i.playbookLabel && <span className="text-slate-600"> · from playbook “{i.playbookLabel}”</span>}
          </div>
        </div>
        <select
          value={i.status}
          onChange={(e) => onPatch(i.id, { status: e.target.value })}
          aria-label={`Status for ${i.title}`}
          className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200"
        >
          {REC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <Meter className="mt-2" size="sm" value={pct} color="#34d399" />

      {/* Accountability row: owner · due date · the goal this advances. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-800/70 pt-3">
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          <span className="text-slate-600">@</span>
          <input
            defaultValue={i.assigneeLogin ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (i.assigneeLogin ?? "")) onPatch(i.id, { assigneeLogin: v || null });
            }}
            placeholder="assignee"
            aria-label={`Assignee GitHub login for ${i.title}`}
            className="w-28 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-600"
          />
        </label>
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          due
          <input
            type="date"
            value={i.targetDate ?? ""}
            onChange={(e) => onPatch(i.id, { targetDate: e.target.value || null })}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200"
          />
        </label>
        {goals.length > 0 && (
          <label className="flex min-w-0 items-center gap-1.5 font-mono text-sm text-slate-500">
            goal
            <select
              value={i.goalId ?? ""}
              onChange={(e) => onPatch(i.id, { goalId: e.target.value || null })}
              className="max-w-[12rem] truncate rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200"
            >
              <option value="">(none)</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* GOAL-3: jump to the dimension's reusable practice (its leak-free starter +
            "generate the artifact, open a draft PR" action) — turning the tracked target
            into a concrete first step. */}
        {i.practiceId && (
          <Link
            href={`${orgTabHref(slug, "practices")}#practice-${i.practiceId}`}
            className="font-mono text-sm text-accent hover:text-white"
            title="Open the reusable practice + starter PR for this dimension"
          >
            starter shape →
          </Link>
        )}
      </div>
    </div>
  );
}
