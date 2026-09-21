// END ONE DIRECTION (self-hosted only).
//
//   POST { action: "revoke" | "done" }   → { direction }
//
// RESOLVE-THEN-GATE at `owner`, exactly as a plan decision: the org comes from the DIRECTION ROW
// (`getLoopDirectionOrgSlug`), never from the caller. `revoke` withdraws the grant and returns its
// approved-but-unexecuted plans to `pending`; `done` closes it and supersedes them (their items go
// back to the ordinary backlog). Only an `active` or `exhausted` direction can be ended (409 otherwise).

import { NextResponse } from "next/server";
import { PUBLIC_ORG, requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { dbGuard } from "@/lib/api/orgPlan";
import { getLoopDirectionOrgSlug, settleDirection } from "@/lib/db/loop-directions";
import { recordAudit } from "@/lib/db/scans-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const xo = requireSameOrigin(request);
  if (xo) return xo;
  const guard = selfHostGuard() ?? dbGuard("Directions");
  if (guard) return guard;
  const { id } = await ctx.params;

  const org = await getLoopDirectionOrgSlug(id).catch(() => null);
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "No such direction." }, { status: 404 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action === "revoke" || body.action === "done" ? body.action : null;
  if (!action) return NextResponse.json({ error: "'action' must be revoke or done." }, { status: 400 });

  let direction;
  try {
    direction = await settleDirection(id, action);
  } catch {
    return NextResponse.json({ error: "The direction could not be updated." }, { status: 500 });
  }
  if (!direction) return NextResponse.json({ error: "This direction has already ended." }, { status: 409 });

  const actor = await resolveViewerLogin().catch(() => null);
  const meta = { directionId: direction.id, repo: direction.repo, usedCycles: direction.usedCycles, budgetCycles: direction.budgetCycles };
  const opts = { orgId: direction.orgId, ...(actor ? { actorId: actor } : {}) };
  if (action === "revoke") await recordAudit("loop.direction_revoked", meta, opts);
  else await recordAudit("loop.direction_done", meta, opts);
  return NextResponse.json({ direction });
}
