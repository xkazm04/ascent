// THE PULSE — the one lean read a passive screen polls (spark theater-upgrade, 2026-09-18; WP4).
//
//   GET ?org=…   → { pulse: LoopPulse | null }        (Cache-Control: no-store)
//
// `pulse` is null when there is nothing to report from (no database, no such org); a failed read is a
// 500, never a pulse of zeros — a theater must be able to tell "nothing is running" from "I could not
// ask" (`theaterPulseParse.ts` maps the first to "No runner" and the second to "Reconnecting…").
//
// GATES mirror `GET /api/org/loop`: `requireOrgAccess` (a read — any member), the public funnel org
// refused, and NO `selfHostGuard`, for the reason that route gives: a cloud org can arm a remote run,
// and hiding its own lanes from it would be the wrong answer. Nothing here spawns or writes.
//
// `no-store` because the body is a live claim about the present: a cached pulse is a stale heartbeat
// wearing a fresh timestamp.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";
import { getLoopPulse } from "@/lib/db/loop-pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const org = new URL(request.url).searchParams.get("org")?.trim().toLowerCase() ?? "";
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "Missing 'org'." }, { status: 400, headers: NO_STORE });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  try {
    const pulse = await getLoopPulse(org);
    return NextResponse.json({ pulse }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "The pulse could not be read." }, { status: 500, headers: NO_STORE });
  }
}
