// The cockpit's WIRE shapes — what the three loop routes actually hand a browser.
//
// The run/lane/detail records are re-exported straight from the server's own type module
// (`@/lib/db/loop-runs-types`) rather than restated here: a second, "equivalent" client copy is the
// classic way a field silently stops arriving. The import is type-only, so nothing server-side is
// pulled into the bundle.
//
// `LoopProposal` and `LoopStatusPayload` are the two shapes that exist ONLY as route responses (the
// propose route composes the first; the GET status route composes the second), so they are declared
// here — the routes' own declarations live next to `export const runtime`, which a client module has
// no business importing from.

import type { FollowUpItem } from "@/lib/org/followups";
import type {
  LoopLaneKind,
  LoopLaneOutcome,
  LoopLaneRecord,
  LoopLanePhase,
  LoopRunDetail,
  LoopRunPhase,
  LoopRunRecord,
  LoopRunSummary,
} from "@/lib/db/loop-runs-types";

export type {
  FollowUpItem,
  LoopLaneKind,
  LoopLaneOutcome,
  LoopLaneRecord,
  LoopLanePhase,
  LoopRunDetail,
  LoopRunPhase,
  LoopRunRecord,
  LoopRunSummary,
};

/** One repo's proposed lane batch — GET /api/org/loop/propose. */
export interface LoopProposal {
  repo: string;
  items: FollowUpItem[];
  projectedPoints: number;
  kind: LoopLaneKind;
  practiceId: string | null;
  reason: string;
}

/** The one-word tag a lane's kind renders as, everywhere. `null` for the default agent lane, which
 *  needs no tag — a badge on every row would say nothing. */
export const laneKindTag = (kind: LoopLaneKind): string | null =>
  kind === "foundation" ? ".ai/ foundation" : kind === "practice" ? "practice starter" : null;

/** GET /api/org/loop?org=… */
export interface LoopStatusPayload {
  enabled: boolean;
  active: LoopRunRecord | null;
  runs: LoopRunSummary[];
}

/** A run is DRIVING something (the poll runs) versus at rest (no timer at all). */
export const isRunLive = (phase: LoopRunPhase | null | undefined): boolean =>
  phase === "running" || phase === "curating";

/** The three modes the right rail switches between. */
export type CockpitMode = "inspect" | "run" | "outcome";
