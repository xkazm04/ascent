// Pure view helpers for the admission column (moonshot #8). No hooks, no JSX — server-safe, and the
// SINGLE source for the vocabulary every admission surface renders, so the column, the override
// control and the dry-run modal cannot drift into describing the same row three ways.

import type { AdmissionMode, RepoAdmissionRow } from "@/lib/org/admission";
import type { AutonomyTierId } from "@/lib/types";

export const MODE_HEX: Record<AdmissionMode, string> = {
  "agents-allowed": "#22c55e",
  "assisted-only": "#f97316",
  blocked: "#ef4444",
};

/** What each mode PERMITS, phrased as the decision an owner is making — never as jargon. */
export const MODE_META: Record<AdmissionMode, { label: string; blurb: string }> = {
  "agents-allowed": { label: "Agents allowed", blurb: "An autonomous agent may open work here." },
  "assisted-only": { label: "Assisted only", blurb: "A human drives; AI assists. No unattended runs." },
  blocked: { label: "Blocked", blurb: "No AI-attributed change may land here." },
};

/** One row as the column renders it. `tier` is null when nothing was assessed — never defaulted. */
export interface AdmissionView {
  fullName: string;
  name: string;
  mode: AdmissionMode;
  tier: AutonomyTierId | null;
  /** Whether a PERSON decided this, or it is still the seed copied from the derived tier. */
  decided: boolean;
  decidedBy: string | null;
  /** The measurement the grant departs from, when it does. Null when they agree or none was made. */
  overridesDerived: AutonomyTierId | null;
  /** The decision was recorded against an older stance version — recompiled, but not re-affirmed. */
  stale: boolean;
  rulesetId: string | null;
  /**
   * No tier was assessed AND nobody has decided — so nothing is recorded for this repository and the
   * gate applies no admission bar to it (`getRepoAdmission` returns null; the overlay is `{}`).
   *
   * It is a distinct state from "assisted-only", not a shade of it. The list now renders every repo
   * the org tracks, including ones no scan has produced a passport for, and painting those with the
   * middle rung's label would claim a bar the gate does not enforce — on the one surface whose whole
   * job is keeping a measurement apart from a decision.
   */
  unassessed: boolean;
}

/**
 * Project the API's rows into the view, newest-decision-first within a stable name order.
 *
 * `activeStanceVersion` is passed in rather than read per row: staleness must be computed against ONE
 * number both halves of the page agree on, which is exactly why the GET returns it alongside.
 */
export function toAdmissionViews(rows: RepoAdmissionRow[], activeStanceVersion: number | null): AdmissionView[] {
  return rows
    .map((r) => ({
      fullName: r.repoFullName,
      name: r.repoFullName.split("/").pop() ?? r.repoFullName,
      mode: r.mode,
      // The honest null, enforced at the view layer too: a grant is only meaningful where a tier was
      // assessed. Rendering `grantedTier` for an unassessed repo would show a grade nobody measured.
      tier: r.derivedTier ? r.grantedTier : null,
      decided: r.decidedBy !== null,
      decidedBy: r.decidedBy,
      overridesDerived: r.derivedTier && r.derivedTier !== r.grantedTier ? r.derivedTier : null,
      stale: activeStanceVersion !== null && r.stanceVersion < activeStanceVersion,
      rulesetId: r.rulesetId,
      unassessed: r.derivedTier === null && r.decidedBy === null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * The one-line summary above the column. States the counts a fleet owner actually asks for.
 *
 * The EMPTY STATE is now about repositories, not decisions. The list is the org's tracked repo set,
 * so an empty one means the org tracks nothing at all — the old sentence ("no repository has an
 * admission decision yet") described a list that no longer exists, and it was shown to every org
 * whose repos simply had no rows seeded, next to no affordance for making the first decision.
 */
export function admissionSummary(views: AdmissionView[]): string {
  if (views.length === 0) return "This organization tracks no repositories yet — connect or scan one to admit it.";
  const blocked = views.filter((v) => v.mode === "blocked").length;
  const allowed = views.filter((v) => !v.unassessed && v.mode === "agents-allowed").length;
  const unassessed = views.filter((v) => v.unassessed).length;
  const undecided = views.filter((v) => !v.decided && !v.unassessed).length;
  const parts = [`${views.length} repositor${views.length === 1 ? "y" : "ies"}`];
  if (allowed) parts.push(`${allowed} admit agents`);
  if (blocked) parts.push(`${blocked} blocked`);
  // Said plainly rather than folded into the counts: a seed is not a decision, and a fleet where
  // nobody has decided anything must not read as a fleet that decided "assisted-only".
  if (undecided) parts.push(`${undecided} still on the seeded default — nobody has decided`);
  // Counted apart from the undecided: "nobody has decided" and "there is nothing to decide against
  // yet" are different problems with different fixes (record a decision vs scan the repo).
  if (unassessed) parts.push(`${unassessed} not assessed — no bar applies`);
  return parts.join(" · ") + ".";
}
