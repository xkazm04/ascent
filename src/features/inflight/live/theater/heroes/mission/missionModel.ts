// THE MISSION MODEL — what each lane band says, as a pure function of the pulse, the accumulator and
// the clock. No rendering, no hooks: every state (working, quiet, landed, held, failed) is a table test.
//
// Honesty rules, as code: the ring is TIME USED of the watchdog ceiling (never work done); the phase
// word comes from `lanePhaseLabel` (the one vocabulary); the activity glow decays with the age of the
// newest real event, and a quiet lane has none; "Landed" is claimed only from a `landed` event for the
// repo dated inside this lane's session.

import type { LanePhase, LanePulse, PulseEvent } from "@/lib/local/runner-types";
import { lanePhaseLabel, laneQuietForMs } from "@/lib/local/lane-phase";
import { deadlineFraction, fmtDuration, since, toMs } from "../../theaterFormat";
import type { LaneAcc } from "./missionAccumulate";
import { ACTIVITY_DECAY_MS, LANDED_HOLD_MS } from "./missionTokens";

/** The lane's journey, as the stage track prints it. */
export const STAGES = ["plan", "baseline", "agent", "check", "commit", "land"] as const;

/** The stop a phase lights: -1 none yet, 0…5 the current stop, 6 every stop passed. */
const STAGE_OF: Record<LanePhase, number> = {
  queued: -1,
  planning: 0,
  baseline: 1,
  "agent-reading": 2,
  "agent-editing": 2,
  "agent-thinking": 2,
  "agent-quiet": 2,
  installing: 3,
  verifying: 3,
  committing: 4,
  landing: 5,
  rescanning: 5,
  held: 5,
  done: 6,
  error: -1,
};
export const stageIndex = (phase: LanePhase): number => STAGE_OF[phase] ?? -1;

export type LaneTone = "working" | "quiet" | "landed" | "held" | "failed" | "done";

export interface LaneView {
  lane: LanePulse;
  tone: LaneTone;
  /** What keys the phase word's swap — a stage, not a ticking quiet duration. */
  phaseKey: string;
  word: string;
  sub: string | null;
  landed: PulseEvent | null;
  stage: number;
  ring: { frac: number; elapsedMs: number; budgetMs: number } | null;
  elapsedMs: number | null;
  /** 0…1: how recently the agent did something the pulse can name. */
  glow: number;
}

/** A `landed` event for this lane's repo dated inside its session (at or after it started). */
export function landedFor(lane: LanePulse, latest: readonly PulseEvent[], now: number): PulseEvent | null {
  const start = toMs(lane.startedAt);
  for (const e of latest) {
    if (e.kind !== "landed" || e.repo !== lane.repo) continue;
    const at = toMs(e.at);
    if (at != null && at <= now && (start == null || at >= start)) return e;
  }
  return null;
}

/** Still inside its Landed moment (shown as a band), rather than cleared to a row. */
export const landedRecently = (e: PulseEvent | null, now: number): boolean =>
  e != null && now - (toMs(e.at) ?? 0) < LANDED_HOLD_MS;

function newestActivityMs(lane: LanePulse, acc: LaneAcc | undefined): number | null {
  const times = lane.tail.map((e) => toMs(e.at));
  for (const c of Object.values(acc?.chips ?? {})) times.push(c.lastAt);
  const known = times.filter((t): t is number => t != null);
  return known.length ? Math.max(...known) : null;
}

/** Freshness of an event at `at` against `now`: 1 at the moment, 0 at `ACTIVITY_DECAY_MS`. */
export function decay(at: number | null, now: number): number {
  if (at == null) return 0;
  return Math.min(1, Math.max(0, 1 - (now - at) / ACTIVITY_DECAY_MS));
}

function toneOf(phase: LanePhase, landed: boolean): LaneTone {
  if (landed) return "landed";
  if (phase === "agent-quiet") return "quiet";
  if (phase === "held") return "held";
  if (phase === "error") return "failed";
  if (phase === "done") return "done";
  return "working";
}

export function laneView(lane: LanePulse, acc: LaneAcc | undefined, latest: readonly PulseEvent[], now: number): LaneView {
  const landed = landedFor(lane, latest, now);
  const phase = acc?.shown.phase ?? lane.phase;
  const tone = toneOf(phase, landed != null);
  const quiet = laneQuietForMs({ tail: lane.tail, heartbeatAt: lane.heartbeatAt, stageAt: lane.phaseSince }, now);
  // "Still working — quiet for 3m": the stage word huge, the silence on the line beneath it.
  const [word, quietWords] = lanePhaseLabel(phase, quiet).split(" — ");
  const inPhase = since(lane.phaseSince, now);
  // A landed session's clock stopped when it landed: the ring holds that moment, it does not keep filling.
  const clock = landed ? Math.min(now, toMs(landed.at) ?? now) : now;
  const frac = deadlineFraction(lane, clock);
  const start = toMs(lane.startedAt);
  const end = toMs(lane.deadlineAt);
  const elapsedMs = start != null ? Math.max(0, clock - start) : null;
  return {
    lane,
    tone,
    phaseKey: landed ? "landed" : phase,
    word: landed ? "Landed" : word!,
    sub: landed ? landed.headline : quietWords ?? (inPhase != null ? `for ${fmtDuration(inPhase)}` : null),
    landed,
    stage: landed ? 6 : stageIndex(phase),
    ring: frac != null && start != null && end != null ? { frac, elapsedMs: elapsedMs ?? 0, budgetMs: end - start } : null,
    elapsedMs,
    glow: tone === "working" ? decay(newestActivityMs(lane, acc), now) : 0,
  };
}

/** A lane keeps its full band while it works, and through its Landed moment; then it clears to a row. */
export function showsBand(lane: LanePulse, latest: readonly PulseEvent[], now: number): boolean {
  if (lane.phase !== "done" && lane.phase !== "error") return true;
  return landedRecently(landedFor(lane, latest, now), now);
}

/** "2:10", "27:04", "1:02:10" — the ring's clock, to the second. */
export function fmtClockSpan(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Split a repo path into the dim directory and the bright file name. */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  return i >= 0 ? { dir: path.slice(0, i + 1), name: path.slice(i + 1) } : { dir: "", name: path };
}
