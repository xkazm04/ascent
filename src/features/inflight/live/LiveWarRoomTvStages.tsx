"use client";

// The four Dynamic-UI TV stages — one lifecycle-relevant panel each, rendered big for a wall. Each
// reuses the wall's existing pieces (Leaderboard, HeadlineStrip, MoversTicker, ship-loop atoms) so
// TV mode is a re-LAYOUT of the same live data, not a second copy of it. The orchestrator
// (LiveWarRoomTv) owns the state machine + rotation and hands each stage this shared data bundle.

import Link from "next/link";
import { EFFORT_CLASS, IMPACT_CLASS, reportPermalink, scoreHex } from "@/lib/ui";
import { Kicker, deltaHex, fmtDelta } from "@/components/ui";
import { Meter } from "@/components/org/shared/ui";
import { PaceChip, goalBasisMarker, goalMeterAriaLabel, type GoalProgressView } from "@/components/org/shared/goalView";
import { Leaderboard } from "@/features/inflight/live/LiveWarRoomLeaderboard";
import { MoversTicker } from "@/features/inflight/live/LiveWarRoomPanels";
import { HeadlineStrip } from "@/features/inflight/live/LiveWarRoomStat";
import { FlightRowDetail, LandedRowDetail, dimShort, opsImpact, type OpsView } from "@/features/inflight/live/liveWarRoomOpsShared";
import { shortName, type LiveRepo, type Mover } from "@/components/org/shared/liveWarRoomShared";

export interface TvStageData {
  slug: string;
  stats: { avgOverall: number | null; avgAdoption: number | null; avgRigor: number | null; aiNative: number; scored: number; total: number; postureCounts: Record<string, number> };
  leaderboard: LiveRepo[];
  ticker: Mover[];
  pct: number;
  progress: { done: number; total: number; current: string };
  deltas: { overall: number; adoption: number; rigor: number } | null;
  trend?: { date: string; avg: number }[];
  goal: GoalProgressView | null;
  ops: OpsView;
}

/** Big net-impact readout — the loop's cumulative achievement, the standing view's headline. */
function NetImpact({ ops }: { ops: OpsView }) {
  const imp = opsImpact(ops.state.landed);
  return (
    <div className="rounded-2xl border border-divider bg-surface-strong/30 p-5">
      <Kicker tone="muted">Net impact shipped</Kicker>
      <div className="mt-1 font-mono text-4xl font-bold tabular-nums" style={{ color: deltaHex(imp.netOverall) }}>
        {fmtDelta(imp.netOverall)}
      </div>
      <p className="mt-1 font-mono text-base text-slate-500">
        {imp.verified} PRs verified · {imp.dimsLifted} dims lifted{imp.awaiting > 0 ? ` · ${imp.awaiting} awaiting` : ""}
      </p>
    </div>
  );
}

export function TvStanding({ data }: { data: TvStageData }) {
  const { goal } = data;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Leaderboard repos={data.leaderboard} slug={data.slug} className="lg:col-span-2" />
      <div className="flex flex-col gap-5">
        {goal && (
          <div className="rounded-2xl border border-divider bg-surface-strong/30 p-5">
            <div className="flex items-center justify-between gap-2">
              <Kicker tone="muted">Goal</Kicker>
              <PaceChip pace={goal.pace} />
            </div>
            <p className="mt-1 text-lg font-medium text-white">{goal.label}</p>
            <div className="mt-2 font-mono text-4xl font-bold tabular-nums" style={{ color: goal.achieved ? "#34d399" : scoreHex(goal.current) }}>
              {goal.current}
              <span className="text-xl text-slate-500">/{goal.target}</span>
            </div>
            {/* TV mode is a wall in a room: no hover, no screen reader, read from across it. So the
                attainment basis is VISIBLE text under the bar (the aria label repeats it for the
                browser reader) — a goal set before baselines existed opens near-full, and unlabelled
                next to a progress goal that opens empty it invites a comparison neither supports. */}
            <Meter className="mt-2" value={goal.current} threshold={goal.target} color={goal.achieved ? "#34d399" : scoreHex(goal.current)} ariaLabel={goalMeterAriaLabel(goal)} />
            {goalBasisMarker(goal) && (
              <p className="mt-1.5 font-mono text-base text-slate-500">{goalBasisMarker(goal)}</p>
            )}
          </div>
        )}
        <NetImpact ops={data.ops} />
      </div>
    </div>
  );
}

