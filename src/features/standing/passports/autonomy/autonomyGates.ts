// The gate vocabulary — the shape every autonomy gate reports in, the render order, and the two
// scoring primitives the per-gate derivations share. Extracted from autonomyModel.ts (which
// re-exports the public names, so no call site changes); the gate derivations themselves live in
// autonomyGateBuilders.ts. The `source` field is the honesty contract: see autonomyModel.ts's header.

import type { AutonomyTier } from "./autonomyTiers";

// ── gates ───────────────────────────────────────────────────────────────────────────────────────

export type GateId = "tests" | "ci" | "sandbox" | "context" | "hooks";
export type GateStatus = "pass" | "partial" | "fail";
export type GateSource = "scan" | "derived" | "mock";

export interface AutonomyGate {
  id: GateId;
  /** Full name for headings. */
  label: string;
  /** 3–7 char mono token for dense boards. */
  short: string;
  status: GateStatus;
  /** 0–100, colored through `scoreHex` like every other score in the app. */
  score: number;
  /** What the scan actually saw, verbatim-ish. */
  evidence: string;
  /** The one action that moves this gate up. */
  action: string;
  source: GateSource;
  /** Tier this gate first becomes mandatory for. */
  gatesTier: AutonomyTier;
}

export const GATE_ORDER: GateId[] = ["tests", "ci", "sandbox", "context", "hooks"];

export const TEST_RANK = ["none", "smoke", "partial", "substantial", "comprehensive"];
export const CI_RANK = ["none", "build", "checks", "gated", "delivery", "progressive"];
export const SEC_RANK = ["none", "policy", "scanning", "gated", "supply-chain"];

export const statusOf = (score: number): GateStatus => (score >= 70 ? "pass" : score >= 40 ? "partial" : "fail");

/** Stable pseudo-random 0..1 from a string — mock gates must not flicker between renders. */
export function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
