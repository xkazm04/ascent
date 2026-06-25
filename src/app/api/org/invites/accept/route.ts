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
import { authGateEnabled, getViewer } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, reason: "db", error: "Invites require a database." }, { status: 503 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  // Resolve the accepting identity from whichever auth is active: the Supabase login wall (getViewer —
  // carries the VERIFIED email used to bind an email-only invite) or the dormant custom OAuth. The old
  // route gated only on the custom session, so under the Supabase wall (the documented prod config)
  // acceptance always 403'd — and it never carried an email to bind an email-pinned invite.
  let identity: { login: string; email?: string | null } | null = null;
  if (authGateEnabled()) {
    const viewer = await getViewer();
    if (!viewer) {
      return NextResponse.json({ ok: false, reason: "auth", error: "Sign in to accept this invitation." }, { status: 401 });
    }
    identity = { login: viewer.login, email: viewer.email };
  } else if (isAuthConfigured()) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, reason: "auth", error: "Sign in to accept this invitation." }, { status: 401 });
    }
    identity = { login: session.login }; // custom Session carries no email ⇒ can't claim an email-only invite
  } else {
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

  const result = await acceptInvite(token, identity);
  if (result.ok) {
    // Audit the GRANT (not just the invite creation) so "who received which role, and when" is
    // attributable — the create path recorded org.member.invited, but acceptance recorded nothing.
    const orgId = (await getOrgId(result.org.toLowerCase()).catch(() => null)) ?? undefined;
    await recordAudit(
      "org.member.invite_accepted",
      { org: result.org, login: identity.login, role: result.role },
      { orgId, actorId: identity.login },
    ).catch(() => {});
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
