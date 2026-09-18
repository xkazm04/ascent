// CELEBRATIONS AND CUES — which arrivals earn a moment, and how rarely. Pure, so the budget is a
// tested number rather than a hope (`motion/taste-budgets`: celebratory motion is entitled to
// expressiveness BECAUSE it is rare; one that plays every minute is ambient and gets cut).
//
//   - `landed` / `direction-done` → a CELEBRATION (the wall's burst card + the opt-in chime);
//   - `plan-pending` / `paused`   → an ATTENTION cue (an amber card + a distinct falling tone);
//   - everything else             → the rail only.
//
// At most ONE cue per `CUE_GAP_MS`. Arrivals inside the gap are queued and COALESCE into the next
// cue ("3 landed · 1 direction done"), so a burst of five landings is one moment, not five. When a
// cue carries both classes it speaks as ATTENTION — a person being needed outranks a celebration.
// Only events that ARRIVE while the page is open reach here (the transport withholds the baseline).

import type { PulseEvent } from "@/lib/local/runner-types";

export const CUE_GAP_MS = 20_000;

export type CueKind = "celebrate" | "attention";

export interface TheaterCue {
  id: string;
  kind: CueKind;
  headline: string;
  /** A second line when a cue coalesced both classes ("Also: 2 landed"). */
  detail: string | null;
  events: PulseEvent[];
}

export interface CueQueue {
  lastAt: number | null;
  pending: PulseEvent[];
  seq: number;
}

export const emptyCueQueue = (): CueQueue => ({ lastAt: null, pending: [], seq: 0 });

export function cueClass(e: PulseEvent): CueKind | null {
  if (e.kind === "landed" || e.kind === "direction-done") return "celebrate";
  if (e.kind === "plan-pending" || e.kind === "paused") return "attention";
  return null;
}

/** Keep the cue-worthy arrivals; everything else belongs to the rail alone. */
export function enqueueCues(q: CueQueue, events: readonly PulseEvent[]): CueQueue {
  const worthy = events.filter((e) => cueClass(e) !== null);
  return worthy.length ? { ...q, pending: [...q.pending, ...worthy] } : q;
}

/** Milliseconds until the next cue may fire (0 = now), or null when nothing waits. */
export function cueDelay(q: CueQueue, now: number): number | null {
  if (q.pending.length === 0) return null;
  if (q.lastAt == null) return 0;
  return Math.max(0, q.lastAt + CUE_GAP_MS - now);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function celebrateWords(events: readonly PulseEvent[]): string {
  if (events.length === 1) return events[0]!.headline;
  const landed = events.filter((e) => e.kind === "landed").length;
  const done = events.length - landed;
  return [landed ? `${landed} landed` : null, done ? `${plural(done, "direction", "directions")} done` : null].filter(Boolean).join(" · ");
}

/** Fire the next cue when it is due: everything pending coalesces into it. */
export function takeCue(q: CueQueue, now: number): { cue: TheaterCue | null; queue: CueQueue } {
  const delay = cueDelay(q, now);
  if (delay == null || delay > 0) return { cue: null, queue: q };
  const attention = q.pending.filter((e) => cueClass(e) === "attention");
  const celebrate = q.pending.filter((e) => cueClass(e) === "celebrate");
  const seq = q.seq + 1;
  const kind: CueKind = attention.length ? "attention" : "celebrate";
  const headline =
    kind === "attention"
      ? attention.length === 1
        ? attention[0]!.headline
        : `${attention.length} things need you`
      : celebrateWords(celebrate);
  const detail = kind === "attention" && celebrate.length ? `Also: ${celebrateWords(celebrate)}` : null;
  return {
    cue: { id: `cue-${seq}`, kind, headline, detail, events: q.pending },
    queue: { lastAt: now, pending: [], seq },
  };
}
