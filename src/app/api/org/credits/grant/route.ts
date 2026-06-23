// POST /api/org/credits/grant { org, amount } -> { ok, balance }
//
// Owner-only manual credit grant/adjustment. Disabled unless ASCENT_ALLOW_CREDIT_GRANTS is set: in
// production, credits are added by the Polar top-up webhook (src/app/api/billing/webhook) calling
// grantCredits() server-side, NOT by a self-serve endpoint (that would let an owner mint free scans).
// This is the dev / demo / manual-reconciliation path. See docs/BILLING.md.

import { NextResponse } from "next/server";
import { grantCredits, isDbConfigured } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { getSession, isSameOrigin } from "@/lib/auth";
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
  const session = await getSession();
  const balance = await grantCredits(body.org, amount, {
    reason: amount > 0 ? "grant" : "adjustment",
    actor: session?.login ?? "system",
  });
  if (balance === null) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  return NextResponse.json({ ok: true, balance });
}
