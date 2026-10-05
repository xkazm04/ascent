// Row model for the Briefing tab's issued-share-link inventory. Pure: no React, no fetch, so the
// honesty rules below are testable without a DOM (shareLinkRows.test.ts).
//
// Every rule here is a rule about ABSENCE, because that is where a list of capabilities lies:
//
//  - A mint row that recorded no expiry is NOT expired. The data layer already refuses to call it
//    expired (org-share.ts), and this layer refuses too, because an owner told "expired" about a link
//    that may still open stops revoking it - the one answer this panel must never give.
//  - Revoked outranks expired. Both are inert, but only one was somebody's decision, and an owner
//    auditing what the org has published needs to tell "we killed this" from "it timed out".
//  - Zero opens is phrased, never printed. "0 opens" reads as a healthy number; "Not opened yet" reads
//    as the absence it is (the same rule the Impact Ledger holds for unverified points).

import type { BriefingShareGrant } from "@/lib/db/org-share";

export type ShareLinkStatus = "live" | "expired" | "revoked";

export interface ShareLinkRow {
  /** The grant's identity and the handle a revoke call names. */
  jti: string;
  status: ShareLinkStatus;
  /** The word shown to the owner. Distinct per status by construction. */
  statusLabel: string;
  /** Raw ISO, kept so a caller can re-sort without re-deriving. */
  mintedAt: string;
  mintedAtLabel: string;
  /** The minting owner's login, or a sentence saying the deployment binds none. */
  mintedByLabel: string;
  scopeLabel: string;
  windowLabel: string;
  expiryLabel: string;
  opensLabel: string;
  /** Only a live grant can be revoked; revoking an inert one is noise, not a control. */
  canRevoke: boolean;
}

/** ISO -> yyyy-mm-dd, locale-free so a row reads the same in every timezone the board sits in. */
function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

function scopeLabel(g: BriefingShareGrant): string {
  if (g.segment && g.stack) return `Segment ${g.segment}, stack ${g.stack}`;
  if (g.segment) return `Segment ${g.segment}`;
  if (g.stack) return `Stack ${g.stack}`;
  return "Whole org";
}

function windowLabel(g: BriefingShareGrant): string {
  const end = day(g.window?.end);
  if (!end) return "Window not recorded";
  const start = day(g.window?.start);
  return start ? `${start} to ${end}` : `All time to ${end}`;
}

function opensLabel(opens: number, lastOpenedAt: string | null): string {
  if (!Number.isFinite(opens) || opens <= 0) return "Not opened yet";
  const unit = opens === 1 ? "time" : "times";
  const last = day(lastOpenedAt);
  return last ? `Opened ${opens} ${unit}, last ${last}` : `Opened ${opens} ${unit}`;
}

const STATUS_LABEL: Record<ShareLinkStatus, string> = {
  live: "Live",
  expired: "Expired",
  revoked: "Revoked",
};

function status(g: BriefingShareGrant): ShareLinkStatus {
  if (g.revoked) return "revoked";
  // The `expiresAt != null` guard is not redundant with the data layer's: a row minted through the
  // optimistic mint path (useShareLinks) is assembled client-side, and a deployment that returns no
  // expiry must not acquire one here by inference.
  if (g.expired && g.expiresAt != null) return "expired";
  return "live";
}

function expiryLabel(g: BriefingShareGrant, s: ShareLinkStatus): string {
  const d = day(g.expiresAt);
  if (!d) return "No recorded expiry";
  return s === "expired" ? `expired ${d}` : `expires ${d}`;
}

/**
 * Grants as the panel renders them, newest first.
 *
 * The endpoint already sorts newest-first, but this re-sorts anyway: an optimistically prepended mint
 * and a server page are two orderings joined client-side, and "newest first" is a promise the panel
 * makes to the reader, not an accident of the read.
 */
export function shareLinkRows(grants: BriefingShareGrant[]): ShareLinkRow[] {
  return [...grants]
    .sort((a, b) => (Date.parse(b.mintedAt) || 0) - (Date.parse(a.mintedAt) || 0))
    .map((g) => {
      const s = status(g);
      return {
        jti: g.jti,
        status: s,
        statusLabel: STATUS_LABEL[s],
        mintedAt: g.mintedAt,
        mintedAtLabel: day(g.mintedAt) ?? "Date not recorded",
        mintedByLabel: g.mintedBy ?? "Minter not recorded",
        scopeLabel: scopeLabel(g),
        windowLabel: windowLabel(g),
        expiryLabel: expiryLabel(g, s),
        opensLabel: opensLabel(g.opens, g.lastOpenedAt),
        canRevoke: s === "live",
      };
    });
}
