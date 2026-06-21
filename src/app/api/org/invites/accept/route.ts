// POST /api/org/invites/accept { token }  ->  { ok, org, role } | { ok:false, reason }
//
// Accept an org invitation. Accepting is a single-use, capability-GRANTING mutation, so — unlike the
// old /invite/[token] page which consumed the invite as a GET side-effect on render — it must be a
// real user gesture: a same-origin POST from a signed-in viewer. A GET-on-load grant was triggered
// by Link prefetch, address-bar prefetch, email/Slack/Teams link unfurlers, and URL scanners, which
// burned the invite (DoS) and, for an unpinned invite, handed the role to whoever opened the link
// first. acceptInvite still enforces pending/expiry/pinned-login; this route adds the same-origin +
// signed-in gates and records an attributable audit event on the grant.

import { NextResponse } from "next/server";
import { acceptInvite, getOrgId, isDbConfigured, recordAudit } from "@/lib/db";
import { getSession, isAuthConfigured, isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, reason: "db", error: "Invites require a database." }, { status: 503 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const session = isAuthConfigured() ? await getSession() : null;
  if (isAuthConfigured() && !session) {
    return NextResponse.json({ ok: false, reason: "auth", error: "Sign in to accept this invitation." }, { status: 401 });
  }
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: "auth", error: "Authentication is not configured on this deployment." },
      { status: 403 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, reason: "not_found", error: "Missing invite token." }, { status: 400 });
  }

  const result = await acceptInvite(token, session.login);
  if (result.ok) {
    // Audit the GRANT (not just the invite creation) so "who received which role, and when" is
    // attributable — the create path recorded org.member.invited, but acceptance recorded nothing.
    const orgId = (await getOrgId(result.org.toLowerCase()).catch(() => null)) ?? undefined;
    await recordAudit(
      "org.member.invite_accepted",
      { org: result.org, login: session.login, role: result.role },
      { orgId, actorId: session.login },
    ).catch(() => {});
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
