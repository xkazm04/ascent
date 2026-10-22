// GET /api/org/credits?org=slug -> { balance, unlimited, plan, allowanceRemaining, ledger[] }
// The org's prepaid private-scan balance + recent ledger. Read-gated (any member who can read the org).
// Plus `creditBacklog` (credits-1): the watched repos whose newest scan was skipped for credits, sent
// ONLY to a viewer who passes requireOrgAccess - the gate POST /api/org/scan enforces - so the list goes
// to exactly the people who could run the resume scan themselves. Additive: a reader gets no field.

import { NextResponse } from "next/server";
import { getCreditLedger, getCreditState, isDbConfigured } from "@/lib/db";
import { checkScanEntitlement } from "@/lib/entitlement";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";
import { getCreditBacklog } from "@/lib/db/credit-backlog";
import type { CreditBacklog } from "@/lib/credit-backlog-model";
import { degradedRead } from "@/lib/org/degraded-read";

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
  // The public org is never metered, so it never owes a credit scan. A failed backlog read omits the
  // field (the popover then shows no section) rather than failing the balance answer.
  const backlog: CreditBacklog | null =
    org.toLowerCase() !== "public" && !(await requireOrgAccess(org))
      ? await getCreditBacklog(org.toLowerCase()).catch(degradedRead("credits route backlog read (getCreditBacklog)", null))
      : null;
  return NextResponse.json({
    balance: state.balance,
    unlimited: state.unlimited,
    plan: state.plan,
    allowanceRemaining,
    ledger,
    ...(backlog ? { creditBacklog: backlog } : {}),
  });
}
