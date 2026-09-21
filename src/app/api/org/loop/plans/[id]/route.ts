// THE OPERATOR'S VERDICT ON ONE PLAN (self-hosted only).
//
//   POST { decision: "approve" | "revise" | "reject", note, fence?, budgetCycles?, budgetUsd? }
//     → { plan, direction }
//
// RESOLVE-THEN-GATE: the owning org is derived from the PLAN ROW (`getLoopPlanOrgSlug`) and THAT org is
// gated at `owner` — approving a plan grants the runner a fenced, budgeted direction to move this
// repository's architecture, which is the same blast radius as arming the runner itself. No org is
// taken from the caller, so an owner of org A cannot decide org B's plan by lifting its id.
// `requireSameOrigin` runs first: this mutates, and a reject writes standing decisions.
//
// Only a `pending` plan can be decided (409 otherwise); `note` is mandatory on reject and revise
// (400). What each verdict does is `decideLoopPlan`'s header. A failed write is a 500 that leaves the
// plan `pending` — never a phantom decision.

import { NextResponse } from "next/server";
import { PUBLIC_ORG, requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { dbGuard } from "@/lib/api/orgPlan";
import { getLoopPlan, getLoopPlanOrgSlug } from "@/lib/db/loop-plans";
import { decideLoopPlan, parseDecisionBody } from "@/lib/db/loop-plan-decide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const xo = requireSameOrigin(request);
  if (xo) return xo;
  const guard = selfHostGuard() ?? dbGuard("Plan decisions");
  if (guard) return guard;
  const { id } = await ctx.params;

  const org = await getLoopPlanOrgSlug(id).catch(() => null);
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "No such plan." }, { status: 404 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  const parsed = parseDecisionBody(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const plan = await getLoopPlan(id).catch(() => null);
  if (!plan) return NextResponse.json({ error: "No such plan." }, { status: 404 });
  if (plan.status !== "pending") {
    return NextResponse.json({ error: `This plan is already ${plan.status} — only a pending plan can be decided.` }, { status: 409 });
  }

  const decidedBy = await resolveViewerLogin().catch(() => null);
  const outcome = await decideLoopPlan({ plan, orgSlug: org, body: parsed.body, decidedBy });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ plan: outcome.plan, direction: outcome.direction });
}
