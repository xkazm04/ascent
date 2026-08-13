// Shared, server-safe presentation for a maturity goal: the progress meter, the pace verdict
// (reached / on-pace / behind / tracking), the trend-derived ETA, and the "what must move" repo
// breakdown that links into the per-repo gap analysis and the org practices. Used read-only on the
// overview (compact) and inside the interactive GoalsPanel on the Plan tab (with a remove control).
//
// Types live in GoalViewTypes.ts, pure pace/readout logic in goalViewLogic.ts — both re-exported below
// so every existing import of "@/components/org/shared/goalView" keeps resolving unchanged.
import Link from "next/link";
import { Meter } from "@/components/org/shared/ui";
import { GoalTrend } from "@/components/org/shared/GoalTrend";
import { scoreHex } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { GOAL_PACE_TONE, readout, INIT_STATUS_LABEL } from "./goalViewLogic";
import type { GoalProgressView, LinkedInitiative } from "./GoalViewTypes";

export type { GoalProgressView, LinkedInitiative } from "./GoalViewTypes";
export { GOAL_PACE_TONE } from "./goalViewLogic";

export function PaceChip({ pace }: { pace: GoalProgressView["pace"] }) {
  const p = GOAL_PACE_TONE[pace];
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-0.5 font-mono text-sm uppercase tracking-widest"
      style={{ borderColor: `${p.color}66`, color: p.color }}
    >
      {p.label}
    </span>
  );
}

/**
 * A single goal: label + pace chip, a meter (current score with the target marked), the pace
 * read-out, and the repos that must move. `compact` trims the laggard list for the overview;
 * `action` is an optional control slot (e.g. a remove button) shown in the header.
 * `initiatives` are the tracked programs of work linked to this goal — the plan advancing it.
 */
export function GoalCard({
  goal,
  slug,
  compact = false,
  action,
  initiatives = [],
}: {
  goal: GoalProgressView;
  slug: string;
  compact?: boolean;
  action?: React.ReactNode;
  initiatives?: LinkedInitiative[];
}) {
  const pace = GOAL_PACE_TONE[goal.pace];
  const shown = goal.laggards.slice(0, compact ? 3 : 8);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-medium text-white">{goal.label}</span>
            {goal.status === "achieved" ? (
              <span
                className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-sm uppercase tracking-widest text-emerald-300"
                title={goal.achievedAt ? `Reached on ${goal.achievedAt.slice(0, 10)}` : "Target met"}
              >
                🎉 Achieved{goal.achievedAt ? ` · ${goal.achievedAt.slice(0, 10)}` : ""}
              </span>
            ) : (
              <PaceChip pace={goal.pace} />
            )}
          </div>
          <div className="mt-0.5 font-mono text-sm text-slate-500">
            {goal.metricLabel} · {goal.current}/{goal.target}
            {goal.targetDate && <span className="text-slate-600"> · by {goal.targetDate}</span>}
          </div>
        </div>
        {action}
      </div>

      <Meter
        className="mt-2.5"
        value={goal.current}
        threshold={goal.target}
        color={goal.achieved ? "#34d399" : scoreHex(goal.current)}
      />
      {/* The trajectory toward the target — the meter shows standing, this shows TRAVEL (the pct
          field's documented blind spot). Same series the pace verdict was fitted on. */}
      {(goal.series?.length ?? 0) >= 2 && (
        <GoalTrend
          className="mt-2"
          series={goal.series!}
          target={goal.target}
          color={goal.achieved ? "#34d399" : scoreHex(goal.current)}
        />
      )}
      <p className="mt-2 font-mono text-sm leading-relaxed" style={{ color: pace.color }}>
        {readout(goal)}
      </p>

      {shown.length > 0 && (
        <div className="mt-3 border-t border-slate-800/70 pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
              Must move · {goal.belowCount} repo{goal.belowCount === 1 ? "" : "s"} below {goal.target}
            </span>
            <Link href={orgTabHref(slug, "practices")} className="shrink-0 font-mono text-sm text-accent hover:text-white">
              reuse a practice →
            </Link>
          </div>
          <ul className="mt-1.5 space-y-1">
            {shown.map((r) => (
              <li key={r.fullName} className="flex items-center justify-between gap-3 text-sm">
                <Link
                  href={`/report?repo=${encodeURIComponent(r.fullName)}`}
                  className="min-w-0 truncate font-mono text-sm text-slate-300 hover:text-accent"
                  title={`Open the gap analysis for ${r.fullName}`}
                >
                  {r.name}
                </Link>
                <span className="shrink-0 font-mono text-sm text-slate-500">
                  {r.value} <span className="text-orange-300/80">+{r.gap}</span>
                </span>
              </li>
            ))}
            {goal.belowCount > shown.length && (
              <li className="font-mono text-sm text-slate-600">+{goal.belowCount - shown.length} more</li>
            )}
          </ul>
        </div>
      )}

      {initiatives.length > 0 && (
        <div className="mt-3 border-t border-slate-800/70 pt-2.5">
          <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
            Advanced by · {initiatives.length} initiative{initiatives.length === 1 ? "" : "s"}
          </span>
          <ul className="mt-1.5 space-y-1">
            {initiatives.slice(0, compact ? 2 : 6).map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-slate-300">{it.title}</span>
                <span className="shrink-0 font-mono text-sm text-slate-500">{INIT_STATUS_LABEL[it.status] ?? it.status}</span>
              </li>
            ))}
            {initiatives.length > (compact ? 2 : 6) && (
              <li className="font-mono text-sm text-slate-600">+{initiatives.length - (compact ? 2 : 6)} more</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
