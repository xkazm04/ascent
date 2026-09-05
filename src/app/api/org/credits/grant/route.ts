// POST /api/org/credits/grant { org, amount } -> { ok, balance, appliedDelta }
//
// Owner-only manual credit grant/adjustment. Disabled unless ASCENT_ALLOW_CREDIT_GRANTS is set AND the
// deployment is not production: in production, credits are added by the Polar top-up webhook
// (src/app/api/billing/webhook) calling grantCredits() server-side, NOT by a self-serve endpoint (that
// would let an owner mint free scans). This is the dev / demo / manual-reconciliation path. See
// docs/features/billing/billing.md.
//
// TWO BOUNDS, not one. `creditGrantsEnabled()` (src/lib/env.ts) hard-disables the flag under
// NODE_ENV=production the same way `authBypassEnabled()` does, so a leaked/misconfigured env var can't
// open the mint on a real deployment. Underneath that, LIFETIME_GRANT_CAP bounds the TOTAL an org can
// ever mint here, because "owner" is the top authorization tier — there is no role above it to appeal
// to — and the per-call |amount| <= 100_000 clamp bounds only ONE call, so repeated calls summed to an
// unbounded total on any non-production deployment (dev, demo, staging, a preview branch).
//
// PARTIAL APPLICATION: negative amounts (reason "adjustment") are CLAMPED to the available balance
// by grantCredits — a -500 against a balance of 30 removes 30, and a debit against 0 removes nothing.
// `appliedDelta` reports what actually landed (0 for the empty-balance debit), so an operator
// reconciling against an external system can see under-application instead of a bare `ok: true`.

import { NextResponse } from "next/server";
import { getCreditState, grantCredits, isDbConfigured } from "@/lib/db";
import { sumManualGrants } from "@/lib/db/credits";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { creditGrantsEnabled } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lifetime ceiling on the NET credits one org may mint through this endpoint, measured from the
 * persisted ledger (`sumManualGrants`), NOT from the current balance — spending granted credits must
 * not buy more headroom. Ten times the per-call clamp: comfortably past any dev/demo/reconciliation
 * need, while turning "unbounded" into a finite, auditable number. Deliberately a CONSTANT rather than
 * another env var: the threat this closes is a leaked/misconfigured environment, and a cap that the
 * same leaked environment could raise would be no cap at all.
 */
const LIFETIME_GRANT_CAP = 1_000_000;

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Credits require a database." }, { status: 503 });
  // CSRF defense-in-depth on this money-adjacent mutation (the session cookie is already SameSite=Lax).
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!creditGrantsEnabled()) {
    return NextResponse.json(
      { error: "Manual credit grants are disabled on this deployment. Credits are added via billing." },
      { status: 403 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { org?: string; amount?: number };
  if (!body.org || typeof body.amount !== "number" || !Number.isFinite(body.amount)) {
    return NextResponse.json({ error: "Provide { org, amount }." }, { status: 400 });
  }
  // Owner-gated: only the org owner may change its balance.
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;

  const amount = Math.trunc(body.amount);
  if (amount === 0 || Math.abs(amount) > 100_000) {
    return NextResponse.json({ error: "amount must be a non-zero integer up to 100000." }, { status: 400 });
  }
  // Cumulative bound: what this org has ALREADY minted here, read from the append-only ledger, so the
  // cap survives restarts and can't be reset by draining the balance. Only a positive amount is
  // checked — a debit/correction always stays allowed (it can only give headroom back). The read is
  // non-atomic, like the `before` read below; two racing owner grants could each see the same total
  // and jointly overshoot by at most one call's clamp (100_000). Accepted for the same reason: this
  // endpoint has no concurrent writers in practice, and the bound it replaces was infinity.
  if (amount > 0) {
    const alreadyGranted = await sumManualGrants(body.org);
    if (alreadyGranted + amount > LIFETIME_GRANT_CAP) {
      return NextResponse.json(
        {
          error: `Lifetime manual-grant cap reached for this organization (${alreadyGranted} of ${LIFETIME_GRANT_CAP} credits already granted). Add credits via billing.`,
          granted: alreadyGranted,
          cap: LIFETIME_GRANT_CAP,
        },
        { status: 403 },
      );
    }
  }
  // resolveViewerLogin, not getSession: the dormant custom-OAuth session is null under the ACTIVE
  // Supabase wall, so this audit row recorded a null actor in production.
  const actorLogin = await resolveViewerLogin();
  // Balance BEFORE the grant, so the response can report the delta that ACTUALLY applied after
  // grantCredits' debit clamp (see the PARTIAL APPLICATION note above). A concurrent movement between
  // the two reads could skew the derived delta, but this owner-gated dev/reconciliation endpoint has
  // no concurrent writers in practice and the ledger stays the authoritative record either way.
  const before = await getCreditState(body.org);
  const balance = await grantCredits(body.org, amount, {
    reason: amount > 0 ? "grant" : "adjustment",
    actor: actorLogin ?? "system",
  });
  if (balance === null) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  return NextResponse.json({ ok: true, balance, appliedDelta: balance - before.balance });
}
