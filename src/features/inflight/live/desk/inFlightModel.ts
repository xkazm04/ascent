// 02 IN FLIGHT — the live pulse, read into the four answers (running? / now / today / needs you) and
// one row per lane with its six-step stage track. Pure; `useTheaterPulse` supplies the pulse.
//
// THE CLOCK is the server's: a lane's start and deadline are server instants, so "time used" is
// measured against `pulse.at` advanced by how long ago this browser received it — and FROZEN at
// `pulse.at` once the feed is stale, so a dead feed never keeps counting. The bar is time used against
// the lane's deadline, never work done; a lane with no deadline has no bar (no invented budget).

import { lanePhaseLabel, laneQuietForMs } from "@/lib/local/lane-phase";
import { armLabel } from "@/lib/local/arm";
import type { LanePhase, LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { dur, hm, plural, repoShort, toMs, usd } from "./deskFormat";

export const STAGES = ["plan", "read", "edit", "verify", "commit", "land"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_WORD: Record<Stage, string> = { plan: "PLAN", read: "READ", edit: "EDIT", verify: "CHECK", commit: "COMMIT", land: "LAND" };

const PHASE_STAGE: Partial<Record<LanePhase, Stage>> = {
  planning: "plan",
  baseline: "plan",
  "agent-reading": "read",
  "agent-editing": "edit",
  "agent-thinking": "edit",
  "agent-quiet": "edit",
  verifying: "verify",
  installing: "verify",
  committing: "commit",
  landing: "land",
  rescanning: "land",
};
const WORKING = new Set<LanePhase>(Object.keys(PHASE_STAGE) as LanePhase[]);

/** Index of the lane's stage on the track; -1 before it starts (queued), 6 once done. */
export function stageIndex(phase: LanePhase): number {
  const st = PHASE_STAGE[phase];
  if (st) return STAGES.indexOf(st);
  return phase === "done" ? STAGES.length : -1;
}

const PAUSE_WORDS: Record<string, string> = { "spend-ceiling": "spend ceiling", "session-limit": "session limit" };

export interface Answer {
  headline: string;
  sub: string | null;
  tone: "live" | "warn" | "muted" | "calm" | "danger";
}

export interface LaneRow {
  laneId: string;
  repo: string;
  cycle: number;
  stage: number;
  landing: boolean;
  phase: string;
  file: string | null;
  usedMs: number | null;
  budgetMs: number | null;
  frac: number | null;
  cost: string | null;
}

export interface FlightView {
  /** The server-clock instant the view is drawn at. */
  clock: number;
  running: Answer;
  now: Answer;
  today: { verified: number; landed: number; spend: string; ceiling: string | null; ratio: number | null };
  needs: Answer & { count: number };
  lanes: LaneRow[];
  waiting: string[];
  arm: string | null;
  runLabel: string | null;
}

export function lastTouched(l: LanePulse): string | null {
  for (let i = l.tail.length - 1; i >= 0; i--) if (l.tail[i]!.path) return l.tail[i]!.path;
  return l.filesEdited[l.filesEdited.length - 1] ?? l.filesRead[l.filesRead.length - 1] ?? null;
}

function busiest(lanes: readonly LanePulse[]): LanePulse | null {
  const ev = (l: LanePulse) => Math.max(toMs(l.tail[l.tail.length - 1]?.at) ?? 0, toMs(l.heartbeatAt) ?? 0, toMs(l.phaseSince) ?? 0);
  let best: LanePulse | null = null;
  for (const l of lanes) if (WORKING.has(l.phase) && (!best || ev(l) > ev(best))) best = l;
  return best;
}

export function serverClock(pulse: LoopPulse, receivedAt: number | null, now: number, stale: boolean): number {
  const at = toMs(pulse.at) ?? now;
  return stale || receivedAt == null ? at : at + Math.max(0, now - receivedAt);
}

function runningAnswer(p: LoopPulse, clock: number): Answer {
  const r = p.runner;
  if (!r) return { headline: "No runner", sub: p.run ? `manual run #${p.run.seq ?? "?"}` : null, tone: "muted" };
  const started = toMs(r.startedAt);
  if (r.phase === "running") return { headline: "Running", sub: started != null ? `up ${dur(clock - started)}` : null, tone: "live" };
  if (r.phase === "paused") {
    const until = toMs(r.pausedUntil);
    return { headline: `Paused — ${PAUSE_WORDS[r.pausedReason ?? ""] ?? "a breaker fired"}`, sub: until != null ? `until ${hm(until)} UTC` : "a person resumes it", tone: "warn" };
  }
  if (r.phase === "idle") {
    const wakes = r.repos.map((x) => toMs(x.pausedUntil)).filter((x): x is number => x != null && x > clock);
    return { headline: "Idle", sub: wakes.length ? `next repo wakes ${hm(Math.min(...wakes))} UTC` : "every repo is resting", tone: "calm" };
  }
  if (r.phase === "error") return { headline: "Stopped on an error", sub: plural(r.runsDone, "run done", "runs done"), tone: "danger" };
  return { headline: "Stopped", sub: plural(r.runsDone, "run done", "runs done"), tone: "muted" };
}

function nowAnswer(p: LoopPulse, clock: number): Answer {
  const lane = busiest(p.lanes);
  if (lane) {
    const quiet = lane.phase === "agent-quiet" ? laneQuietForMs({ tail: lane.tail, heartbeatAt: lane.heartbeatAt, stageAt: lane.phaseSince }, clock) : null;
    const since = toMs(lane.phaseSince);
    return { headline: `${repoShort(lane.repo)} · ${lanePhaseLabel(lane.phase, quiet)}`, sub: since != null ? `for ${dur(clock - since)}` : null, tone: "live" };
  }
  const r = p.runner;
  if (p.run && p.waiting.length) return { headline: "Waiting for a run slot", sub: p.waiting.slice(0, 3).map(repoShort).join(", "), tone: "calm" };
  if (r?.phase === "paused") return { headline: "Holding", sub: "nothing dispatches while paused", tone: "calm" };
  if (r?.phase === "idle") return { headline: "Resting", sub: "every repo is backing off", tone: "calm" };
  if (r?.phase === "running") return { headline: "Between runs", sub: "preparing the next run", tone: "calm" };
  return { headline: "Nothing running", sub: null, tone: "muted" };
}

function laneRow(l: LanePulse, clock: number): LaneRow {
  const start = toMs(l.startedAt);
  const deadline = toMs(l.deadlineAt);
  const used = start != null ? Math.max(0, clock - start) : null;
  const budget = start != null && deadline != null && deadline > start ? deadline - start : null;
  const quiet = l.phase === "agent-quiet" ? laneQuietForMs({ tail: l.tail, heartbeatAt: l.heartbeatAt, stageAt: l.phaseSince }, clock) : null;
  return {
    laneId: l.laneId,
    repo: l.repo,
    cycle: l.cycle,
    stage: stageIndex(l.phase),
    landing: l.phase === "landing" || l.phase === "rescanning",
    phase: lanePhaseLabel(l.phase, quiet),
    file: lastTouched(l),
    usedMs: used,
    budgetMs: budget,
    frac: used != null && budget != null ? Math.min(1, used / budget) : null,
    cost: usd(l.costMicros),
  };
}

/** The whole section, from one pulse. `stale` turns the answers into the truth about the feed. */
export function flightView(p: LoopPulse, clock: number, stale: boolean, heardAgoMs: number | null): FlightView {
  let running = runningAnswer(p, clock);
  let now = nowAnswer(p, clock);
  if (stale) {
    const heard = heardAgoMs != null ? `last heard ${dur(heardAgoMs)} ago` : "no answer yet";
    running = { headline: "Reconnecting…", sub: heard, tone: "warn" };
    now = { headline: heardAgoMs != null ? `Last heard ${dur(heardAgoMs)} ago` : "No signal", sub: "as of last contact", tone: "muted" };
  }
  const n = p.needsYou;
  const rp = n.runnerPaused || p.runner?.phase === "paused";
  const parts = [
    n.plans ? `${plural(n.plans, "plan")} ${n.plans === 1 ? "waits" : "wait"}` : null,
    n.pausedRepos ? `${plural(n.pausedRepos, "repo")} paused` : null,
    rp ? "runner paused" : null,
  ].filter((x): x is string => x != null);
  const needs = parts.length
    ? { headline: parts.join(" · ").replace(/^./, (c) => c.toUpperCase()), sub: null, tone: "warn" as const, count: n.plans + n.pausedRepos + (rp ? 1 : 0) }
    : { headline: "Nothing waiting", sub: null, tone: "muted" as const, count: 0 };
  const ceiling = p.runner?.spendCeilingMicros ?? null;
  const spend = p.runner ? p.runner.spendTodayMicros : p.today.spendMicros;
  const arm = p.lanes.map((l) => armLabel(l.arm)).find((x) => x != null) ?? null;
  return {
    clock,
    running,
    now,
    today: { verified: p.today.verifiedCloses, landed: p.today.landed, spend: usd(spend) ?? "—", ceiling: ceiling ? usd(ceiling) : null, ratio: ceiling ? Math.min(1, spend / ceiling) : null },
    needs,
    lanes: p.lanes.map((l) => laneRow(l, clock)),
    waiting: p.waiting,
    arm,
    runLabel: p.run ? `run #${p.run.seq ?? "?"} · cycle ${p.run.cycle}/${p.run.maxCycles}` : null,
  };
}
