// GET /api/org/credits?org=slug -> { balance, unlimited, plan, ledger[] }
// The org's prepaid private-scan balance + recent ledger. Read-gated (any member who can read the org).

import { NextResponse } from "next/server";
import { getCreditLedger, getCreditState, isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Credits require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const [state, ledger] = await Promise.all([getCreditState(org), getCreditLedger(org, 50)]);
  return NextResponse.json({ balance: state.balance, unlimited: state.unlimited, plan: state.plan, ledger });
}
