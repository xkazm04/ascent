// "Who issued this claim?" — the passport's one honest answer, in one place.
//
// Criticality, lifecycle and tested-rollback are the three fields a scan CANNOT observe: an owner
// asserts them, `applyPassportOverrides` folds them into the passport at read time, and from that
// point on an asserted "GA · mission-critical" rendered exactly like an observed one. Declines have
// always carried their provenance (an `at` and a re-confirmation cycle); these three carried none
// outside the edit form, so the card presented an owner's assertion in the same voice as a
// measurement — the thing the readiness-passports standard says an artifact must never do.
//
// Booleans, no dates: `parsePassportOverrides` keeps no timestamp for the identity fields (only a
// decline records `at`). The cue therefore says WHO, and does not invent a WHEN.
//
// Server-safe (no hooks, no handlers) so the report card and the owner form can share it.

import type { PassportOwnerSet } from "@/lib/db/org-rollup";

export type { PassportOwnerSet };

export const OWNER_SET_LABEL = "owner-set";
export const OWNER_SET_TITLE =
  "Asserted by this repo's owner, not observed by the scan. A scan cannot see criticality, lifecycle or whether a rollback has actually been tested.";
export const SCAN_OBSERVED_LABEL = "scan-observed";

/** The inline provenance mark. Sits directly after the value it qualifies. */
export function OwnerSetCue({ className = "" }: { className?: string }) {
  return (
    <span
      title={OWNER_SET_TITLE}
      className={`ml-1 rounded border border-divider px-1 type-label tracking-wider text-slate-500 ${className}`}
    >
      {OWNER_SET_LABEL}
    </span>
  );
}

/** The form's per-field answer: is the value in this control the owner's assertion, or what the scan
 *  saw? The edit form used to echo the stored value with no way to tell the two apart, which made
 *  "unset" and "the scan observed this" look identical. */
export function FieldProvenance({ ownerSet }: { ownerSet?: boolean }) {
  return ownerSet ? (
    <span title={OWNER_SET_TITLE} className="type-label tracking-wider text-accent">
      {OWNER_SET_LABEL}
    </span>
  ) : (
    <span
      title="No owner assertion on record for this field — what you see is what the scan observed (or nothing, if it could not observe it)."
      className="type-label tracking-wider text-slate-600"
    >
      {SCAN_OBSERVED_LABEL}
    </span>
  );
}
