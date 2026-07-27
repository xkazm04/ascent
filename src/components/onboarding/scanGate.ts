// The wizard's ACCESS GATES, as a pure classifier.
//
// POST /api/org/import refuses before the SSE stream ever opens: requireOrgAccess answers 401
// ("Sign in to manage this organization.") for an anonymous caller on a Supabase-configured deploy,
// and 403 ("You don't have access to this organization.") for a signed-in non-member. Those are the
// FINAL click of the advertised free public-org preview funnel (landing hero → try-chips → wizard),
// so the flow used to dead-end on the raw server string with no sign-in affordance anywhere.
//
// This module maps an import failure onto the recovery the user actually needs. It is deliberately
// pure (no React, no fetch) so both the flow hook and its tests can reason about the gate directly.

/** Which recovery the refusal calls for. */
export type ScanGateKind = "signin" | "no-access";

export interface ScanGate {
  kind: ScanGateKind;
  /** The org the wizard was trying to import — used in the gate copy and the dashboard link. */
  org: string;
}

/**
 * Classify a failed import kickoff. Returns a gate when the refusal is an ACCESS decision the wizard
 * can offer a human recovery for, or null when it's a genuine unexpected error (in which case the
 * caller keeps showing the server message — losing a real diagnostic would be worse than a raw string).
 */
export function classifyScanFailure(
  failure: { status?: number; message?: string },
  org: string,
): ScanGate | null {
  if (failure.status === 401) return { kind: "signin", org };
  if (failure.status === 403) return { kind: "no-access", org };
  return null;
}

/** The step title announced (and focused) when a gate replaces the scan — mirrors the phase titles. */
export function gateAnnouncement(gate: ScanGate): string {
  return gate.kind === "signin"
    ? "Sign in to run this scan"
    : `Your account can't scan ${gate.org}`;
}
