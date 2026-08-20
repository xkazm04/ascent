// POST /api/org/briefing/share { org, range?, from?, to? } -> { token, path, expiresAt, jti }   (owner)
// Mint a signed, expiring read-only share link for the org's executive briefing (EXEC-6). Owner-gated
// + same-origin: only an owner can publish a briefing to someone without an account. The link
// (/share/briefing/[token]) is read-only and re-runs buildExecBriefing for the carried window.

import { NextResponse } from "next/server";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { authGateEnabled, getViewer } from "@/lib/access";
import { briefingFigureDigest, briefingShareEnabled, freezeShareWindow, signBriefingShareToken } from "@/lib/briefing-share";
import { buildExecBriefing } from "@/lib/org/briefing";
import { getOrgId, getTechGroupIdByKey, recordAudit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!briefingShareEnabled()) {
    return NextResponse.json({ error: "Briefing sharing isn't configured (set BRIEFING_SHARE_SECRET or AUTH_SECRET)." }, { status: 503 });
  }
  const gate = await requireOrgOwnerPost<{ range?: string; from?: string; to?: string; segment?: string; stack?: string }>(request);
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;
  // briefing-share #5: bind the link to the minting owner so it can be revoked by removing/demoting them
  // (a per-link kill switch the stateless token otherwise lacks). Only under the enforced Supabase wall,
  // where membership is the authoritative, seeded source of truth — other auth modes leave it unset and
  // keep the prior stateless behavior unchanged.
  const mintedBy = authGateEnabled() ? (await getViewer())?.login : undefined;
  // Lowercased, because that is the form the token carries and therefore the form the shared page
  // will build with — fingerprinting a differently-cased slug would compare two different reads.
  const orgKey = org.toLowerCase();
  // #26: freeze the window HERE, before signing, so the fingerprint below is taken over exactly the
  // window the token will carry (see signBriefingShareToken — a supplied window is honored verbatim).
  const win = freezeShareWindow(body);
  // #26: fingerprint the figures the SENDER is looking at, and carry it in the signed token. The shared
  // page re-runs the builder and compares, so a recipient is TOLD when the numbers have moved instead of
  // silently reading a different set from the same URL. Scope must match the page's read exactly — same
  // segment, same resolved tech group — or the comparison is meaningless: an UNRESOLVABLE stack key
  // therefore skips the fingerprint entirely (a whole-org digest for a stack-scoped link would report
  // "changed" forever). Any failure degrades to no fingerprint, i.e. the pre-existing behavior where the
  // page makes no integrity claim — never to a 500 on the mint.
  const techGroupId = body.stack ? await getTechGroupIdByKey(orgKey, body.stack).catch(() => null) : null;
  const fingerprintable = !body.stack || techGroupId != null;
  const snapshot = fingerprintable
    ? await buildExecBriefing(
        orgKey,
        { start: win.winStart ? new Date(win.winStart) : null, end: new Date(win.winEnd) },
        undefined,
        body.segment ?? null,
        techGroupId,
      ).catch(() => null)
    : null;
  const fig = snapshot ? briefingFigureDigest(snapshot) : undefined;
  // EXEC #1: carry the per-client segment scope + the tech-stack scope (3b) into the signed token so the
  // shared link re-runs identically scoped.
  const minted = signBriefingShareToken({
    org,
    range: body.range,
    from: body.from,
    to: body.to,
    winStart: win.winStart ?? undefined,
    winEnd: win.winEnd,
    segment: body.segment,
    stack: body.stack,
    mintedBy,
    fig,
  });
  if (!minted) return NextResponse.json({ error: "Could not mint a share link." }, { status: 503 });
  // #13: a record that grant n EXISTS. Before this, a stateless token left no trace at all — an owner
  // could not list the links their org had issued, nor answer "who shared the fleet's security posture,
  // with what scope, and when". AuditLog is the right host for the LOG (it is exported, retained under a
  // floor, and reachable by the erasure path); the REVOCATION ledger deliberately is not (see
  // briefingShareRevocationKey — a purged revocation row would silently un-revoke a link). recordAudit
  // swallows its own failures: an audit hiccup must never withhold the link the owner asked for.
  const orgId = await getOrgId(org).catch(() => null);
  await recordAudit(
    "briefing.share.minted",
    { jti: minted.jti, expiresAt: minted.expiresAt, window: win, segment: body.segment ?? null, stack: body.stack ?? null, fingerprinted: fig != null },
    { orgId: orgId ?? undefined, actorId: mintedBy },
  );
  // `jti` is returned so the issuer can name THIS grant in a revoke call — it is an opaque id, not a
  // credential (the token is), so it is safe in the response body.
  return NextResponse.json({ token: minted.token, path: `/share/briefing/${minted.token}`, expiresAt: minted.expiresAt, jti: minted.jti });
}
