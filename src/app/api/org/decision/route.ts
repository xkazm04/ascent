// POST /api/org/decision { org, module, itemKey, status, rationale?, title?, snoozedUntil? } -> { id, memoryId }
//
// Records a human decision on a derived finding (a failing security check, an unowned repo, a passport
// blocker, a solo-maintained repo) and publishes it to Shared Org Memory so connected agents and the
// scan prompt inherit the reasoning. This is what takes the item out of the org rail's badge.
//
// Any MEMBER may decide (requireOrgAccess, not requireOrgRole): deciding is the ordinary act of working
// the dashboard, the same bar as watching a repo or assigning a backlog item — and every write is
// audited with the actor, so an unwanted call is attributable and reversible (re-decide to "open").
//
// The tenant boundary is enforced twice: requireOrgAccess authorizes the slug, and the db layer AND-s
// the server-resolved orgId into the upsert. A client-supplied org is never trusted alone.

import { NextResponse } from "next/server";
import { decide, isDbConfigured, isDecisionStatus } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { isFindingModule } from "@/lib/org/findings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Decisions require a database." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    module?: string;
    itemKey?: string;
    status?: string;
    rationale?: string;
    title?: string;
    snoozedUntil?: string;
  };

  if (!body.org || !body.module || !body.itemKey?.trim() || !body.status) {
    return NextResponse.json({ error: "Provide { org, module, itemKey, status }." }, { status: 400 });
  }
  if (!isFindingModule(body.module)) {
    return NextResponse.json({ error: "Unknown module." }, { status: 400 });
  }
  if (!isDecisionStatus(body.status)) {
    return NextResponse.json({ error: "status must be open, accepted, dismissed or snoozed." }, { status: 400 });
  }

  // A snooze without a future date would resolve the finding forever — that's a dismissal wearing a
  // friendlier word, so refuse it rather than silently mislabel the decision.
  let snoozedUntil: Date | null = null;
  if (body.status === "snoozed") {
    const parsed = body.snoozedUntil ? new Date(body.snoozedUntil) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed <= new Date()) {
      return NextResponse.json({ error: "A snooze needs a future snoozedUntil date." }, { status: 400 });
    }
    snoozedUntil = parsed;
  }

  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;

  const decidedBy = await resolveViewerLogin();

  try {
    const result = await decide(
      body.org,
      {
        module: body.module,
        itemKey: body.itemKey,
        status: body.status,
        rationale: body.rationale,
        title: body.title,
        snoozedUntil,
      },
      decidedBy,
    );
    if (!result) return NextResponse.json({ error: "Failed to record the decision." }, { status: 500 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to record the decision." }, { status: 500 });
  }
}
