// THE ONE PHASE VOCABULARY every surface maps from (spark theater-upgrade, 2026-09-18; WP4).
//
// Derived — never stored — from the lane's persisted phase/stage plus its recent activity
// (`streaming-output/phase-derivation`): a Read/Grep/Glob tail reads as `agent-reading`, an Edit/Write as
// `agent-editing`, assistant text or any other tool as `agent-thinking`; a SPECIFIC agent phase whose
// newest evidence is older than `PHASE_QUIET_MS` decays to `agent-quiet` ("still working, quiet for Nm"),
// never freezes. Presentation only: program logic branches on typed lane state, never on this label.
//
// THE HONESTY RULES, as code:
//   • Quiet is PRESENCE, never progress. `agent-quiet` says "we have not heard from it for N minutes";
//     it is not a failure (long silences that resume are the common case) and not a percentage.
//   • An event older than the lane's current `stageAt` belongs to an earlier stage (the planning session
//     that came before the baseline, say) and cannot name the current agent phase — the stage started
//     after it. With no event inside the stage the phase is the generic `agent-thinking`, never the
//     previous label carried across.
//   • Unknown input derives the generic phase.
//
// DEPENDENCY-FREE: the pulse read computes it on the server and the theater may recompute it in the
// browser against its own clock.

import { PHASE_QUIET_MS, type LaneActivity, type LanePhase } from "@/lib/local/runner-types";

export interface PhaseInput {
  /** `LoopRunLane.phase` — queued | dispatching | rescanning | done | error. */
  phase: string;
  /** `LoopRunLane.stage` — planning | verifying | installing | fetch … compose | null. */
  stage: string | null;
  tail: readonly LaneActivity[];
  heartbeatAt: string | null;
  /** The arm's dated band, when this lane is a local transport: the quiet ceiling is the arm's, not the
   *  hosted one (a local 27B is the transport's clock, not the API's). Absent, the build default of
   *  `PHASE_QUIET_MS` applies. */
  quietMs?: number;
  /** True when the lane's delivery was held (fence, install). */
  held?: boolean;
  /** `LoopRunLane.stageAt` — when the lane entered its current phase/stage. Scopes which events may
   *  name the agent phase, and floors the quiet clock (a stage that just began is not "quiet"). */
  stageAt?: string | null;
  /** True when this cycle opened with a planning session (`planId` set). Lets a `verifying` stage with
   *  one read-only session behind it read as the BASELINE rather than the result check. */
  planned?: boolean;
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** The newest evidence of life the lane carries — its newest tail event, its heartbeat, the start of its
 *  current stage — as epoch ms, or null when it carries none at all. */
export function newestEvidenceMs(input: Pick<PhaseInput, "tail" | "heartbeatAt" | "stageAt">): number | null {
  const all = [...input.tail.map((e) => ms(e.at)), ms(input.heartbeatAt), ms(input.stageAt)];
  const known = all.filter((t): t is number => t != null);
  return known.length > 0 ? Math.max(...known) : null;
}

/** How long the lane has been silent at `now`, or null when it carries no evidence to measure from. */
export function laneQuietForMs(input: Pick<PhaseInput, "tail" | "heartbeatAt" | "stageAt">, now: number): number | null {
  const newest = newestEvidenceMs(input);
  return newest == null ? null : Math.max(0, now - newest);
}

/**
 * Has an EXECUTION session already run in this cycle? Only the tail can say (the lane row does not), so:
 * an edit or write (the planning session is read-only), a second session's `result`, or — on a lane that
 * did not plan — any finished session at all. The one case it cannot see is a planned lane whose
 * execution session edited nothing and whose planning events have scrolled out of the tail; that reads
 * as the baseline. A distinct `stage: "baseline"` from the lane would make this exact.
 */
function executionRan(tail: readonly LaneActivity[], planned: boolean | undefined): boolean {
  let results = 0;
  for (const e of tail) {
    if (e.kind === "edit" || e.kind === "write") return true;
    if (e.kind === "result") results += 1;
  }
  return results >= 2 || (results >= 1 && planned === false);
}

export function deriveLanePhase(input: PhaseInput, now: number): LanePhase {
  if (input.held) return "held";
  if (input.phase === "queued") return "queued";
  if (input.phase === "rescanning") return "rescanning";
  if (input.phase === "done") return "done";
  if (input.phase === "error") return "error";
  switch (input.stage) {
    case "planning":
      return "planning";
    case "baseline":
      return "baseline";
    case "verifying":
      return executionRan(input.tail, input.planned) ? "verifying" : "baseline";
    case "installing":
      return "installing";
    case "committing":
      return "committing";
    case "landing":
      return "landing";
    default:
      break;
  }
  // The agent's own stretch. Quiet first: a specific claim with stale evidence is the lie this exists
  // to prevent — and the clock is the ARM's, not the build default's.
  const quiet = laneQuietForMs(input, now);
  if (quiet != null && quiet > (input.quietMs ?? PHASE_QUIET_MS)) return "agent-quiet";
  // The tail is newest-last, so the only candidate is its last event — and only when it happened inside
  // the current stage.
  const since = ms(input.stageAt);
  const last = input.tail[input.tail.length - 1];
  const inStage = last && (since == null || (ms(last.at) ?? Number.NEGATIVE_INFINITY) >= since) ? last : null;
  switch (inStage?.kind) {
    case "read":
    case "search":
      return "agent-reading";
    case "edit":
    case "write":
      return "agent-editing";
    default:
      return "agent-thinking";
  }
}

const LABEL: Record<LanePhase, string> = {
  queued: "Queued",
  planning: "Planning",
  baseline: "Checking the baseline",
  "agent-reading": "Reading the code",
  "agent-editing": "Editing",
  "agent-thinking": "Thinking",
  "agent-quiet": "Still working",
  verifying: "Checking the build",
  installing: "Installing dependencies",
  committing: "Committing",
  landing: "Landing",
  rescanning: "Rescanning",
  held: "Held for review",
  done: "Done",
  error: "Failed",
};

/** A silence, in the coarse words a passive screen needs: "45s", "3m", "1h 20m". */
export function fmtQuiet(quietMs: number): string {
  const s = Math.max(0, Math.floor(quietMs / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** The words a surface prints for a phase. `quietForMs` only matters for `agent-quiet`. */
export function lanePhaseLabel(phase: LanePhase, quietForMs: number | null = null): string {
  if (phase === "agent-quiet") {
    return quietForMs != null && Number.isFinite(quietForMs) ? `Still working — quiet for ${fmtQuiet(quietForMs)}` : "Still working — quiet";
  }
  return LABEL[phase] ?? "Working";
}
