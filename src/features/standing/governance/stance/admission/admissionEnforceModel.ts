// Pure decisions behind the per-row Enforce panel (moonshot #8 follow-up "proposal dry-run modal
// UI", MC-X3). No hooks, no JSX. Which compiled controls a row can open, the typed-confirm test the
// ruleset route makes, and the digest that ties a confirmed CODEOWNERS PR to the diff that was shown.

import { renderRulesetProposal } from "@/lib/org/admission";
import { artifactFingerprint } from "@/lib/practices/fingerprint";
import type { AdmissionView } from "./admissionRows";

export type RulesetAction = "none" | "apply" | "revert";

export interface EnforceActions {
  codeowners: { available: true } | { available: false; reason: string };
  ruleset: RulesetAction;
  /** Why `ruleset` is "none", in the words the panel shows. */
  rulesetReason?: string;
}

/**
 * What the row may offer. Mirrors the routes' own refusals so the panel does not dangle a button the
 * server will answer with a 400:
 *  • An unassessed tier compiles nothing (the propose route refuses a repo with no admission row).
 *  • One Ascent ruleset per repo: a stored id means revert, never a second apply. A stored id stays
 *    revertable whatever the tier says, because a control that cannot be undone from the surface
 *    that created it is the failure the ruleset route's header names.
 *  • A tier/mode that compiles no ruleset (T2/T3 with agents allowed) offers none, with the reason.
 */
export function enforceActions(view: AdmissionView): EnforceActions {
  const codeowners: EnforceActions["codeowners"] =
    view.tier === null ? { available: false, reason: "tier not assessed" } : { available: true };
  if (view.rulesetId) return { codeowners, ruleset: "revert" };
  if (view.unassessed || view.tier === null) {
    return { codeowners, ruleset: "none", rulesetReason: "Tier not assessed, so the stance compiles no ruleset for this repository." };
  }
  if (!renderRulesetProposal(view.fullName, view.tier, view.mode)) {
    return { codeowners, ruleset: "none", rulesetReason: `${view.tier} with this mode compile no ruleset: nothing to apply.` };
  }
  return { codeowners, ruleset: "apply" };
}

/** The ruleset route's typed confirm: the literal full name, case and whitespace included
 *  (`body.confirm !== repo`). The button waits for exactly what the server will accept. */
export function typedConfirmReady(typed: string, fullName: string): boolean {
  return typed === fullName;
}

/** Reviewing teams typed as "@org/team, @org/other". Order kept, blanks and repeats dropped; the
 *  route shape-checks each entry, so this only splits. */
export function parseOwners(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

/** The digest of the diff text the panel RENDERED, sent back as `expectDiffDigest`. Same function
 *  the writer applies to the diff it is about to commit, so a mismatch means the file moved. */
export function previewDigest(diff: string): string {
  return artifactFingerprint(diff);
}
