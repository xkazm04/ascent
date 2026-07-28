// GET  /api/billing/autorecharge?org=<slug> -> { pref, chargesAutomatically, source }
// PUT  /api/billing/autorecharge { org, enabled, threshold, packProductId } -> { ok, pref, ... }
//
// The org's opt-in LOW-BALANCE preference: "warn me (and offer a one-click top-up) once my prepaid
// private-scan balance drops to N credits". Read-gated on GET, owner-gated on PUT.
//
// SCOPE, STATED PLAINLY: this does NOT charge anybody. Ascent's Polar integration is a hosted checkout
// redirect plus a signed fulfilment webhook (src/lib/polar.ts, ../checkout, ../webhook) — no stored
// payment method, no customer session, no off-session charge API in use — so there is no way to buy
// credits on the org's behalf while nobody is present. `chargesAutomatically` is therefore returned as a
// constant false, and it is the flag the UI copy hangs off, so the product can never drift into claiming
// an automatic purchase that would silently never happen. See CreditsControl.autorecharge.ts.
//
// PERSISTENCE without a migration: there is no org-settings JSON column on Organization (the closest
// analogue, `gatePolicy`, is a single dedicated TEXT column for one feature), and adding one is a schema
// change. So the preference lives in the append-only AUDIT TRAIL: each PUT writes one
// `billing.autorecharge` entry, and the org's most recent such entry IS the current preference. That
// gives durability, per-org scoping, an actor + timestamp for free (this is a billing-adjacent setting
// an owner changes — a record of who changed it and when is a feature, not overhead), and idempotent
// re-reads. The trade-off is a read via getAuditLog(limit 1) rather than a column select, and history
// that grows by one row per change — negligible for a rarely-touched preference.

import { NextResponse } from "next/server";
import { getAuditLog, isDbConfigured, recordOrgAudit } from "@/lib/db";
import { requireOrgRead, requireOrgRole } from "@/lib/authz";
import { isSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import {
  AUTO_RECHARGE_ACTION,
  AUTO_RECHARGE_CHARGES_AUTOMATICALLY,
  DEFAULT_AUTO_RECHARGE,
  MAX_LOW_BALANCE_THRESHOLD,
  normalizeAutoRecharge,
  type AutoRechargePref,
} from "@/components/org/shared/CreditsControl.autorecharge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The org's stored preference (latest audit entry), or null when it has never been set. Best-effort:
 *  a read failure degrades to "never set" → the DEFAULT (feature OFF), which is the safe direction —
 *  a transient DB blip must not spontaneously enable a nag on a money surface. */
async function readPref(org: string): Promise<AutoRechargePref | null> {
  const page = await getAuditLog(org, { action: AUTO_RECHARGE_ACTION, limit: 1 }).catch(() => null);
  const entry = page?.entries[0];
  return entry ? normalizeAutoRecharge(entry.meta) : null;
}

export async function GET(request: Request) {
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  // No DB → nothing can be stored, but the popover still renders: answer with the default (OFF) rather
  // than a 503 the client would have to special-case.
  if (!isDbConfigured()) {
    return NextResponse.json({
      pref: DEFAULT_AUTO_RECHARGE,
      chargesAutomatically: AUTO_RECHARGE_CHARGES_AUTOMATICALLY,
      source: "default",
    });
  }
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const stored = await readPref(org);
  return NextResponse.json({
    pref: stored ?? DEFAULT_AUTO_RECHARGE,
    chargesAutomatically: AUTO_RECHARGE_CHARGES_AUTOMATICALLY,
    source: stored ? "stored" : "default",
  });
}

export async function PUT(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Saving this preference requires a database." }, { status: 503 });
  }
  // CSRF defense-in-depth, matching the other billing-adjacent mutations.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { org?: string } & Record<string, unknown>;
  const org = typeof body.org === "string" ? body.org.trim() : "";
  if (!org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  // Owner-gated: same tier as the credit grant / plan endpoints — this governs a billing prompt.
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  // Reject an out-of-range threshold LOUDLY instead of silently clamping it: a 400 tells the owner their
  // "0" or "50000" didn't take. normalizeAutoRecharge still clamps on the READ side, where a legacy or
  // hand-edited row has no user to inform.
  if (body.enabled === true) {
    const t = body.threshold;
    if (typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > MAX_LOW_BALANCE_THRESHOLD) {
      return NextResponse.json(
        { error: `threshold must be an integer between 1 and ${MAX_LOW_BALANCE_THRESHOLD}.` },
        { status: 400 },
      );
    }
  }
  const pref = normalizeAutoRecharge(body);
  const actor = await resolveViewerLogin();
  const ok = await recordOrgAudit(AUTO_RECHARGE_ACTION, org, { ...pref }, actor ?? undefined);
  if (!ok) {
    // The audit row IS the storage here, so a failed write is a failed SAVE — never report success, or
    // the owner walks away believing a warning is armed that was never persisted.
    return NextResponse.json({ error: "Couldn't save the preference. Please try again." }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    pref,
    chargesAutomatically: AUTO_RECHARGE_CHARGES_AUTOMATICALLY,
    source: "stored",
  });
}
