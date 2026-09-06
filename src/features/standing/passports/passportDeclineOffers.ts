// What an owner may DECLINE on this passport, derived from the passport itself. Pure (no hooks, no
// IO), so the offer list is testable without a DOM and the control stays layout.
//
// The rule this file exists to enforce: you may only accept a gap the scan actually SAW. The offer list
// is the intersection of (a) the findings open on this passport right now and (b) the overlay's
// declinable allow-list. A finding with no declinable path — the tokenless "enforcement (branch
// protection) not observable" caveat above all — is a limitation of the EVIDENCE, and offering it would
// let an owner silence a blind spot rather than accept a trade-off. "We could not see this" is not a
// decision anyone is entitled to make.
//
// A RE-SURFACED decline (kind changed / severity rose / aged out) keeps its finding open, so it appears
// here again — as a re-confirmation rather than a fresh decline, which is exactly what the overlay is
// asking the owner for.

import { DECLINABLE_BY_FINDING, DECLINABLE_PATHS } from "@/lib/analyze/passport";
import type { AppPassport, FindingSeverity } from "@/lib/types";

export interface DeclineOffer {
  /** The declinable passport field path the PATCH is keyed by. */
  path: string;
  label: string;
  findingId: string;
  /** The cause code + severity AS OF NOW — stored with the decline as the baseline the overlay later
   *  compares against to decide whether the accepted gap still describes this repo. */
  code: string;
  severity: FindingSeverity;
  /** The rendered blocker sentence, for the reader. */
  text: string;
  /** True when this finding is open only because an existing decline was re-surfaced. */
  reconfirm: boolean;
  reconfirmReason?: string;
}

const RANK: Record<FindingSeverity, number> = { critical: 0, block: 1, warn: 2, info: 3 };

/** The declinable findings open on `pp`, worst first. Empty when the scan raised nothing declinable. */
export function declineOffers(pp: AppPassport): DeclineOffer[] {
  const findings = [...(pp.automationReadiness?.findings ?? []), ...(pp.productionReadiness?.findings ?? [])];
  const declined = new Map((pp.declined ?? []).map((d) => [d.path, d]));
  const out: DeclineOffer[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    const path = DECLINABLE_BY_FINDING[f.id];
    if (!path || seen.has(path)) continue; // not declinable (a caveat / an unclassified id), or already offered
    seen.add(path);
    const existing = declined.get(path);
    out.push({
      path,
      label: DECLINABLE_PATHS[path]?.label ?? path,
      findingId: f.id,
      code: f.code,
      severity: f.severity,
      text: f.text,
      reconfirm: Boolean(existing?.needsReconfirm),
      ...(existing?.reconfirmReason ? { reconfirmReason: existing.reconfirmReason } : {}),
    });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.path.localeCompare(b.path));
}
