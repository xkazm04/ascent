// THE LANE PICKERS — which lane the header's NOW answer is about, and what to say of it.
//
// Pure helpers split out of `theaterHeaderModel.ts` (the 200-LOC cap on `src/features/**`); that
// module re-exports them, so every caller's import is unchanged.

import type { LanePulse } from "@/lib/local/runner-types";
import { lanePhaseLabel } from "@/lib/local/lane-phase";
import { toMs } from "./theaterFormat";

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
