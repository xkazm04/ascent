// GET  /api/org/gate-policy?org=slug         -> { policy }            (member read)
// POST /api/org/gate-policy { org, policy }    -> { ok, policy }       (owner)  set; policy:null clears
//
// The per-org CI maturity-gate policy (GATE-1). The App-mode PR Check Run + the governance fleet view
// resolve THIS policy (falling back to the archetype default when unset). Owner-gated on write — it
// changes the bar that blocks merges across the org. The stored value is sanitized on write.

import { NextResponse } from "next/server";
import { getOrgGatePolicy, isDbConfigured, recordOrgAudit, setOrgGatePolicy } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { sanitizeGatePolicy } from "@/lib/scoring/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Gate policy requires a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  return NextResponse.json({ policy: await getOrgGatePolicy(org) });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Gate policy requires a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<{ policy?: unknown }>(request, { missingOrgError: "Provide { org, policy }." });
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;

  // null clears (back to the archetype default); anything else is sanitized — an all-invalid object
  // sanitizes to null, which also clears (a no-op policy is the default).
  const clean = body.policy == null ? null : sanitizeGatePolicy(body.policy);
  const stored = await setOrgGatePolicy(org, clean);
  if (stored === undefined) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  const session = await getSession();
  // SEC #1: actor goes in the dedicated `actorId` column so the viewer/filter can surface it.
  await recordOrgAudit(
    "org.gate_policy",
    org,
    { org, action: stored ? "set" : "cleared" },
    session?.login,
  ).catch(() => {});
  return NextResponse.json({ ok: true, policy: stored });
}
