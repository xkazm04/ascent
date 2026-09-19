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
// The delivery vocabulary, re-exported for the same reason the records are: ONE declaration, so a
// mode cannot quietly mean two things on the two sides of the wire.
export { deliveryTag } from "@/lib/local/delivery-options";
// The guard's vocabulary, re-exported for the same reason: ONE declaration of what `rejected` means,
// so the word on a lane row and the word the engine wrote cannot drift apart.
export { verifyVerdictTag } from "@/lib/local/verify-options";
import type { VerifyVerdict } from "@/lib/local/verify-options";
import type { LoopDelivery } from "@/lib/local/delivery-options";
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
  VerifyVerdict,
  LoopDelivery,
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
 * WHAT ENGINE PRODUCED A RUN'S WORK — the fact the outcome ledger's column header was missing beside
 * `agentConfig` (MC-B44). `opus · high effort` names a MODEL; it does not say who ran it, and the two
 * populations on this board are not comparable in the same way.
 *
 * Derived, never stored: the engine is a function of each lane's `executor`, which is recorded today.
 *   - `local` — Ascent spawned the session itself, and `src/lib/local/agent.ts` has exactly one way to
 *     do that: `CLAUDE_CLI_PATH || "claude"`, headless. The usage meter stamps the same population
 *     `provider: "claude-cli"` (`lane-cost.ts`), so this is the ledger's own word, not a new claim. A
 *     lane written before the column reads `local` by the documented default, which is what it was.
 *   - `remote-agent` — Ascent started no process and opened no worktree; some agent elsewhere pulled
 *     the lane over MCP. Its engine is genuinely NOT OURS TO REPORT, so the label says who ran it and
 *     stops there. The run row's armed `model` is what Ascent asked for, not what the claimant used.
 *
 * A run with no lanes returns null and the header renders NOTHING — never a guess, and never
 * "claude CLI" by default, which is the mistake this label exists to stop being made silently.
 */
export function runEngineLabel(lanes: readonly { executor: LoopLaneExecutor }[]): string | null {
  if (lanes.length === 0) return null;
  const remote = lanes.filter((l) => l.executor === "remote-agent").length;
  if (remote === 0) return "claude CLI";
  if (remote === lanes.length) return "remote agent";
  // A mixed run is not describable by either word, and picking the majority would print a
  // half-truth about the other lanes. It says it is mixed and sends the reader to the rails.
  return "mixed engines";
}

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
  /** Can this deployment open a pull request at all (is a GitHub App configured)? The delivery dial
   *  disables its `pr` option and says why when this is false — and the route refuses it anyway, so
   *  the disabled control is a courtesy rather than the enforcement. Absent = assume it can, which is
   *  what every payload written before this field meant. */
  prAvailable?: boolean;
  /** A stop has been REQUESTED on `active` and has not taken effect yet. The loop's stop is
   *  cooperative — in-flight lanes finish the phase they are in — so this is a real, sometimes
   *  long-lived state and not a spinner on the button's own fetch. Absent = not answered, which the
   *  cockpit reads as `false` (exactly what every payload before this field meant). */
  stopping?: boolean;
  /** The RESOLVED per-session ceiling of the active run, in ms — the outer bound on how long a
   *  requested stop can take. Server-resolved, because the deployment's `ASCENT_AUTOPILOT_TIMEOUT_MS`
   *  is not a fact a browser can know. `null` when there is no active run. */
  stopHorizonMs?: number | null;
}

/**
 * "Stopping… in-flight lanes finish their session (up to 20 min)". Pure, so the caption is testable
 * and the two places that could phrase it differently cannot.
 *
 * `null` horizon prints the sentence WITHOUT a bound rather than inventing one: "we do not know how
 * long" is a different statement from "up to 20 minutes", and the second one being wrong is the whole
 * defect this caption exists to fix (PRIYA-L2-C6 measured 19m43s against a button that said nothing).
 */
export function stoppingCaption(horizonMs: number | null | undefined): string {
  const base = "Stopping — in-flight lanes finish their current session first";
  if (horizonMs == null || !Number.isFinite(horizonMs) || horizonMs <= 0) return `${base}.`;
  const mins = Math.max(1, Math.round(horizonMs / 60_000));
  return `${base}, up to ${mins} min.`;
}

/** A run is DRIVING something (the poll runs) versus at rest (no timer at all). */
export const isRunLive = (phase: LoopRunPhase | null | undefined): boolean =>
  phase === "running" || phase === "curating";

/** The three modes the right rail switches between. */
export type CockpitMode = "inspect" | "run" | "outcome";
