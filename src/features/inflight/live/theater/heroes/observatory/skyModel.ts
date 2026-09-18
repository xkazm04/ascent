// THE SKY'S BODIES — which repos are in the sky, on which ring, and what each one says. Pure.
//
// HONEST LAYOUT. The pulse does not carry a repo's adoption × rigor coordinates (the cockpit's
// Observatory gets those from the org rollup, server-side), so this sky refuses to borrow that
// chart's meaning. Its ONE spatial encoding is the ring, and the ring is runner STATE:
//   ring 0 — AT WORK:  a lane in a working phase (planning … rescanning);
//   ring 1 — NEXT UP:  waiting for a run slot, queued, done this cycle, held for review, failed;
//   ring 2 — RESTING:  paused or backing off (with the reason), or known only from recent events.
// Where a body sits AROUND its ring is a stable seat (a hash of its name), and means nothing.
//
// Which repos: every lane, every waiting repo, every repo the runner keeps state for, and every repo
// an event this screen has seen names — nothing is invented, and nothing known is left out.

import type { LanePhase, LanePulse, LoopPulse, RepoPauseReason } from "@/lib/local/runner-types";
import { fmtClock, fmtDuration, repoShort, since, toMs } from "../../theaterFormat";
import { lanePhaseWords } from "../../theaterHeaderModel";
import { flareFor, landingsToday, lastEventFor, type LaneMemory, type SeenActivity, type SkyMemory } from "./skyMemory";
import { FLARE_HOLD_MS, HALO_MAX } from "./skyConstants";

export type SkyRing = 0 | 1 | 2;
export type SkyTone = "plan" | "read" | "edit" | "think" | "quiet" | "prove" | "land" | "held" | "error" | "wait" | "rest" | "attention" | "past";

export interface SkyBody {
  repo: string;
  name: string;
  ring: SkyRing;
  tone: SkyTone;
  lane: LanePulse | null;
  memory: LaneMemory | null;
  /** Ring 0: the phase in words; else null. */
  phase: string | null;
  /** Ring 0: "for 37 s" in the current phase. */
  inPhase: string | null;
  /** Ring 0: the file it touched last, and whether that touch was an edit. */
  file: string | null;
  fileEdited: boolean;
  /** Ring 0: the lane's worktree diff, in words. */
  diff: string | null;
  /** Rings 1–2: why the body is where it is, in a few words. */
  note: string | null;
  noteTone: "calm" | "attention" | "bad" | "muted";
  /** Distinct landing moments today (0…HALO_MAX) — the "verified today" halo. */
  halo: number;
  landedToday: number;
  /** A landing that arrived just now — the flare's one-shot identity. */
  flareKey: string | null;
}

export type CoreTone = "live" | "hold" | "rest" | "none" | "stopped";
export interface SkyModel {
  bodies: SkyBody[];
  /** The runner itself, at the centre. `why` is the pause reason in words, when holding. */
  core: { tone: CoreTone; title: string | null; sub: string | null; why?: string | null };
  /** The whole runner is paused: every body dims under it. */
  holding: boolean;
  /** Earliest future wake among resting repos (or the runner's own pause), as a clock string. */
  nextWake: { repo: string | null; at: string } | null;
}

const WORKING: ReadonlySet<LanePhase> = new Set(["planning", "baseline", "agent-reading", "agent-editing", "agent-thinking", "agent-quiet", "verifying", "installing", "committing", "landing", "rescanning"]);

export const PHASE_TONE: Record<LanePhase, SkyTone> = {
  queued: "wait",
  planning: "plan",
  baseline: "plan",
  "agent-reading": "read",
  "agent-editing": "edit",
  "agent-thinking": "think",
  "agent-quiet": "quiet",
  verifying: "prove",
  installing: "prove",
  committing: "land",
  landing: "land",
  rescanning: "prove",
  held: "held",
  done: "rest",
  error: "error",
};

const PAUSE_NOTE: Record<RepoPauseReason, string> = {
  "repo-failures": "paused · failures in a row",
  "branch-conflict": "paused · branch conflict",
  "dependency-install": "paused · install failed",
  "dry-backoff": "resting",
};
const EVENT_WORD: Record<string, string> = {
  landed: "landed",
  "verified-close": "verified",
  "plan-pending": "plan waits",
  paused: "paused",
  "direction-done": "direction done",
  rejected: "rejected",
  failed: "failed",
};

function newestPathed(events: readonly SeenActivity[], lane: LanePulse): { path: string | null; edited: boolean } {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.path) return { path: e.path, edited: e.kind === "edit" || e.kind === "write" };
  }
  const edited = lane.filesEdited[0] ?? null;
  return edited ? { path: edited, edited: true } : { path: lane.filesRead[0] ?? null, edited: false };
}

