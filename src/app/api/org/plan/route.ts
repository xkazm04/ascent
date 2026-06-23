// POST /api/org/plan { org, plan: "free"|"pro"|"team"|"enterprise" } -> { ok, plan }
//
// Owner-gated tier change. A downgrade to "free" is always allowed; switching TO a paid/unlimited
// tier is the manual-override path (ASCENT_ALLOW_PLAN_CHANGES), because the real paid upgrade flows
// through billing checkout (CRED-1) — without this guard an owner could self-assign `enterprise` and
// mint unlimited free scans (the same hazard the credit-grant endpoint gates).

import { NextResponse } from "next/server";
import { getOrgId, isDbConfigured, recordAudit, setOrgPlan } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { getSession, isSameOrigin } from "@/lib/auth";
import { isPlanId } from "@/lib/plans";
import { envBool } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function planChangesAllowed(): boolean {
  return envBool("ASCENT_ALLOW_PLAN_CHANGES");
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Plans require a database." }, { status: 503 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; plan?: string };
  if (!body.org || !body.plan || !isPlanId(body.plan)) {
    return NextResponse.json({ error: "Provide { org, plan: free|pro|team|enterprise }." }, { status: 400 });
  }
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  if (body.plan !== "free" && !planChangesAllowed()) {
    return NextResponse.json(
      { error: "Paid plan changes go through billing checkout.", code: "USE_CHECKOUT" },
      { status: 403 },
    );
  }
  const ok = await setOrgPlan(body.org, body.plan);
  if (!ok) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  const session = await getSession();
  const orgId = (await getOrgId(body.org.toLowerCase()).catch(() => null)) ?? undefined;
  // SEC #1: record the actor in the dedicated `actorId` column (not just `meta.actor`) so the audit
  // viewer's Actor column shows it and the actor filter can match — matching member/playbook writes.
  await recordAudit("org.plan", { org: body.org, plan: body.plan }, { orgId, actorId: session?.login }).catch(() => {});
  return NextResponse.json({ ok: true, plan: body.plan });
}
