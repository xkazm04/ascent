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
export type ScanGateKind = "signin" | "no-access" | "personal";

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
  // Two different 403s land here, in the route's own order: requireOrgAccess (not a member) and then
  // requireFleetOrg (the target is a PERSONAL workspace — the individual tier's lens invariant). Only
  // the second one's message names the internal API route, and only its recovery is /me, so they must
  // not collapse into one gate.
  if (failure.status === 403) {
    return isPersonalRefusal(failure.message) ? { kind: "personal", org } : { kind: "no-access", org };
  }
  return null;
}

/**
 * Does this 403 come from requireFleetOrg (authz.ts)? Its message — "This is a fleet operation.
 * Personal workspaces track repos via /api/me/watch and rescan through the public report flow." —
 * quotes an INTERNAL API ROUTE at an end user, so it must never reach the screen; matching on it here
 * is what lets the wizard replace it with a real handoff. Matched on the two stable phrases rather
 * than the whole sentence so a copy edit server-side degrades to the generic no-access gate (still
 * humane) instead of leaking the raw string.
 */
export function isPersonalRefusal(message?: string): boolean {
  return /fleet operation|personal workspace/i.test(message ?? "");
}

/** The step title announced (and focused) when a gate replaces the scan — mirrors the phase titles. */
export function gateAnnouncement(gate: ScanGate): string {
  if (gate.kind === "signin") return "Sign in to run this scan";
  if (gate.kind === "personal") return `${gate.org} is your personal workspace`;
  return `Your account can't scan ${gate.org}`;
}
