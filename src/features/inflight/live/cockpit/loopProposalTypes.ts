// The CURATION step's wire shape: what GET /api/org/loop/propose hands the cockpit, and the tag a lane
// kind renders as. Split out of `loopTypes.ts` (which re-exports both, so no call site changes) when
// that file reached the 200-line cap and the proposal gained its pairing verdict.
//
// Type-only imports from server modules, for the reason `loopTypes.ts` gives: one declaration, so a
// field cannot silently stop arriving, and nothing server-side is pulled into the bundle.

import type { FollowUpItem } from "@/lib/org/followups";
import type { LaneBriefProvenance } from "@/lib/org/lane-brief";
import type { LoopLaneKind } from "@/lib/db/loop-runs-types";
import type { ProposalPairing } from "@/lib/local/pairing-health";

export type { ProposalPairing };

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
  /** Does the stored pairing still verify (the engine's own `verifyLocalPath`)? `{ok:false}` is a
   *  moved or deleted checkout: no items, and the verifier's sentence. Absent/null = no stored path,
   *  or an older server; either way the `paired` set decides, as it always did. */
  pairing?: ProposalPairing | null;
}

/** True when the proposal says its stored pairing no longer verifies. */
export const pairingBroken = (p: Pick<LoopProposal, "pairing">): boolean => p.pairing?.ok === false;

/** The one-word tag a lane's kind renders as, everywhere. `null` for the default agent lane, which
 *  needs no tag — a badge on every row would say nothing. */
export const laneKindTag = (kind: LoopLaneKind): string | null =>
  kind === "foundation"
    ? ".ai/ foundation"
    : kind === "practice"
      ? "practice starter"
      : kind === "craft"
        ? "craft rung"
        : kind === "direction"
          ? "approved direction"
          : null;
