"use client";

// WAR-1/2: the goal the wall rallies around — target meter, pace chip, deadline countdown, and
// movement since the campaign kicked off. Extracted from LiveWarRoomHeader.tsx (300-LOC rule);
// pure relocation, behaviour unchanged.

import Link from "next/link";
import { Meter } from "@/components/org/shared/ui";
import { PaceChip, type GoalProgressView } from "@/components/org/shared/goalView";
import { scoreHex } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";

/** Days until a YYYY-MM-DD deadline (negative = past, 0 = due today). null when no date.
 *
 *  DECISION (live-war-room 07-16 #2): the deadline is INCLUSIVE and ends at END OF DAY in the
 *  VIEWER'S LOCAL timezone. `Date.parse("YYYY-MM-DD")` is UTC midnight at the *start* of the day,
 *  so the old diff flipped to "past deadline" up to a day early for viewers west of UTC (and a day
 *  late east of it) — on a projected wall, exactly on review day. We parse the date parts into a
 *  LOCAL instant at midnight AFTER the deadline day, so the whole deadline day reads "0d to
 *  deadline" everywhere, and "past" starts the local day after.
 *
 *  Pinned by LiveWarRoomHeader.test.ts, which mirrors this helper verbatim. */
export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  // Local midnight AFTER the deadline day = the instant the (inclusive) deadline lapses.
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000) - 1;
}

export function GoalBanner({
  slug,
  goal,
  campaignDelta = null,
}: {
  slug: string;
  goal: GoalProgressView;
  campaignDelta?: number | null;
}) {
  const countdown = daysUntil(goal.targetDate);
  const toGoal = Math.max(0, goal.target - goal.current);
  return (
    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm uppercase tracking-widest text-accent">Goal</span>
          <span className="font-medium text-white">{goal.label}</span>
          <PaceChip pace={goal.pace} />
        </div>
        <Link href={orgTabHref(slug, "executive")} className="font-mono text-sm text-accent hover:text-white">
          briefing →
        </Link>
      </div>
      <Meter
        className="mt-2.5"
        value={goal.current}
        threshold={goal.target}
        color={goal.achieved ? "#34d399" : scoreHex(goal.current)}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm text-slate-400">
        <span>
          {goal.metricLabel} {goal.current}/{goal.target}
          {goal.achieved ? " · reached 🎉" : ` · ${toGoal} to goal`}
        </span>
        {campaignDelta != null && (
          <span className={campaignDelta > 0 ? "text-emerald-300" : campaignDelta < 0 ? "text-orange-300" : "text-slate-500"}>
            {campaignDelta > 0 ? "+" : ""}
            {campaignDelta} since kickoff
          </span>
        )}
        {countdown != null && (
          <span className={countdown < 0 ? "text-orange-300" : countdown <= 7 ? "text-amber-300" : "text-slate-400"}>
            {countdown < 0 ? `${-countdown}d past deadline` : `${countdown}d to deadline`}
          </span>
        )}
      </div>
    </div>
  );
}
