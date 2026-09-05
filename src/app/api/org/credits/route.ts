// GET /api/org/credits?org=slug -> { balance, unlimited, plan, allowanceRemaining, ledger[] }
// The org's prepaid private-scan balance + recent ledger. Read-gated (any member who can read the org).

import { NextResponse } from "next/server";
import { getCreditLedger, getCreditState, isDbConfigured } from "@/lib/db";
import { checkScanEntitlement } from "@/lib/entitlement";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Credits require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const [state, entitlement, ledger] = await Promise.all([
    getCreditState(org),
    checkScanEntitlement(org),
    getCreditLedger(org, 50),
  ]);
  // allowanceRemaining = the org's INCLUDED free monthly scans still available. Surfaced so the
  // onboarding money-gate treats a Free-tier org's allowance as real-scan headroom, not just its
  // purchased balance (otherwise a Free org with 0 credits but unused free scans is wrongly
  // downgraded to a preview). Infinity (unlimited plan) serializes to null — `unlimited` covers it.
  const allowanceRemaining = Number.isFinite(entitlement.allowanceRemaining)
    ? entitlement.allowanceRemaining
    : null;
  return NextResponse.json({
    balance: state.balance,
    unlimited: state.unlimited,
    plan: state.plan,
    allowanceRemaining,
    ledger,
  });
}
