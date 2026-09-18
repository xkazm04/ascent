// THE CONSTELLATION's model — every repo the runner knows, as one small star each, so the viewer sees
// the whole fleet and not only the lanes on the big map: which work, which wait for a slot, which are
// paused (and why, in words), which rest after dry runs (and until when). Pure.

import { lanePhaseLabel } from "@/lib/local/lane-phase";
import type { LanePhase, LoopPulse, RepoRunnerState } from "@/lib/local/runner-types";
import { fmtClock, fmtDuration, repoShort } from "../../theaterFormat";
import { laneOfRepo } from "./heatFold";
import type { HeatAcc, RepoHeat } from "./heatTypes";

export type StarState = "working" | "queued" | "waiting" | "paused" | "resting" | "seen";

export interface FleetStar {
  repo: string;
  name: string;
  state: StarState;
  words: string;
  phase: LanePhase | null;
  /** Commits on the runner branch not yet on the base — what a merge would bring in. */
  ahead: number | null;
  landings: number;
  /** The accumulated map, when the big panels do not already show it. */
  map: RepoHeat | null;
}

const PAUSE_WORDS: Record<string, (r: RepoRunnerState) => string> = {
  "repo-failures": (r) => `paused · ${r.failureStreak} failures in a row`,
  "branch-conflict": () => "paused · branch conflict",
  "dependency-install": () => "paused · install failed",
};
const ORDER: Record<StarState, number> = { working: 0, queued: 1, waiting: 2, paused: 3, resting: 4, seen: 5 };

export function fleetStars(pulse: LoopPulse, acc: HeatAcc, now: number, shown: ReadonlySet<string>): FleetStar[] {
  const out = new Map<string, FleetStar>();
  const put = (repo: string, state: StarState, words: string, phase: LanePhase | null = null) => {
    if (out.has(repo)) return;
    const heat = acc.repos[repo] ?? null;
    out.set(repo, {
      repo,
      name: repoShort(repo),
      state,
      words,
      phase,
      ahead: null,
      landings: heat?.landings ?? 0,
      map: heat && heat.files.length > 0 && !shown.has(repo) ? heat : null,
    });
  };
  for (const l of laneOfRepo(pulse.lanes)) {
    if (l.phase === "done") continue;
    if (l.phase === "queued") put(l.repo, "queued", "queued for a slot");
    else put(l.repo, "working", lanePhaseLabel(l.phase).toLowerCase(), l.phase);
  }
  for (const w of pulse.waiting) put(w, "waiting", "waiting for a slot");
  for (const r of pulse.runner?.repos ?? []) {
    if (r.paused === "dry-backoff") {
      const until = fmtClock(r.pausedUntil);
      put(r.repo, "resting", until ? `resting · wakes ${until}` : "resting after dry runs");
    } else if (r.paused) put(r.repo, "paused", PAUSE_WORDS[r.paused]?.(r) ?? "paused");
    else put(r.repo, "seen", "between runs");
    const star = out.get(r.repo);
    if (star) star.ahead = r.aheadOfBase;
  }
  for (const h of Object.values(acc.repos)) {
    const ago = h.lastTouchAt != null ? `last touch ${fmtDuration(Math.max(0, now - h.lastTouchAt))} ago` : "between runs";
    put(h.repo, "seen", ago);
  }
  return [...out.values()].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
}
