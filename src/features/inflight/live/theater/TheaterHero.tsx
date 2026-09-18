// THE PLACEHOLDER HERO — an honest, readable grid of the lanes at work, until the prototype round
// picks the real hero (theaterHeroSlot.ts). Each card: repo, phase in words, how long in that phase,
// a thin elapsed-vs-deadline bar, files touched and the diff so far.
//
// No motion at all, on purpose: ambient motion may imply PRESENCE, never PROGRESS (`motion/taste-
// budgets`), and every figure here is derived from `now`, which the shell freezes on a stale pulse —
// so the bars and timers stop exactly when the truth stops arriving.

import type { LanePulse } from "@/lib/local/runner-types";
import type { TheaterHeroProps } from "./theaterHeroSlot";
import { fmtDuration, repoShort, since, toMs } from "./theaterFormat";
import { lanePhaseWords } from "./theaterHeaderModel";

export type { TheaterHeroProps };

/** 0..1 of the lane's time budget used, or null when either end is unknown. */
export function deadlineFraction(lane: LanePulse, now: number): number | null {
  const start = toMs(lane.startedAt);
  const end = toMs(lane.deadlineAt);
  if (start == null || end == null || end <= start) return null;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

function LaneCard({ lane, now }: { lane: LanePulse; now: number }) {
  const inPhase = since(lane.phaseSince, now);
  const frac = deadlineFraction(lane, now);
  const touched = new Set([...lane.filesRead, ...lane.filesEdited]).size;
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface/40 p-5" data-lane={lane.laneId}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate type-heading font-semibold text-white">{repoShort(lane.repo)}</p>
        {lane.planStep ? (
          <p className="shrink-0 font-mono type-mono-sm text-slate-400">
            step {lane.planStep.index}/{lane.planStep.total}
          </p>
        ) : null}
      </div>
      <p className="type-title text-slate-200">
        {lanePhaseWords(lane, now)}
        {inPhase != null ? <span className="text-slate-400"> · {fmtDuration(inPhase)}</span> : null}
      </p>
      {frac != null ? (
        <div
          role="meter"
          aria-label={`${repoShort(lane.repo)}: time used of the lane's deadline`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(frac * 100)}
          className="h-1 w-full overflow-hidden rounded-full bg-slate-800"
        >
          <div className={`h-full rounded-full ${frac >= 0.8 ? "bg-amber-400" : "bg-accent/70"}`} style={{ width: `${frac * 100}%` }} />
        </div>
      ) : null}
      <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono type-mono-sm text-slate-400">
        <span>
          <span className="tabular-nums text-slate-200">{touched}</span> {touched === 1 ? "file" : "files"} touched
        </span>
        {lane.diffStat ? (
          <span className="tabular-nums">
            <span className="text-success-soft">+{lane.diffStat.plus}</span> <span className="text-danger">−{lane.diffStat.minus}</span> in{" "}
            {lane.diffStat.files}
          </span>
        ) : null}
      </p>
    </li>
  );
}

export function TheaterHero({ pulse, now }: TheaterHeroProps) {
  const lanes = pulse.lanes.filter((l) => l.phase !== "done").sort((a, b) => a.repo.localeCompare(b.repo));
  return (
    <section aria-label="Lanes at work" data-hero-slot="placeholder" className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-6">
      {lanes.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {lanes.map((l) => (
            <LaneCard key={l.laneId} lane={l} now={now} />
          ))}
        </ul>
      ) : (
        <p className="type-title text-slate-400">No lane is working right now.</p>
      )}
      {pulse.waiting.length ? (
        <p className="type-body text-slate-400">
          Waiting for a slot: <span className="text-slate-200">{pulse.waiting.map(repoShort).join(", ")}</span>
        </p>
      ) : null}
    </section>
  );
}
