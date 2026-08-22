"use client";

// ONE lane's outcome, as a ledger row. Everything here comes from the run detail's own `diffScans`
// output — the same diff the repo's compare view renders — so the cockpit can never claim a
// dimension moved that the report would not also show moving.
//
// A lane with no `before` (a first-ever scan) shows its work — commits, closed gaps — and explicitly
// says the movement is unmeasured, rather than printing a +0 that would read as "nothing happened".

import { deltaHex, fmtDelta, Kicker } from "@/components/ui";
import { dimShort } from "@/lib/ui";
import type { LoopLaneOutcome } from "./loopTypes";

export function OutcomeRow({ outcome }: { outcome: LoopLaneOutcome }) {
  const { lane, before, after, diff } = outcome;
  const moved = (diff?.dimensions ?? []).filter((d) => d.delta != null && d.delta !== 0);
  const lift = before && after ? after.overallScore - before.overallScore : null;

  return (
    <li className="bg-ink px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate font-mono text-sm text-slate-200" title={lane.repoFullName}>
          {lane.repoFullName}
        </span>
        <span className="shrink-0 font-mono text-sm tabular-nums">
          {before && after ? (
            <>
              <span className="text-slate-500">
                {before.overallScore} → {after.overallScore}
              </span>
              <span className="ml-2" style={{ color: deltaHex(lift ?? 0) }}>
                {fmtDelta(lift ?? 0)}
              </span>
            </>
          ) : (
            <span className="text-slate-600">not measured</span>
          )}
        </span>
      </div>

      {moved.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {moved.map((d) => (
            <li key={d.id} className="font-mono text-xs tabular-nums">
              <span className="text-slate-500">{dimShort(d.id)}</span>{" "}
              <span style={{ color: deltaHex(d.delta ?? 0) }}>{fmtDelta(d.delta ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1.5 font-mono text-xs tabular-nums text-slate-500">
        {diff ? `${diff.closedGapCount} gaps closed` : "no diff"} · {outcome.closedFollowUpIds.length} follow-ups closed ·{" "}
        {outcome.commits} commits
        {lane.branch && <span className="ml-2 text-slate-600">{lane.branch}</span>}
      </p>

      {(diff?.movements ?? []).slice(0, 2).map((line) => (
        <p key={line} className="mt-1 text-xs leading-relaxed text-slate-400">
          {line}
        </p>
      ))}

      {lane.phase === "error" && lane.error && <p className="mt-1 font-mono text-xs text-danger">{lane.error}</p>}
    </li>
  );
}

/** The three-way tally the outcome header leads with. */
export function OutcomeTotals({ lift, improved, flat, regressed }: { lift: number | null; improved: number; flat: number; regressed: number }) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="font-mono text-2xl tabular-nums" style={{ color: deltaHex(lift ?? 0) }}>
        {lift == null ? "—" : fmtDelta(lift)}
      </span>
      <Kicker tone="muted">total lift</Kicker>
      <span className="font-mono text-xs tabular-nums text-slate-500">
        {improved} improved · {flat} flat · {regressed} regressed
      </span>
    </div>
  );
}
