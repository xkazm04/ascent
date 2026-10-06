// GET /api/org/loop/needs-you?org=… → `NeedsYou` + `runner` — the runner notifier's cheap read
// (spark theater-upgrade, 2026-09-18).
//
// What waits on a person: plans in the approval inbox (`listLoopPlans(org, { status: ["pending"] })`),
// repos the org's live continuous drive paused on a breaker only a person clears (the pulse's own
// `needsOperator` rule), and a runner-wide pause — assembled by `buildNeedsYou` beside this route; the
// shape and the item identities the notifier reads are in src/lib/org/runner-needs-you.ts. `runner` says
// whether a live continuous drive exists at all, which is how the notifier knows whether to offer itself.
//
// Gated like every org read that sits under the loop: the public funnel org refused explicitly, then
// requireOrgAccess on the caller-supplied org, and every read below is constrained BY that org
// (gate-then-constrain) — there is no id to swap.
//
// The PUBLIC_ORG refusal is the same one `loop/pulse`, `loop/plans`, `loop/directions` and
// `loop/route.ts` state, and for their reason: requireOrgAccess lets `public` through BY DESIGN (it is
// the anonymous funnel), so a loop read that does not name the rule inherits an open door from a gate
// that was never meant to close this one. It was the one member of the family that didn't say it
// (security scan 2026-10-06, F4).

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { listLoopPlans } from "@/lib/db/loop-plans";
import { listDriveRows } from "@/lib/db/drives";
import { buildNeedsYou } from "./buildNeedsYou";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Drives are listed newest first; the live runner, when there is one, is among the newest few. */
const DRIVES_SCANNED = 10;

export async function GET(request: Request) {
  // Normalized exactly as the pulse normalizes it, so `Public` and `public` are the same refusal.
  const org = new URL(request.url).searchParams.get("org")?.trim().toLowerCase() ?? "";
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "Provide ?org=." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  const noDb = dbGuard("The runner's needs-you read", "The runner's needs-you read requires a database.");
  if (noDb) return noDb;
  const [plans, drives] = await Promise.all([listLoopPlans(org, { status: ["pending"] }), listDriveRows(org, DRIVES_SCANNED)]);
  return NextResponse.json(buildNeedsYou(plans, drives), { headers: { "cache-control": "no-store" } });
}
