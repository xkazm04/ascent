"use client";

// The drawer's scrolling body in the SETUP channel — the progress bar, the promoted next task, the
// setup rail and the teach rail. Extracted VERBATIM out of TourChecklist for the 300-LOC cap: pure
// relocation, same markup, same order, same conditions. The orchestrator still owns every decision
// (which items exist, which is active, what a click means); this file only lays them out.

import { orgTabHref } from "@/lib/org/orgTabs";
import type { DrawerItem } from "./tasks";
import { TourNextTask } from "./TourNextTask";
import { TourProgress, TourTaskRow, rowState } from "./TourTaskRow";

function Rail({
  label,
  rows,
  active,
  onShow,
}: {
  label: string;
  rows: DrawerItem[];
  active: DrawerItem | null;
  onShow: (item: DrawerItem) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-widest text-slate-500">{label}</div>
      <ul className="mt-2 space-y-1">
        {rows.map((item) => (
          <TourTaskRow
            key={item.key}
            item={item}
            state={rowState(item, active?.key === item.key)}
            onSelect={() => onShow(item)}
          />
        ))}
      </ul>
    </div>
  );
}

export function TourChecklistBody({
  slug,
  items,
  next,
  active,
  progress,
  loaded,
  onShow,
}: {
  slug: string;
  items: DrawerItem[];
  /** The one promoted task (companion posture only), or null. */
  next: DrawerItem | null;
  active: DrawerItem | null;
  progress: { done: number; total: number };
  loaded: boolean;
  onShow: (item: DrawerItem) => void;
}) {
  const tasks = items.filter((i) => i.kind === "task");
  const teach = items.filter((i) => i.kind === "teach");
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
      {progress.total > 0 && <TourProgress done={progress.done} total={progress.total} />}

      {next && (
        <TourNextTask item={next} href={orgTabHref(slug, next.tour.tab)} onShowMe={() => onShow(next)} />
      )}

      <Rail label="Setup" rows={tasks} active={active} onShow={onShow} />
      <Rail label="Learn the dashboard" rows={teach} active={active} onShow={onShow} />

      {loaded && items.length === 0 && (
        <p className="text-sm leading-relaxed text-slate-400">
          Nothing to guide here yet: this workspace has no setup steps to derive.
        </p>
      )}
    </div>
  );
}
