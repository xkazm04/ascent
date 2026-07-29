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
// PERSISTENCE (G1-39): the preference lives in `Organization.autoRechargeJson` — a real column, read
// with a column select. It used to live as the most recent `billing.autorecharge` AuditLog row, which
// worked but made the AUDIT TRAIL load-bearing for a user setting: a findMany per read, and any audit
// retention/purge policy could silently erase a customer's configured threshold. The audit row is STILL
// written on every change — as an audit row, which is what it always should have been: "who changed this
// billing-adjacent setting, and when" is a genuine audit event, not storage.
//
// Reads go through getOrgAutoRecharge (src/lib/db/org-settings.ts), which also falls back to the legacy
// audit row while the column is NULL, so orgs that set a preference before the migration keep theirs
// with no backfill. Other surfaces (the low-credit alert) read the same accessor — never storage.

import { NextResponse } from "next/server";
import { isDbConfigured, recordOrgAudit } from "@/lib/db";
import { getOrgAutoRecharge, setOrgAutoRecharge } from "@/lib/db/org-settings";
import { requireOrgRead, requireOrgRole } from "@/lib/authz";
import { isSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import {
  AUTO_RECHARGE_ACTION,
  AUTO_RECHARGE_CHARGES_AUTOMATICALLY,
  DEFAULT_AUTO_RECHARGE,
  MAX_LOW_BALANCE_THRESHOLD,
  normalizeAutoRecharge,
} from "@/components/org/shared/CreditsControl.autorecharge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  // getOrgAutoRecharge is best-effort in the safe direction: a read failure resolves to the DEFAULT
  // (feature OFF), so a transient DB blip can't spontaneously arm a nag on a money surface.
  const { pref, source } = await getOrgAutoRecharge(org);
  return NextResponse.json({
    pref,
    chargesAutomatically: AUTO_RECHARGE_CHARGES_AUTOMATICALLY,
    // The wire contract stays stored-vs-default (the popover's only distinction); "column" and "audit"
    // are a storage detail the client has never needed and must not start depending on.
    source: source === "default" ? "default" : "stored",
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
  // STORAGE first. A failed column write is a failed SAVE — never report success, or the owner walks
  // away believing a warning is armed that was never persisted.
  const saved = await setOrgAutoRecharge(org, pref);
  if (!saved) {
    return NextResponse.json({ error: "Couldn't save the preference. Please try again." }, { status: 503 });
  }
  // AUDIT second, and best-effort: this is now a record of the change, not the change itself, so losing
  // it must not fail a save the customer's setting already survived. It is logged, not silently dropped.
  const audited = await recordOrgAudit(AUTO_RECHARGE_ACTION, org, { ...pref }, actor ?? undefined);
  if (!audited) {
    console.warn(`[billing/autorecharge] preference saved for org "${org}" but the audit row failed to write`);
  }
  return NextResponse.json({
    ok: true,
    pref,
    chargesAutomatically: AUTO_RECHARGE_CHARGES_AUTOMATICALLY,
    source: "stored",
  });
}
