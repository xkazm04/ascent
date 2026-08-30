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
// The economics shapes come from the PURE fold (no Prisma, no node built-ins), for the same reason
// the records do: a second client-side copy is how a field silently stops arriving.
import type { LaneEconomics, PriceRow, RemediationPriceList } from "@/lib/local/lane-economics";
import type { LaneBriefProvenance } from "@/lib/org/lane-brief";
import type { LaneOutcomeRow } from "@/lib/db/lane-outcomes";
import type { LoopLessonRow } from "@/lib/db/loop-lessons";
import type {
  LoopLaneExecutor,
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
  LaneBriefProvenance,
  LaneEconomics,
  LaneOutcomeRow,
  LoopLessonRow,
  PriceRow,
  RemediationPriceList,
  LoopLaneExecutor,
  LoopLaneKind,
  LoopLaneOutcome,
  LoopLaneRecord,
  LoopLanePhase,
  LoopRunDetail,
  LoopRunPhase,
  LoopRunRecord,
  LoopRunSummary,
};

/** The one-word chip a lane's executor renders as. `null` for `local`, which needs none — the local
 *  lane is what every row on a self-hosted board already is, and a chip on all of them says nothing.
 *  Same rule `laneKindTag` follows, for the same reason. */
export const laneExecutorTag = (executor: LoopLaneExecutor): string | null =>
  executor === "remote-agent" ? "agent" : null;

/**
 * A lease countdown, in the coarsest unit that is still true. Pure so the rail can render it without
 * a clock of its own and a test can pin it.
 *
 * `null` in, `null` out — and that is not "expired". A lane with no lease is one nobody has claimed
 * into yet; rendering it as `0m` would say an agent's time had run out when no agent ever started.
 */
export function leaseCountdown(leaseUntil: string | null, now: Date = new Date()): string | null {
  if (!leaseUntil) return null;
  const ms = Date.parse(leaseUntil) - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "lease expired";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `lease ${Math.max(1, mins)}m`;
  return `lease ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** One repo's proposed lane batch — GET /api/org/loop/propose. */
export interface LoopProposal {
  repo: string;
  items: FollowUpItem[];
  projectedPoints: number;
  kind: LoopLaneKind;
  practiceId: string | null;
  reason: string;
  /** The brief this lane WOULD get — same assembly the engine runs, so the preview and the dispatch
   *  cannot diverge. `null` on a foundation lane, which has no batch to brief about. */
  brief?: { text: string; provenance: LaneBriefProvenance } | null;
}

/** The one-word tag a lane's kind renders as, everywhere. `null` for the default agent lane, which
 *  needs no tag — a badge on every row would say nothing. */
export const laneKindTag = (kind: LoopLaneKind): string | null =>
  kind === "foundation"
    ? ".ai/ foundation"
    : kind === "practice"
      ? "practice starter"
      : kind === "craft"
        ? "craft rung"
        : null;

/** GET /api/org/loop?org=… */
export interface LoopStatusPayload {
  enabled: boolean;
  active: LoopRunRecord | null;
  runs: LoopRunSummary[];
  /** The org's remediation price list, derived at read time. `null` when there is no database or the
   *  read failed — which is "unknown", not "nothing has been priced". */
  prices?: RemediationPriceList | null;
}

/** A run is DRIVING something (the poll runs) versus at rest (no timer at all). */
export const isRunLive = (phase: LoopRunPhase | null | undefined): boolean =>
  phase === "running" || phase === "curating";

/** The three modes the right rail switches between. */
export type CockpitMode = "inspect" | "run" | "outcome";
