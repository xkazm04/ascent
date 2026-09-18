// WHAT THIS SCREEN HAS SEEN — the observatory's accumulator, as a pure fold over pulses.
//
// The pulse is a bounded WINDOW (a lane's tail is its newest 6 events, `latest` its newest 12), so a
// comet tail longer than six particles, or a halo that outlives `latest`, can only come from memory.
// This fold is that memory, keyed exactly the way production will need it:
//   - a lane's events are kept per lane SESSION (`laneId` + `startedAt`) and reset when the session
//     changes — a new cycle's tail never inherits the last cycle's activity;
//   - a lane that leaves the pulse is forgotten;
//   - `latest` events are remembered by identity (`eventKey`), and on the FIRST fold every one of them
//     is history: none "arrives", so a reload never replays a day of flares (`motion/one-shot-guarding`).
// Everything a surface says from this memory is labelled "since this screen opened".

import type { LaneActivity, LanePulse, LoopPulse, PulseEvent } from "@/lib/local/runner-types";
import { eventKey } from "../../theaterPulseParse";
import { toMs } from "../../theaterFormat";
import { TAIL_KEEP } from "./skyConstants";

export interface SeenActivity extends LaneActivity {
  key: string;
  /** True when it arrived AFTER this screen's first pulse — only these play an entrance. */
  fresh: boolean;
}

export interface LaneMemory {
  session: string;
  laneId: string;
  repo: string;
  /** Oldest → newest, at most `TAIL_KEEP`. */
  events: SeenActivity[];
  /** Running counts of every distinct event this screen saw for the session (not just the kept ones). */
  reads: number;
  edits: number;
  other: number;
}

export interface SeenEvent {
  key: string;
  event: PulseEvent;
  /** The clock when this screen first saw it. */
  seenAt: number;
  /** False for everything in the first pulse (history), true for what arrived while open. */
  arrived: boolean;
}

export interface SkyMemory {
  /** The pulse last folded — the render compares identity to know when to fold again. */
  pulse: LoopPulse | null;
  openedAt: number;
  lanes: Record<string, LaneMemory>;
  /** Newest-seen last, bounded. */
  events: SeenEvent[];
}

const EVENTS_KEEP = 240;

export const laneSession = (l: Pick<LanePulse, "laneId" | "startedAt">): string => `${l.laneId}|${l.startedAt ?? ""}`;
export const activityKey = (a: LaneActivity): string => `${a.at}|${a.kind}|${a.path ?? ""}|${a.tool ?? ""}|${a.note ?? ""}`;

export function emptyMemory(now: number): SkyMemory {
  return { pulse: null, openedAt: now, lanes: {}, events: [] };
}

function tally(kind: LaneActivity["kind"]): "reads" | "edits" | "other" {
  if (kind === "edit" || kind === "write") return "edits";
  if (kind === "read" || kind === "search") return "reads";
  return "other";
}

function foldLane(prev: LaneMemory | undefined, lane: LanePulse, first: boolean): LaneMemory {
  const session = laneSession(lane);
  const base: LaneMemory =
    prev && prev.session === session
      ? prev
      : { session, laneId: lane.laneId, repo: lane.repo, events: [], reads: 0, edits: 0, other: 0 };
  const known = new Set(base.events.map((e) => e.key));
  const added: SeenActivity[] = [];
  const counts = { reads: base.reads, edits: base.edits, other: base.other };
  for (const a of lane.tail) {
    const key = activityKey(a);
    if (known.has(key)) continue;
    known.add(key);
    // A session this screen meets for the first time is history too: its window was there before us.
    added.push({ ...a, key, fresh: !first && prev?.session === session });
    counts[tally(a.kind)] += 1;
  }
  if (added.length === 0 && base === prev) return prev;
  const events = [...base.events, ...added]
    .sort((x, y) => (toMs(x.at) ?? 0) - (toMs(y.at) ?? 0))
    .slice(-TAIL_KEEP);
  return { ...base, events, ...counts };
}

/** Fold one pulse into the memory. Pure: same inputs, same memory; never mutates `mem`. */
export function foldPulse(mem: SkyMemory, pulse: LoopPulse, now: number): SkyMemory {
  const first = mem.pulse === null;
  const lanes: Record<string, LaneMemory> = {};
  for (const lane of pulse.lanes) lanes[lane.laneId] = foldLane(mem.lanes[lane.laneId], lane, first);

  const seen = new Set(mem.events.map((e) => e.key));
  const fresh: SeenEvent[] = [];
  // `latest` is newest first; remember oldest first so `events` stays in arrival order.
  for (const e of [...pulse.latest].reverse()) {
    const key = eventKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push({ key, event: e, seenAt: now, arrived: !first });
  }
  const events = fresh.length ? [...mem.events, ...fresh].slice(-EVENTS_KEEP) : mem.events;
  return { pulse, openedAt: mem.openedAt, lanes, events };
}

const LANDING: ReadonlySet<PulseEvent["kind"]> = new Set(["landed", "verified-close"]);

/** Local midnight of `now` — "today" as the person watching the screen means it. */
export function midnightOf(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Distinct landing MOMENTS today for a repo (a `landed` and its `verified-close` share one). */
export function landingsToday(mem: SkyMemory, repo: string, now: number): number {
  const from = midnightOf(now);
  const moments = new Set<string>();
  for (const s of mem.events) {
    if (s.event.repo !== repo || !LANDING.has(s.event.kind)) continue;
    const at = toMs(s.event.at);
    if (at != null && at >= from && at <= now) moments.add(s.event.at);
  }
  return moments.size;
}

/** The flare to play for a repo right now: a landing that ARRIVED within `holdMs`, keyed once per moment. */
export function flareFor(mem: SkyMemory, repo: string, now: number, holdMs: number): string | null {
  for (let i = mem.events.length - 1; i >= 0; i--) {
    const s = mem.events[i]!;
    if (!s.arrived || s.event.repo !== repo || !LANDING.has(s.event.kind)) continue;
    if (now - s.seenAt >= 0 && now - s.seenAt < holdMs) return `${repo}|${s.event.at}`;
  }
  return null;
}

/** The newest landing for a repo within `windowMs` of `now`, by its own timestamp (for "just landed"). */
export function landedWithin(mem: SkyMemory, repo: string, now: number, windowMs: number): boolean {
  return mem.events.some((s) => {
    if (s.event.repo !== repo || !LANDING.has(s.event.kind)) return false;
    const at = toMs(s.event.at);
    return at != null && now - at >= 0 && now - at < windowMs;
  });
}

/** The newest event this screen knows for a repo, if any. */
export function lastEventFor(mem: SkyMemory, repo: string): PulseEvent | null {
  let best: PulseEvent | null = null;
  for (const s of mem.events) {
    if (s.event.repo !== repo) continue;
    if (!best || (toMs(s.event.at) ?? 0) > (toMs(best.at) ?? 0)) best = s.event;
  }
  return best;
}
