// POST /api/org/followups/claims  { org, action: "take-over" | "send-back" | "release", ids: string[] }
//
// The human claim verbs on the Proposals ledger: take a needs-human row, send a held row back to the
// queue, release your own hand-off. The verb table is the pure `claimActionsFor`
// (src/components/shared/followups/claimActionsModel.ts), the same one the row and the batch bar read, so
// a button a viewer sees is a request this route accepts.
//
// GATE-THEN-CONSTRAIN. The public org is refused first, in code. `org` is gated with
// requireOrgAccess, then every id is read CONSTRAINED to that org: one foreign id refuses the whole
// request with the same 403 body an unknown id gets, so the route is no oracle for which ids exist in
// another tenant. Only then, and only when the table says some row of the batch is admitted by the
// admin role alone (another person's hand-off, a live agent's claim), the viewer is escalated through
// requireOrgAdmin. All of it happens before any write.
//
// The writes are compare-and-set on the claim generation they read (src/lib/db/followup-claims-human.ts),
// one timeline event per row and one audit row per batch. A row that moved since the ledger rendered
// comes back in `skipped` as `not-held`, never as a success.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgAccess, requireOrgAdmin } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { readClaimStates, releaseHumanClaims, sendBack, takeOverEscalations } from "@/lib/db/followup-claims-human";
import { MAX_CLAIM_BATCH, VIEWER_FALLBACK, isClaimVerb, verbNeedsAdmin } from "@/components/shared/followups/claimActionsModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOREIGN = "One or more items do not belong to this organization.";
const RESULT_KEY = { "take-over": "taken", "send-back": "sentBack", release: "released" } as const;

export async function POST(request: Request) {
  const guard = dbGuard("Follow-ups", "Follow-up tracking requires a database.");
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as { org?: unknown; action?: unknown; ids?: unknown };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  if (!isClaimVerb(body.action)) {
    return NextResponse.json({ error: "'action' must be one of take-over, send-back, release." }, { status: 400 });
  }
  const action = body.action;
  if (ids.length === 0) return NextResponse.json({ error: "Missing 'ids'." }, { status: 400 });
  if (ids.length > MAX_CLAIM_BATCH) {
    return NextResponse.json({ error: `At most ${MAX_CLAIM_BATCH} items per request.` }, { status: 400 });
  }
  if (org === PUBLIC_ORG) {
    return NextResponse.json({ error: "Follow-up tracking is available for your own organization's scans." }, { status: 403 });
  }
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

  const states = await readClaimStates(org, ids);
  if (!states || states.length !== ids.length) return NextResponse.json({ error: FOREIGN }, { status: 403 });

  const login = (await resolveViewerLogin()) ?? VIEWER_FALLBACK;
  const now = new Date();
  const admin = states.some((s) => verbNeedsAdmin(s, action, login, now));
  if (admin) {
    const notAdmin = await requireOrgAdmin(org, "admin");
    if (notAdmin) return notAdmin;
  }

  const viewer = { login, admin };
  const outcome =
    action === "take-over"
      ? await takeOverEscalations(org, ids, login)
      : action === "send-back"
        ? await sendBack(org, ids, viewer)
        : await releaseHumanClaims(org, ids, viewer);
  if (!outcome) return NextResponse.json({ error: FOREIGN }, { status: 403 });
  return NextResponse.json({ [RESULT_KEY[action]]: outcome.done, skipped: outcome.skipped });
}
