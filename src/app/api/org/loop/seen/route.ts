// THE LEDGER'S PRESENCE STAMP (spark theater-upgrade, 2026-09-18).
//
//   POST { org } → { ok: true, seen: boolean, seenAt? }
//
// Advances the CALLER'S OWN `Membership.liveSeenAt` to now — the anchor the ledger's "Since you last
// looked" briefing is derived against. The `alertsSeenAt` stamp (`POST /api/org/alerts { seen: true }`)
// one surface over, and self-scoped the same way: the login comes from the session, never from the
// body, so a caller can only ever move their own read state.
//
// The ledger fires this only after it has been VISIBLE for five continuous seconds, once per mount
// (`useSeenStamp`): a presence anchor must advance only when seeing was possible. The route itself is
// indifferent to that — it records "I looked", and the client is what decides the user did.
//
// Gates: `requireSameOrigin` first (it writes), then `requireOrgAccess` on the named org — reading the
// org's ledger is not a privileged act, so neither is recording that you read it. No identity
// (auth off, the public org) or no membership row is a clean `{ seen: false }`, never an error: there
// is simply no per-user anchor to move.

import { NextResponse } from "next/server";
import { PUBLIC_ORG, requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgAccess } from "@/lib/authz";
import { markLiveSeen } from "@/lib/db/live-seen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const xo = requireSameOrigin(request);
  if (xo) return xo;
  const body = (await request.json().catch(() => ({}))) as { org?: unknown };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  if (org === PUBLIC_ORG) return NextResponse.json({ ok: true, seen: false });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

  const login = await resolveViewerLogin().catch(() => null);
  if (!login) return NextResponse.json({ ok: true, seen: false });
  const at = new Date();
  const stamped = await markLiveSeen(org, login, at).catch(() => false);
  return NextResponse.json({ ok: true, seen: stamped, ...(stamped ? { seenAt: at.toISOString() } : {}) });
}
