// Every capability claim on /about and /about-org names the capability it rests on.
//
// Six hand corrections (80c1a1fa, 674dfca3, ec7a576f, bb7ee011, 6a497f0f, f02f84aa) fixed the same
// defect: a tab retired in the product while the marketing deck kept selling it, until a reader
// noticed. A claim here carries `anchors`, each one of:
//   { tab }          - an org tab id that RENDERS: a panel or the developer route, never an alias
//                      (an alias like `followups` means the claim still names the retired surface).
//   { route }        - a standalone public route, e.g. "/report" (its existence is checked by the
//                      test, which can read the app directory; this module stays client-safe).
//   { illustrative } - the sentence describes the demo diagram beside it, not a shipping feature.
// The verdict is derived from ORG_TAB_REACH (src/lib/org/orgTabs.ts), never from a hand list, so the
// next retirement or alias breaks the suite on the claim that depended on it.

import { isOrgTabId, orgTabAliasTarget, type OrgTabId } from "@/lib/org/orgTabs";

export type ClaimAnchor = { tab: OrgTabId } | { route: string } | { illustrative: true };

export interface AnchoredClaim {
  text: string;
  anchors: ClaimAnchor[];
  /** A claim about the demo itself may carry no anchor, but only when it says so. */
  illustrative?: true;
}

export type AnchorVerdict = { ok: true } | { ok: false; reason: string };

export function resolveClaimAnchor(anchor: ClaimAnchor): AnchorVerdict {
  if ("illustrative" in anchor) {
    return anchor.illustrative === true ? { ok: true } : { ok: false, reason: "illustrative must be true" };
  }
  if ("route" in anchor) {
    const r = anchor.route;
    if (!/^\/[a-z0-9\-/]*$/.test(r)) return { ok: false, reason: `route "${r}" is not an absolute app path` };
    if (r === "/org" || r.startsWith("/org/")) {
      return { ok: false, reason: `route "${r}" is an org view: anchor it to its tab id instead` };
    }
    return { ok: true };
  }
  const tab: string = anchor.tab;
  if (!isOrgTabId(tab)) return { ok: false, reason: `"${tab}" is not an org tab` };
  const alias = orgTabAliasTarget(tab);
  if (alias) return { ok: false, reason: `"${tab}" is an alias of ${alias.tab}: anchor the claim to ${alias.tab}` };
  return { ok: true };
}

/** Throws one error naming every claim whose anchors are missing or do not resolve. */
export function assertClaimsAnchored(claims: readonly AnchoredClaim[], source = "claims"): void {
  const failures: string[] = [];
  for (const c of claims) {
    if (c.anchors.length === 0) {
      if (!c.illustrative) failures.push(`unanchored claim: "${c.text}"`);
      continue;
    }
    for (const a of c.anchors) {
      const v = resolveClaimAnchor(a);
      if (!v.ok) failures.push(`claim "${c.text}": ${v.reason}`);
    }
  }
  if (failures.length > 0) throw new Error(`${source}: ${failures.join("; ")}`);
}

/** A rendered feature section's claims: its body and each point, paired with their anchors. */
export interface AnchoredFeature {
  body: string;
  points: string[];
  anchors: { body: ClaimAnchor[]; points: ClaimAnchor[][] };
}

export function featureClaims(f: AnchoredFeature): AnchoredClaim[] {
  return [
    { text: f.body, anchors: f.anchors.body },
    ...f.points.map((text, i) => ({ text, anchors: f.anchors.points[i] ?? [] })),
  ];
}
