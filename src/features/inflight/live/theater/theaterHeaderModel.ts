// THE FOUR ANSWERS — what the awareness header says, as a pure function of the pulse and the clock.
//
// The header is read from three metres by someone who glanced over: is it running, what is it doing
// right now, is it going well, does it need me. Each answer is a headline of a few words plus one
// supporting line. Pure so every state (running, paused on spend, paused on session limit, idle, no
// runner, stale) is pinned by a test without a renderer.
//
// STALENESS HONESTY (`motion/content-bearing-degradation`): when the last good pulse is older than
// `THEATER_STALE_MS`, EVERY liveness claim switches together — the phase word becomes "Reconnecting…",
// NOW becomes "Last heard 42 s ago", the live-dot goes out, and every elapsed figure freezes at the
// moment of last contact (the caller passes that instant as `clock`). Values that are still true as
// history (today's counts, what was waiting) stay, labelled "as of".

import type { LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { lanePhaseLabel } from "@/lib/local/lane-phase";
import { fmtClock, fmtDuration, fmtUsd, repoShort, since, toMs } from "./theaterFormat";

export type HeaderTone = "live" | "calm" | "warn" | "danger" | "muted";

export interface HeaderAnswer {
  headline: string;
  sub: string | null;
  tone: HeaderTone;
}

export interface HeaderModel {
  /** Nothing is true yet: the four answers render as empty blocks and the hero says it once. */
  quiet: boolean;
  running: HeaderAnswer & { live: boolean };
  now: HeaderAnswer & { path: string | null };
  today: { verified: string; landed: string; spend: string; ceiling: string | null; ratio: number | null; asOf: string | null };
  needs: HeaderAnswer & { count: number; amber: boolean; href: string | null };
}

export interface HeaderInput {
  pulse: LoopPulse | null;
  /** At least one good answer has arrived. */
  loaded: boolean;
  stale: boolean;
  /** The instant every elapsed figure is measured to: the live clock, or last contact when stale. */
  clock: number;
  /** How long since the last good answer, for "Last heard …". */
  heardAgoMs: number | null;
  error: string | null;
  /** Where "Open the ledger" goes; null on the kiosk, whose viewer cannot open it. */
  ledgerHref: string | null;
}

/** The predicates the TODAY figures carry in their tooltips (`count-carries-predicate`). */
export const TODAY_PREDICATES = {
  verified: "Findings closed AND confirmed gone by a rescan, since local midnight (server time).",
  landed: "Lanes whose verified work landed on the runner branch, since local midnight (server time).",
  spend: "Agent spend since local midnight (server time), against the runner's daily ceiling.",
} as const;

const WORKING = new Set<string>(["planning", "baseline", "agent-reading", "agent-editing", "agent-thinking", "agent-quiet", "verifying", "installing", "committing", "landing", "rescanning"]);

/** The newest evidence a lane is alive: its last activity, heartbeat or phase change. */
function laneEvidenceMs(l: LanePulse): number {
  const last = l.tail.length ? toMs(l.tail[l.tail.length - 1]!.at) : null;
  return Math.max(last ?? 0, toMs(l.heartbeatAt) ?? 0, toMs(l.phaseSince) ?? 0);
}

/** The lane a glance should be told about: the working lane with the newest evidence of life. */
export function busiestLane(lanes: readonly LanePulse[]): LanePulse | null {
  let best: LanePulse | null = null;
  for (const l of lanes) {
    if (!WORKING.has(l.phase)) continue;
    if (!best || laneEvidenceMs(l) > laneEvidenceMs(best)) best = l;
  }
  return best;
}

/** The file the lane touched last: its newest activity with a path, else its newest edit or read. */
export function lastTouched(l: LanePulse): string | null {
  for (let i = l.tail.length - 1; i >= 0; i--) if (l.tail[i]!.path) return l.tail[i]!.path;
  return l.filesEdited[l.filesEdited.length - 1] ?? l.filesRead[l.filesRead.length - 1] ?? null;
}

/** The phase words for a lane, with its quiet span when the stream went silent. */
export function lanePhaseWords(l: LanePulse, clock: number): string {
  const quiet = l.phase === "agent-quiet" ? clock - laneEvidenceMs(l) : null;
  return lanePhaseLabel(l.phase, quiet);
}

const PAUSE_WORDS: Record<string, string> = { "spend-ceiling": "spend ceiling", "session-limit": "session limit" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function runningAnswer(p: LoopPulse | null, clock: number): HeaderAnswer & { live: boolean } {
  const r = p?.runner;
  if (!r) return { headline: "No runner", sub: "Start the standing runner from the Live tab", tone: "muted", live: false };
  const up = since(r.startedAt, clock);
  const run = p?.run ? `run #${p.run.seq ?? "?"} · cycle ${p.run.cycle}/${p.run.maxCycles}` : null;
  const upText = up != null ? `up ${fmtDuration(up)}` : null;
  const sub = [upText, run].filter(Boolean).join(" · ") || null;
  if (r.phase === "running") return { headline: "Running", sub, tone: "live", live: true };
  if (r.phase === "paused") {
    const why = PAUSE_WORDS[r.pausedReason ?? ""] ?? "a breaker fired";
    const until = fmtClock(r.pausedUntil);
    return { headline: `Paused — ${why}${until ? ` until ${until}` : ""}`, sub: upText, tone: "warn", live: false };
  }
  if (r.phase === "idle") {
    const wakes = r.repos.map((x) => toMs(x.pausedUntil)).filter((t): t is number => t != null && t > clock);
    const next = wakes.length ? fmtClock(new Date(Math.min(...wakes)).toISOString()) : null;
    return { headline: next ? `Idle — next repo wakes at ${next}` : "Idle — every repo is resting", sub: upText, tone: "calm", live: false };
  }
  if (r.phase === "error") return { headline: "Stopped on an error", sub: plural(r.runsDone, "run done", "runs done"), tone: "danger", live: false };
  return { headline: "Stopped", sub: plural(r.runsDone, "run done", "runs done"), tone: "muted", live: false };
}

function nowAnswer(p: LoopPulse | null, clock: number): HeaderAnswer & { path: string | null } {
  const lane = p ? busiestLane(p.lanes) : null;
  if (p && lane) {
    const inPhase = since(lane.phaseSince, clock);
    const step = lane.planStep ? `step ${lane.planStep.index} of ${lane.planStep.total}` : null;
    const sub = [step, inPhase != null ? `for ${fmtDuration(inPhase)}` : null].filter(Boolean).join(" · ") || null;
    return { headline: `${repoShort(lane.repo)} · ${lanePhaseWords(lane, clock)}`, sub, path: lastTouched(lane), tone: "live" };
  }
  const idle = (headline: string, sub: string | null = null) => ({ headline, sub, path: null, tone: "calm" as const });
  if (p?.run && p.waiting.length) return idle("Waiting for a run slot", p.waiting.slice(0, 3).map(repoShort).join(", "));
  if (p?.run) return idle(`Run #${p.run.seq ?? "?"} · ${p.run.phase}`);
  const phase = p?.runner?.phase;
  if (phase === "running") return idle("Between runs", "Preparing the next run");
  if (phase === "paused") return idle("Holding", "Nothing dispatches while paused");
  if (phase === "idle") return idle("Resting", "Every repo is backing off after dry runs");
  return { headline: "Nothing running", sub: null, path: null, tone: "muted" };
}

function needsAnswer(p: LoopPulse | null, href: string | null): HeaderModel["needs"] {
  const plans = p?.needsYou.plans ?? 0;
  const repos = p?.needsYou.pausedRepos ?? 0;
  const runnerPaused = Boolean(p?.needsYou.runnerPaused || p?.runner?.phase === "paused");
  const count = plans + repos + (runnerPaused ? 1 : 0);
  if (count === 0) return { headline: "Nothing waiting", sub: null, tone: "calm", count: 0, amber: false, href: null };
  const parts = [
    plans ? `${plural(plans, "plan", "plans")} ${plans === 1 ? "waits" : "wait"}` : null,
    repos ? `${plural(repos, "repo", "repos")} paused` : null,
    runnerPaused ? "runner paused" : null,
  ].filter((x): x is string => x !== null);
  const headline = parts.join(" · ");
  return { headline: headline[0]!.toUpperCase() + headline.slice(1), sub: null, tone: "warn", count, amber: true, href };
}

/**
 * NOTHING TO REPORT — an org whose runner has never run, and whose day is still empty.
 *
 * Every block of this page is written to answer its own question honestly, and with no runner they
 * all answer the SAME thing: "no runner", "nothing running", "0 · 0 · $0.00", "nothing waiting",
 * "no runner is reporting", "nothing yet today" — six ways of saying one sentence, on a screen whose
 * whole job is that a glance lands on one. So when this predicate holds the page says it ONCE, in the
 * hero, with the way to fix it; the four answers keep their questions and show an empty block, and
 * the rail stands down. The moment anything is true — a run, a lane, a waiting plan, a figure on the
 * day — every block has its own answer again and all of them come back.
 */
export function nothingToReport(p: LoopPulse | null): boolean {
  if (!p) return false;
  const quietToday = p.today.verifiedCloses === 0 && p.today.landed === 0 && p.today.spendMicros === 0;
  const nobodyWaiting = p.needsYou.plans === 0 && p.needsYou.pausedRepos === 0 && !p.needsYou.runnerPaused;
  return !p.runner && !p.run && p.lanes.length === 0 && p.waiting.length === 0 && p.latest.length === 0 && quietToday && nobodyWaiting;
}

export function headerModel(input: HeaderInput): HeaderModel {
  const { pulse, loaded, stale, clock, heardAgoMs, error, ledgerHref } = input;
  const heard = heardAgoMs != null ? `Last heard ${fmtDuration(heardAgoMs)} ago` : null;
  if (!loaded) {
    const dash = { headline: "—", sub: null, tone: "muted" as const };
    return {
      quiet: false,
      running: stale
        ? { headline: "Reconnecting…", sub: error ?? "No answer from the server yet", tone: "warn", live: false }
        : { headline: "Connecting…", sub: null, tone: "muted", live: false },
      now: { ...dash, path: null },
      today: { verified: "—", landed: "—", spend: "—", ceiling: null, ratio: null, asOf: null },
      needs: { ...dash, count: 0, amber: false, href: null },
    };
  }
  if (!stale && nothingToReport(pulse)) {
    const blank = { headline: "", sub: null, tone: "muted" as const };
    return {
      quiet: true,
      running: { ...blank, live: false },
      now: { ...blank, path: null },
      today: { verified: "", landed: "", spend: "", ceiling: null, ratio: null, asOf: null },
      needs: { ...blank, count: 0, amber: false, href: null },
    };
  }
  const running = runningAnswer(pulse, clock);
  const now = nowAnswer(pulse, clock);
  const ceilingMicros = pulse?.runner?.spendCeilingMicros ?? null;
  const spendMicros = pulse?.today.spendMicros ?? 0;
  const today = {
    verified: String(pulse?.today.verifiedCloses ?? 0),
    landed: String(pulse?.today.landed ?? 0),
    spend: fmtUsd(spendMicros),
    ceiling: ceilingMicros ? fmtUsd(ceilingMicros) : null,
    ratio: ceilingMicros ? Math.min(1, spendMicros / ceilingMicros) : null,
    asOf: stale && heardAgoMs != null ? `as of ${fmtDuration(heardAgoMs)} ago` : null,
  };
  const needs = needsAnswer(pulse, ledgerHref);
  if (!stale) return { quiet: false, running, now, today, needs };
  return {
    quiet: false,
    running: { headline: "Reconnecting…", sub: [heard, `was ${running.headline}`].filter(Boolean).join(" · "), tone: "warn", live: false },
    now: { headline: heard ?? "Last heard: unknown", sub: `was ${now.headline}`, path: null, tone: "muted" },
    today,
    needs: { ...needs, sub: today.asOf },
  };
}
