// POST /api/org/credits/grant { org, amount } -> { ok, balance, appliedDelta }
//
// Owner-only manual credit grant/adjustment. Disabled unless ASCENT_ALLOW_CREDIT_GRANTS is set: in
// production, credits are added by the Polar top-up webhook (src/app/api/billing/webhook) calling
// grantCredits() server-side, NOT by a self-serve endpoint (that would let an owner mint free scans).
// This is the dev / demo / manual-reconciliation path. See docs/BILLING.md.
//
// PARTIAL APPLICATION: negative amounts (reason "adjustment") are CLAMPED to the available balance
// by grantCredits — a -500 against a balance of 30 removes 30, and a debit against 0 removes nothing.
// `appliedDelta` reports what actually landed (0 for the empty-balance debit), so an operator
// reconciling against an external system can see under-application instead of a bare `ok: true`.

import { NextResponse } from "next/server";
import { getCreditState, grantCredits, isDbConfigured } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { isSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { envBool } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function grantsEnabled(): boolean {
  return envBool("ASCENT_ALLOW_CREDIT_GRANTS");
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Credits require a database." }, { status: 503 });
  // CSRF defense-in-depth on this money-adjacent mutation (the session cookie is already SameSite=Lax).
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  if (!grantsEnabled()) {
    return NextResponse.json(
      { error: "Manual credit grants are disabled on this deployment. Credits are added via billing." },
      { status: 403 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { org?: string; amount?: number };
  if (!body.org || typeof body.amount !== "number" || !Number.isFinite(body.amount)) {
    return NextResponse.json({ error: "Provide { org, amount }." }, { status: 400 });
  }
  // Owner-gated: only the org owner may change its balance.
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;

  const amount = Math.trunc(body.amount);
  if (amount === 0 || Math.abs(amount) > 100_000) {
    return NextResponse.json({ error: "amount must be a non-zero integer up to 100000." }, { status: 400 });
  }
  // resolveViewerLogin, not getSession: the dormant custom-OAuth session is null under the ACTIVE
  // Supabase wall, so this audit row recorded a null actor in production.
  const actorLogin = await resolveViewerLogin();
  // Balance BEFORE the grant, so the response can report the delta that ACTUALLY applied after
  // grantCredits' debit clamp (see the PARTIAL APPLICATION note above). A concurrent movement between
  // the two reads could skew the derived delta, but this owner-gated dev/reconciliation endpoint has
  // no concurrent writers in practice and the ledger stays the authoritative record either way.
  const before = await getCreditState(body.org);
  const balance = await grantCredits(body.org, amount, {
    reason: amount > 0 ? "grant" : "adjustment",
    actor: actorLogin ?? "system",
  });
  if (balance === null) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  return NextResponse.json({ ok: true, balance, appliedDelta: balance - before.balance });
}
