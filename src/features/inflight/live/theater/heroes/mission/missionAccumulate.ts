// THE ACCUMULATOR — what the Mission hero remembers across pulses, as a pure reducer.
//
// A pulse is a bounded WINDOW (≤ 8 files read, ≤ 8 edited, the 6 newest events), so a session's
// whole trail exists only if the screen keeps it. This folds each pulse into per-lane memory keyed by
// the lane's SESSION (`laneId` + cycle + start): a new session — the next cycle, a new lane row —
// starts from nothing, and a lane that leaves the pulse is forgotten. What it knows it says it knows:
// `complete` is true only when the session was first seen before it touched any file, or began while
// the screen watched ("this session"); otherwise the strip says "since this screen opened".
//
// One-shot (registry `motion/one-shot-guarding`): a chip is `live` — entitled to an entrance — only
// when it first appeared on a pulse after the SCREEN's first one. The first pulse is history; a session
// that begins while the screen watches arrives live from its first file.

import type { LaneActivity, LanePhase, LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { toMs } from "../../theaterFormat";
import { PHASE_MIN_SHOW_MS } from "./missionTokens";

export type ChipKind = "read" | "edit";

export interface ChipRec {
  path: string;
  kind: ChipKind;
  /** Order of arrival in its current kind — an edit of a file first read re-enters as an edit. */
  seq: number;
  /** Newest event known to touch it (ms), or null when it predates this screen and no event says. */
  lastAt: number | null;
  /** Arrived while the screen watched — the one condition under which it may animate in. */
  live: boolean;
}

export interface LaneAcc {
  session: string;
  /** The pulse instant this session was first observed. */
  firstSeenAt: number;
  /** The trail below is the whole session's (seen from before its first file). */
  complete: boolean;
  chips: Readonly<Record<string, ChipRec>>;
  seq: number;
  /** The agent's newest line of text, and when it said it. */
  note: { text: string; at: number } | null;
  /** The phase word on screen, and since when (the agent sub-phase hold). */
  shown: { phase: LanePhase; since: number };
}

export interface MissionAcc {
  pulseAt: string | null;
  /** The first pulse this screen folded — everything seen on it is history. */
  openedAt: number | null;
  lanes: Readonly<Record<string, LaneAcc>>;
}

export const EMPTY_ACC: MissionAcc = { pulseAt: null, openedAt: null, lanes: {} };

const AGENT_SUB: ReadonlySet<LanePhase> = new Set(["agent-reading", "agent-editing", "agent-thinking"]);

export const sessionKey = (l: LanePulse) => `${l.laneId}|${l.cycle}|${l.startedAt ?? ""}`;

const kindOf = (k: LaneActivity["kind"]): ChipKind | null => (k === "read" ? "read" : k === "edit" || k === "write" ? "edit" : null);

type Touch = { path: string; kind: ChipKind; at: number | null; fromTail: boolean };

/** Every file touch the pulse carries, oldest first: the window's paths (untimed), then the tail. A
 *  window path the tail also names is left to the tail, whose event carries the real time. */
function touchesOf(lane: LanePulse): Touch[] {
  const timed: Touch[] = [];
  for (const e of lane.tail) {
    const kind = kindOf(e.kind);
    if (kind && e.path) timed.push({ path: e.path, kind, at: toMs(e.at), fromTail: true });
  }
  const inTail = new Set(timed.map((t) => `${t.kind}:${t.path}`));
  const untimed = (paths: readonly string[], kind: ChipKind): Touch[] =>
    // `filesRead` / `filesEdited` are newest-first; reverse so the oldest arrives first.
    [...paths].reverse().filter((path) => !inTail.has(`${kind}:${path}`)).map((path) => ({ path, kind, at: null, fromTail: false }));
  return [...untimed(lane.filesRead, "read"), ...untimed(lane.filesEdited, "edit"), ...timed];
}

function foldChips(prev: LaneAcc, lane: LanePulse, pulseMs: number, first: boolean): Pick<LaneAcc, "chips" | "seq"> {
  const chips: Record<string, ChipRec> = { ...prev.chips };
  let seq = prev.seq;
  for (const t of touchesOf(lane)) {
    const known = chips[t.path];
    // An untimed window path first seen on a LATER pulse arrived within one poll of `pulseMs`.
    const at = t.at ?? (first ? null : pulseMs);
    if (!known) {
      chips[t.path] = { path: t.path, kind: t.kind, seq: ++seq, lastAt: at, live: !first };
    } else if (t.kind === "edit" && known.kind === "read") {
      chips[t.path] = { ...known, kind: "edit", seq: ++seq, lastAt: maxOf(known.lastAt, at), live: !first };
    } else if (t.fromTail) {
      // Only a timed event refreshes a known chip; the window re-listing a path is not a new touch.
      chips[t.path] = { ...known, lastAt: maxOf(known.lastAt, t.at) };
    }
  }
  return { chips, seq };
}

const maxOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

function newestNote(prev: LaneAcc["note"], tail: readonly LaneActivity[]): LaneAcc["note"] {
  let note = prev;
  for (const e of tail) {
    const at = toMs(e.at);
    if (e.kind === "text" && e.note && at != null && (!note || at >= note.at)) note = { text: e.note, at };
  }
  return note;
}

function nextShown(prev: LaneAcc["shown"], phase: LanePhase, pulseMs: number): LaneAcc["shown"] {
  if (phase === prev.phase) return prev;
  const bothAgent = AGENT_SUB.has(phase) && AGENT_SUB.has(prev.phase);
  if (bothAgent && pulseMs - prev.since < PHASE_MIN_SHOW_MS) return prev;
  return { phase, since: pulseMs };
}

/** `watchedSince` is the previous pulse the screen folded (null on the screen's first pulse). */
function foldLane(prev: LaneAcc | undefined, lane: LanePulse, pulseMs: number, watchedSince: number | null): LaneAcc {
  const session = sessionKey(lane);
  const fresh = !prev || prev.session !== session;
  const started = toMs(lane.startedAt);
  const noFilesYet = lane.filesRead.length === 0 && lane.filesEdited.length === 0;
  const base: LaneAcc = fresh
    ? {
        session,
        firstSeenAt: pulseMs,
        // The whole session is on screen when it had touched nothing yet, or began after the last look.
        complete: noFilesYet || (watchedSince != null && started != null && started >= watchedSince),
        chips: {},
        seq: 0,
        note: null,
        shown: { phase: lane.phase, since: pulseMs },
      }
    : prev;
  return {
    ...base,
    ...foldChips(base, lane, pulseMs, watchedSince == null),
    note: newestNote(base.note, lane.tail),
    shown: fresh ? base.shown : nextShown(base.shown, lane.phase, pulseMs),
  };
}

/** Fold one pulse in. Idempotent for a pulse already folded (same `at`). */
export function accumulate(prev: MissionAcc, pulse: LoopPulse): MissionAcc {
  if (prev.pulseAt === pulse.at) return prev;
  const pulseMs = toMs(pulse.at) ?? 0;
  const watchedSince = toMs(prev.pulseAt);
  const lanes: Record<string, LaneAcc> = {};
  for (const lane of pulse.lanes) lanes[lane.laneId] = foldLane(prev.lanes[lane.laneId], lane, pulseMs, watchedSince);
  return { pulseAt: pulse.at, openedAt: prev.openedAt ?? pulseMs, lanes };
}

/** The session began while the screen watched — its band may enter (once: it is keyed by session). */
export const arrivedLive = (acc: MissionAcc, lane: LaneAcc | undefined): boolean =>
  lane != null && acc.openedAt != null && lane.firstSeenAt > acc.openedAt;

/** The chips a strip shows: newest arrival first, bounded. */
export function stripChips(acc: LaneAcc | undefined, max: number): ChipRec[] {
  if (!acc) return [];
  return Object.values(acc.chips)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, max);
}

export function chipCounts(acc: LaneAcc | undefined): { total: number; edited: number } {
  const all = acc ? Object.values(acc.chips) : [];
  return { total: all.length, edited: all.filter((c) => c.kind === "edit").length };
}
