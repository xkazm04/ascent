"use client";

// WAR-1/2: the goal the wall rallies around — target meter, pace chip, deadline countdown, and
// movement since the campaign kicked off. Extracted from LiveWarRoomHeader.tsx (300-LOC rule);
// pure relocation, behaviour unchanged.

import Link from "next/link";
import { Meter } from "@/components/org/shared/ui";
import { PaceChip, goalBasisMarker, goalMeterAriaLabel, type GoalProgressView } from "@/components/org/shared/goalView";
import { scoreHex } from "@/lib/ui";
import { DIRECTION_TONE, deltaHex, signedDelta, toneFor } from "@/components/ui";
import { orgTabHref } from "@/lib/org/orgTabs";

/** An attained goal is not a score — it is a reached target, so it takes the brand success token
 *  rather than a hand-picked emerald. Below attainment the meter keeps the score ramp. */
export const goalMeterColor = (goal: GoalProgressView) => (goal.achieved ? "var(--color-success)" : scoreHex(goal.current));

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
  const basisMarker = goalBasisMarker(goal);
  return (
    <div className="mt-4 rounded-2xl border border-divider bg-surface-strong/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-mono-sm uppercase tracking-widest text-accent">Goal</span>
          <span className="font-medium text-white">{goal.label}</span>
          <PaceChip pace={goal.pace} />
        </div>
        <Link href={orgTabHref(slug, "executive")} className="type-mono-sm text-accent hover:text-white">
          briefing →
        </Link>
      </div>
      {/* This wall is PROJECTED: nobody hovers a tooltip and nobody reads the aria label off a
          screen reader, so a goal that can only report attainment says so in VISIBLE text below —
          the aria label carries the same wording for the authenticated in-browser reader. */}
      <Meter
        className="mt-2.5"
        value={goal.current}
        threshold={goal.target}
        color={goalMeterColor(goal)}
        ariaLabel={goalMeterAriaLabel(goal)}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 type-mono-sm text-slate-400">
        <span>
          {goal.metricLabel} {goal.current}/{goal.target}
          {basisMarker ? <span className="text-slate-500"> · {basisMarker}</span> : null}
          {goal.achieved ? " · reached 🎉" : ` · ${toGoal} to goal`}
        </span>
        {campaignDelta != null && (
          // The brand direction triad, not a third local copy of it — same noise band the headline
          // strip and the movers ticker now read from, so one wall never shows two verdicts on +1.
          <span style={{ color: deltaHex(campaignDelta) }}>
            <span aria-hidden>{DIRECTION_TONE[toneFor(campaignDelta)].arrow}</span> {signedDelta(campaignDelta)} since kickoff
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
