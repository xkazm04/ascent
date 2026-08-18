// The four autonomy tiers — what a human may delegate at each level, and the shared color anchor.
// Extracted from autonomyModel.ts (which re-exports every name here, so no call site changes); see
// that file's header for the scan/derived/mock honesty contract the surface as a whole carries.

import { scoreHex } from "@/lib/ui";

// ── tiers ───────────────────────────────────────────────────────────────────────────────────────

export type AutonomyTier = 0 | 1 | 2 | 3;

export const TIERS: AutonomyTier[] = [0, 1, 2, 3];

export interface TierMeta {
  id: AutonomyTier;
  code: string;
  label: string;
  /** What a human may actually delegate at this tier. */
  grant: string;
  /** The single sentence a lead needs to act on it. */
  blurb: string;
  /** Anchor score used ONLY to pull a color off the shared red→green ramp (never a hand-picked hex). */
  anchor: number;
}

export const TIER_META: Record<AutonomyTier, TierMeta> = {
  0: {
    id: 0,
    code: "T0",
    label: "Observe only",
    grant: "Read, explain, review. No writes.",
    blurb: "The agent can answer questions about this repo. Nothing it produces should be merged unread.",
    anchor: 22,
  },
  1: {
    id: 1,
    code: "T1",
    label: "Tests & docs",
    grant: "Agent-authored tests, docs, comments; human merges.",
    blurb: "A real test loop exists, so an agent's tests and docs can be checked before they land.",
    anchor: 52,
  },
  2: {
    id: 2,
    code: "T2",
    label: "Refactors with review",
    grant: "Behaviour-preserving refactors and small features, reviewed PRs only.",
    blurb: "Gated CI plus a reproducible environment means a bad refactor is caught by the machine first.",
    anchor: 74,
  },
  3: {
    id: 3,
    code: "T3",
    label: "Scheduled autonomous",
    grant: "Unattended, scheduled agent runs opening their own PRs.",
    blurb: "Context contract, guardrails and gates are strong enough that nobody has to be watching.",
    anchor: 93,
  },
};

export const tierHex = (t: AutonomyTier): string => scoreHex(TIER_META[t].anchor);
