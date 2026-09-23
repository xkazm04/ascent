// THE OPERATOR'S VERDICT ON ONE PLAN (self-hosted only) — and the held work it is asked about.
//
//   GET → { heldBranch, commits, files: [{ path, added, deleted }] }
//
// THE HELD DIFF (challenge-2026-09-23, live-war-room#B): a plan the fence held carries the branch its
// commits were parked on, and the reviewer decides on THOSE commits — so the inbox reads them here
// instead of asking for a terminal (`hitl-approval/oracle-before-gate`). RESOLVE-THEN-GATE at org READ:
// the org comes from the plan row and a caller who cannot read it gets the same 404 as a missing plan,
// before any git call (no existence oracle). Read with `git diff --numstat ascent/runner...<held>` in
// the repo's paired checkout (lane-adopt.ts `readHeldDiff`). A plan with no held branch is a 404.
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
import { requireOrgRead, requireOrgRole } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { dbGuard } from "@/lib/api/orgPlan";
import { getLoopPlan, getLoopPlanOrgSlug } from "@/lib/db/loop-plans";
import { decideLoopPlan, parseDecisionBody } from "@/lib/db/loop-plan-decide";
import { getRepoLocalPath } from "@/lib/db/org-local";
import { readHeldDiff } from "@/lib/local/lane-adopt";

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

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = selfHostGuard() ?? dbGuard("Held work");
  if (guard) return guard;
  const { id } = await ctx.params;
  const missing = () => NextResponse.json({ error: "No such plan." }, { status: 404 });

  const org = await getLoopPlanOrgSlug(id).catch(() => null);
  if (!org || org === PUBLIC_ORG) return missing();
  const denied = await requireOrgRead(org);
  // A signed-out caller is told to sign in; anyone else who cannot read the org learns nothing.
  if (denied) return denied.status === 401 ? denied : missing();

  const plan = await getLoopPlan(id).catch(() => null);
  if (!plan) return missing();
  if (!plan.heldBranch) return NextResponse.json({ error: "This plan holds no work." }, { status: 404 });
  const pairedPath = await getRepoLocalPath(org, plan.repo).catch(() => null);
  if (!pairedPath) return NextResponse.json({ error: `No paired checkout for ${plan.repo}. The held branch lives there.` }, { status: 409 });
  const read = await readHeldDiff(pairedPath, plan.heldBranch);
  if (!read.ok) return NextResponse.json({ error: `git could not read ${plan.heldBranch} in the paired checkout (${read.reason}).` }, { status: 502 });
  return NextResponse.json(read.diff);
}