function laneBody(lane: LanePulse, mem: SkyMemory, now: number): Omit<SkyBody, "halo" | "landedToday" | "flareKey"> {
  const memory = mem.lanes[lane.laneId] ?? null;
  const base = { repo: lane.repo, name: repoShort(lane.repo), lane, memory, fileEdited: false, diff: null, note: null, noteTone: "calm" as const };
  if (!WORKING.has(lane.phase)) {
    const note = lane.phase === "done" ? "done this cycle" : lane.phase === "queued" ? "queued" : lane.phase === "held" ? "held for review" : "failed";
    const noteTone = lane.phase === "held" ? "attention" : lane.phase === "error" ? "bad" : "calm";
    return { ...base, ring: 1, tone: PHASE_TONE[lane.phase], phase: null, inPhase: null, file: null, note, noteTone };
  }
  const touched = newestPathed(memory?.events ?? [], lane);
  const inPhase = since(lane.phaseSince, now);
  const d = lane.diffStat;
  return {
    ...base,
    ring: 0,
    tone: PHASE_TONE[lane.phase],
    phase: lanePhaseWords(lane, now),
    inPhase: inPhase != null ? `for ${fmtDuration(inPhase)}` : null,
    file: touched.path,
    fileEdited: touched.edited,
    diff: d ? `+${d.plus} −${d.minus} in ${d.files} ${d.files === 1 ? "file" : "files"}` : null,
  };
}

function restingNote(p: LoopPulse, mem: SkyMemory, repo: string, now: number): Pick<SkyBody, "note" | "noteTone" | "tone"> {
  const state = p.runner?.repos.find((r) => r.repo === repo);
  if (state?.paused) {
    const until = toMs(state.pausedUntil);
    if (state.paused === "dry-backoff") {
      const note = until != null && until > now ? `rests until ${fmtClock(state.pausedUntil)}` : "resting";
      return { note, noteTone: "calm", tone: "rest" };
    }
    return { note: PAUSE_NOTE[state.paused], noteTone: "attention", tone: "attention" };
  }
  const last = lastEventFor(mem, repo);
  if (state) return { note: "between runs", noteTone: "muted", tone: "rest" };
  if (last) return { note: `${EVENT_WORD[last.kind] ?? last.kind} ${fmtClock(last.at) ?? ""}`.trim(), noteTone: "muted", tone: "past" };
  return { note: null, noteTone: "muted", tone: "past" };
}

function coreOf(p: LoopPulse, now: number, wake: SkyModel["nextWake"]): SkyModel["core"] {
  const r = p.runner;
  if (!r) return { tone: "none", title: "No runner", sub: null };
  if (r.phase === "paused") {
    const why = r.pausedReason === "spend-ceiling" ? "daily spend ceiling" : r.pausedReason === "session-limit" ? "session limit" : "a breaker fired";
    const until = fmtClock(r.pausedUntil);
    return { tone: "hold", title: `Holding — ${why}`, sub: until ? `until ${until}` : null, why };
  }
  if (r.phase === "idle") return { tone: "rest", title: "Resting", sub: wake ? `next wake ${wake.at}` : null };
  if (r.phase === "running") {
    if (p.run) return { tone: "live", title: null, sub: `run #${p.run.seq ?? "?"} · cycle ${p.run.cycle}/${p.run.maxCycles}` };
    return { tone: "live", title: "Between runs", sub: null };
  }
  return { tone: "stopped", title: r.phase === "error" ? "Stopped on an error" : "Stopped", sub: null };
}

function wakeOf(p: LoopPulse, now: number): SkyModel["nextWake"] {
  let best: { repo: string | null; t: number } | null = null;
  for (const r of p.runner?.repos ?? []) {
    const t = toMs(r.pausedUntil);
    if (t != null && t > now && (!best || t < best.t)) best = { repo: r.repo, t };
  }
  const own = toMs(p.runner?.pausedUntil);
  if (p.runner?.phase === "paused" && own != null && own > now) best = { repo: null, t: own };
  return best ? { repo: best.repo, at: fmtClock(new Date(best.t).toISOString()) ?? "" } : null;
}

export function skyModel(p: LoopPulse, mem: SkyMemory, now: number): SkyModel {
  const bodies = new Map<string, Omit<SkyBody, "halo" | "landedToday" | "flareKey">>();
  for (const lane of p.lanes) {
    const prior = bodies.get(lane.repo);
    // Two lanes on one repo (a direction's A/B): the working one owns the body.
    if (!prior || (prior.ring > 0 && WORKING.has(lane.phase))) bodies.set(lane.repo, laneBody(lane, mem, now));
  }
  for (const repo of p.waiting) {
    if (!bodies.has(repo)) bodies.set(repo, { repo, name: repoShort(repo), ring: 1, tone: "wait", lane: null, memory: null, phase: null, inPhase: null, file: null, fileEdited: false, diff: null, note: "waits for a slot", noteTone: "calm" });
  }
  const outer = [...(p.runner?.repos.map((r) => r.repo) ?? []), ...mem.events.map((s) => s.event.repo)];
  for (const repo of outer) {
    if (bodies.has(repo)) continue;
    bodies.set(repo, { repo, name: repoShort(repo), ring: 2, lane: null, memory: null, phase: null, inPhase: null, file: null, fileEdited: false, diff: null, ...restingNote(p, mem, repo, now) });
  }
  const nextWake = wakeOf(p, now);
  return {
    bodies: [...bodies.values()].map((b) => {
      const landedToday = landingsToday(mem, b.repo, now);
      return { ...b, landedToday, halo: Math.min(HALO_MAX, landedToday), flareKey: flareFor(mem, b.repo, now, FLARE_HOLD_MS) };
    }),
    core: coreOf(p, now, nextWake),
    holding: p.runner?.phase === "paused",
    nextWake,
  };
}