export function TvScanning({ data }: { data: TvStageData }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <div>
          <div className="flex items-baseline justify-between">
            <Kicker>Scanning the fleet</Kicker>
            <span className="font-mono text-lg tabular-nums text-slate-300">
              {data.progress.done}/{data.progress.total}
            </span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-accent transition-all motion-reduce:transition-none" style={{ width: `${Math.max(3, data.pct)}%` }} />
          </div>
          {data.progress.current && (
            <p className="mt-2 truncate font-mono text-base text-slate-500" suppressHydrationWarning>
              scanning {shortName(data.progress.current)}…
            </p>
          )}
        </div>
        {/* Dynamic TV mode is fullscreen + wake-locked: the surface has declared itself a wall, so
            the strip takes the wall type scale (G6-01). `running` keeps its announcer quiet while
            the header's progress count is speaking. */}
        <HeadlineStrip stats={data.stats} deltas={data.deltas} trend={data.trend} scale="wall" running />
      </div>
      <MoversTicker ticker={data.ticker} running />
    </div>
  );
}

export function TvDecide({ data }: { data: TvStageData }) {
  const { ops } = data;
  const next = ops.state.triage[0];
  if (!next) {
    return <p className="py-10 text-center text-lg text-slate-400">Radar clear. Every direction triaged.</p>;
  }
  const busy = ops.busy[next.recommendationId];
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-accent/30 bg-accent/5 p-6">
      <div className="flex items-center justify-between">
        <Kicker>Next decision</Kicker>
        <span className="font-mono text-base text-slate-500">{ops.state.counts.triage} queued</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-base">
        <Link href={reportPermalink(next.repoFullName)} className="text-slate-100 hover:text-accent">
          {next.repoName}
        </Link>
        <span className="text-slate-500">
          {next.dimId} · {dimShort(next.dimId)}
        </span>
        <span className={`rounded border px-1.5 text-sm ${IMPACT_CLASS[next.impact] ?? IMPACT_CLASS.low}`}>{next.impact} impact</span>
        <span className={`rounded border px-1.5 text-sm ${EFFORT_CLASS[next.effort] ?? EFFORT_CLASS.low}`}>{next.effort} effort</span>
      </div>
      <p className="mt-3 text-2xl leading-snug text-white">{next.title}</p>
      {next.rationale && <p className="mt-2 text-lg text-slate-400">{next.rationale}</p>}
      <p className="mt-2 font-mono text-sm text-slate-600">seeds: {next.practiceLabel}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => ops.accept(next.recommendationId)}
          disabled={Boolean(busy)}
          className="focus-ring rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 font-mono text-base font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
        >
          {busy === "accept" ? "Opening PR…" : "✓ Open PR & watch it merge"}
        </button>
        <button
          type="button"
          onClick={() => ops.reject(next.recommendationId)}
          disabled={Boolean(busy)}
          className="focus-ring rounded-md border border-slate-700 px-4 py-2 font-mono text-base text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-50"
        >
          {busy === "reject" ? "…" : "✕ Dismiss"}
        </button>
      </div>
    </div>
  );
}

export function TvInflight({ data }: { data: TvStageData }) {
  const { ops } = data;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-2xl border border-divider bg-surface-strong/30 p-5">
        <div className="flex items-baseline justify-between">
          <Kicker>PRs in flight</Kicker>
          <span className="font-mono text-base tabular-nums text-slate-300">{ops.state.counts.inFlight}</span>
        </div>
        <div className="mt-3 space-y-2.5">
          {ops.state.inFlight.length === 0 ? (
            <p className="text-lg text-slate-400">No PRs in flight. Accept a direction to open one.</p>
          ) : (
            ops.state.inFlight.map((p) => <FlightRowDetail key={p.id} item={p} />)
          )}
        </div>
      </div>
      {ops.state.landed.length > 0 && (
        <div className="rounded-2xl border border-divider bg-surface-strong/30 p-5">
          <Kicker tone="muted">Recently landed</Kicker>
          <div className="mt-2.5 space-y-2">
            {ops.state.landed.slice(0, 5).map((p) => (
              <LandedRowDetail key={p.id} item={p} onVerify={p.state === "merged" ? () => ops.onVerify([p.repoFullName]) : undefined} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
