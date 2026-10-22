// readDeliverableBranding: the ONE door the client-facing deliverables (the board PDF and the
// anonymous share page) read white-label branding through.
//
// 1. Entitlement is re-checked here, not just on write: the brand columns survive a plan downgrade, so
//    applying them unconditionally would keep delivering a paid feature after the org stopped paying.
//    Same rule both call sites applied by hand: planAllowsWhiteLabel(current plan), and an unreadable
//    plan is not an entitlement. Nothing else is read for an org that is not entitled.
// 2. The logo is the stored snapshot (OrgLogoSnapshot) when its sourceUrl matches the saved logo URL:
//    a data URI, so a render makes NO network call to the owner's host and every viewer sees the bytes
//    that were validated. A missing or mismatched snapshot (an org saved before snapshots existed, or a
//    URL changed outside the form) heals once through fetchSafeLogo and is persisted; a failed heal is
//    a negative snapshot not retried for LOGO_NEGATIVE_TTL_MS.
// Never throws: every read degrades (to no branding, or to branding without a logo).

import { getCreditState, getOrgBranding, type OrgBranding } from "@/lib/db";
import { getOrgLogoSnapshot, setOrgLogoSnapshot, type OrgLogoSnapshot } from "@/lib/db/org-logo-snapshot";
import { fetchSafeLogo } from "@/lib/net/logo-fetch";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { degradedRead, noteReadFailure } from "@/lib/org/degraded-read";

/** How long a failed logo fetch is remembered before a render tries the owner's host again. */
export const LOGO_NEGATIVE_TTL_MS = 60 * 60 * 1000;

/** Branding as a deliverable renders it: `logoUrl` is a validated `data:` URI or null, never a remote URL. */
export type DeliverableBranding = OrgBranding;

async function healLogo(org: string, logoUrl: string, surface: string): Promise<string | null> {
  const logo = await fetchSafeLogo(logoUrl);
  const input = logo.ok
    ? { sourceUrl: logoUrl, sha256: logo.sha256, mime: logo.mime, dataUri: logo.dataUri }
    : { sourceUrl: logoUrl, failure: logo.reason };
  await setOrgLogoSnapshot(org, input).catch((err: unknown) => noteReadFailure(`${surface} logo snapshot write`, err));
  return logo.ok ? logo.dataUri : null;
}

function snapshotLogo(snapshot: OrgLogoSnapshot | null, logoUrl: string, nowMs: number): string | null | "heal" {
  if (!snapshot || snapshot.sourceUrl !== logoUrl) return "heal";
  if (snapshot.status === "ok" && snapshot.dataUri) return snapshot.dataUri;
  const age = nowMs - Date.parse(snapshot.fetchedAt);
  return Number.isFinite(age) && age < LOGO_NEGATIVE_TTL_MS ? null : "heal";
}

export interface ReadDeliverableBrandingOptions {
  /** Names the deliverable in degraded-read warnings ("briefing pdf", "briefing share"). */
  surface?: string;
  nowMs?: number;
}

/** The org's branding for a client-facing deliverable, or null when unset / not entitled / unreadable. */
export async function readDeliverableBranding(
  org: string,
  { surface = "deliverable", nowMs = Date.now() }: ReadDeliverableBrandingOptions = {},
): Promise<DeliverableBranding | null> {
  try {
    return await readBranding(org, surface, nowMs);
  } catch (err) {
    noteReadFailure(`${surface} branding door`, err);
    return null;
  }
}

async function readBranding(org: string, surface: string, nowMs: number): Promise<DeliverableBranding | null> {
  const [branding, credit] = await Promise.all([
    getOrgBranding(org).catch(degradedRead(`${surface} branding`, null)),
    getCreditState(org).catch(degradedRead(`${surface} credit state`, null)),
  ]);
  if (!planAllowsWhiteLabel(credit?.plan)) return null;
  if (!branding) return null;
  if (!branding.logoUrl) return branding;

  const snapshot = await getOrgLogoSnapshot(org).catch(degradedRead(`${surface} logo snapshot`, null));
  const cached = snapshotLogo(snapshot, branding.logoUrl, nowMs);
  const logo = cached === "heal" ? await healLogo(org, branding.logoUrl, surface) : cached;
  return { ...branding, logoUrl: logo };
}
