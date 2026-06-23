// Shared, server-safe presentation for a maturity goal: the progress meter, the pace verdict
// (reached / on-pace / behind / tracking), the trend-derived ETA, and the "what must move" repo
// breakdown that links into the per-repo gap analysis and the org practices. Used read-only on the
// overview (compact) and inside the interactive GoalsPanel on the Plan tab (with a remove control).
import Link from "next/link";
import { Meter } from "@/components/org/ui";
import { humanizeDays, type GoalPace, type Trajectory } from "@/lib/maturity/forecast";
import { scoreHex } from "@/lib/ui";
import type { GoalLaggard } from "@/lib/db/plan";

/** The serializable shape the goal UI renders — mirrors GoalProgress from src/lib/db/plan.ts. */
export interface GoalProgressView {
  id: string;
  label: string;
  metric: string;
  metricLabel: string;
  target: number;
  current: number;
  pct: number;
  achieved: boolean;
  status: string;
  /** When the goal first met its target (ISO), or null — drives the "Achieved" state. */
  achievedAt?: string | null;
  createdAt?: string;
  targetDate: string | null;
  pace: GoalPace;
  perWeek: number;
  trajectory: Trajectory;
  fitQuality: number;
  etaDays: number | null;
  etaDate: string | null;
  requiredPerWeek: number | null;
  laggards: GoalLaggard[];
  belowCount: number;
}

const PACE: Record<GoalPace, { label: string; color: string }> = {
  reached: { label: "Reached", color: "#34d399" },
  "on-pace": { label: "On pace", color: "#84cc16" },
  behind: { label: "Behind", color: "#f97316" },
  tracking: { label: "Tracking", color: "#94a3b8" },
};

export function PaceChip({ pace }: { pace: GoalPace }) {
  const p = PACE[pace];
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-0.5 font-mono text-sm uppercase tracking-widest"
      style={{ borderColor: `${p.color}66`, color: p.color }}
    >
      {p.label}
    </span>
  );
}

const rate = (n: number) => `${n > 0 ? "+" : ""}${n}/wk`;

/** One-line, leader-facing read of a goal's pace — the detail under the progress meter. */
function readout(g: GoalProgressView): string {
  if (g.pace === "reached") return `Target met — holding at or above ${g.target}.`;

  const eta = g.etaDate ? `reaches ${g.target} ${humanizeDays(g.etaDays ?? 0)} (${g.etaDate})` : null;

  if (g.pace === "on-pace") {
    return `On pace — ${eta}${g.targetDate ? `, ahead of ${g.targetDate}` : ""}.`;
  }
  if (g.pace === "behind") {
    const need = g.requiredPerWeek != null ? ` — needs ${rate(g.requiredPerWeek)} (now ${rate(g.perWeek)})` : "";
    if (eta) return `Behind — at ${rate(g.perWeek)}, ${eta}, past the ${g.targetDate} deadline${need}.`;
    return `Behind — flat at ${g.current} on a ${rate(g.perWeek)} trend, target not reached at this pace${need}.`;
  }
  // tracking: no deadline, or not enough trend to judge a pace yet.
  if (eta) return `On track — ${eta}.`;
  if (g.fitQuality === 0 && g.perWeek === 0) {
    return g.requiredPerWeek != null
      ? `Not enough trend yet — needs ${rate(g.requiredPerWeek)} to reach ${g.target} by ${g.targetDate}.`
      : `Not enough trend yet — scan over time to project an ETA.`;
  }
  return `Holding near ${g.current} on a ${rate(g.perWeek)} trend — no ETA to ${g.target} at this pace.`;
}

/** An initiative linked to a goal — the tracked work advancing it (GOAL-6 cross-render). */
export interface LinkedInitiative {
  id: string;
  title: string;
  status: string;
}

const INIT_STATUS_LABEL: Record<string, string> = {
  open: "open",
  in_progress: "in progress",
  done: "done",
  dismissed: "dismissed",
};

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
  const pace = PACE[goal.pace];
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
      <p className="mt-2 font-mono text-sm leading-relaxed" style={{ color: pace.color }}>
        {readout(goal)}
      </p>

      {shown.length > 0 && (
        <div className="mt-3 border-t border-slate-800/70 pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
              Must move · {goal.belowCount} repo{goal.belowCount === 1 ? "" : "s"} below {goal.target}
            </span>
            <Link href={`/org/${slug}/practices`} className="shrink-0 font-mono text-sm text-accent hover:text-white">
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
