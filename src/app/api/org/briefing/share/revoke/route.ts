// POST /api/org/briefing/share/revoke { org, jti } -> { ok: true, jti }   (owner)
// Kill ONE issued briefing share link (expiring-share-links #13). The mint route stamps every grant with
// a random `jti`; this writes that jti into the permanent revocation ledger, and the shared page
// (/share/briefing/[token]) refuses the link from the next read onward.
//
// WHO MAY REVOKE: any OWNER of the org, not only the owner who minted the link.
//
// The gate is deliberately IDENTICAL to the mint route's (requireOrgOwnerPost — same-origin + owner),
// because the two ends of a capability's life belong to the same authority. The two alternatives are
// both worse, in opposite directions:
//
//   • Any MEMBER may revoke. That is a denial-of-service on a colleague's shared document: a board is
//     mid-read and any member of the org can kill the link, with no way to distinguish malice from a
//     misclick. Members cannot mint one, so they have no business ending one.
//   • Only the MINTER may revoke. This strands the org the moment that person leaves — precisely the
//     situation in which a leaked link most needs killing, and precisely when the minter is least
//     available to do it. It also makes the owner-binding lever (demote the minter, killing their whole
//     set) the only remaining option, which is the blunt instrument #13 exists to replace.
//
// The accepted trade-off is that one owner can revoke another owner's link. Owners can already mint
// links over the same data, demote each other, and erase the org; a revoke is strictly less destructive
// than any of those, it is recorded with the actor below, and its worst outcome is a re-mint.

import { NextResponse } from "next/server";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { authGateEnabled, getViewer } from "@/lib/access";
import { briefingShareEnabled } from "@/lib/briefing-share";
import { listBriefingShareGrants, revokeBriefingShareLink } from "@/lib/db/org-share";
import { getOrgId, isDbConfigured, recordAudit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!briefingShareEnabled()) {
    return NextResponse.json({ error: "Briefing sharing isn't configured (set BRIEFING_SHARE_SECRET or AUTH_SECRET)." }, { status: 503 });
  }
  // Revocation is the one operation that MUST NOT report success it cannot deliver: without a database
  // there is no ledger, so the bump would be a silent no-op and the owner would believe a live link dead.
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Revoking a share link requires a database." }, { status: 503 });
  }
  const gate = await requireOrgOwnerPost<{ jti?: string }>(request);
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;
  const jti = typeof body.jti === "string" ? body.jti.trim() : "";
  if (!jti) return NextResponse.json({ error: "Provide { org, jti }." }, { status: 400 });

  const actor = authGateEnabled() ? (await getViewer())?.login : undefined;
  // Best-effort ownership check, used for the AUDIT RECORD and not as a gate. Why not a gate: the grant
  // list is reconstructed from audit rows, which retention sweeps, while the token's own TTL can outlive
  // that window — so "this jti is not in your org's list" means either "not yours" OR "your own link,
  // minted before the retention horizon". Refusing on that ambiguity would block an owner from killing a
  // leaked link of their own at exactly the moment it matters. Allowing it costs nothing an attacker
  // could use: a jti is a random UUID disclosed only to the minting owner and inside that org's own audit
  // trail, and revoking one only ever DISABLES a capability — it can never grant access to anything.
  const known = await listBriefingShareGrants(org).catch(() => []);
  const grant = known.find((g) => g.jti === jti) ?? null;

  // No catch: a failed ledger write must surface as a 500. An owner told "revoked" over a failed write
  // stops chasing a link that is still live — the one lie this endpoint must never tell.
  try {
    await revokeBriefingShareLink(jti);
  } catch {
    return NextResponse.json({ error: "Could not revoke the link. Try again." }, { status: 500 });
  }
  // The revocation itself lives in the permanent ledger; this row is the human record of WHO ended the
  // grant and when. recordAudit swallows its own failures, so an audit hiccup cannot undo a completed
  // revocation — the safe direction, unlike the mint row where the reverse would be true.
  const orgId = await getOrgId(org).catch(() => null);
  await recordAudit(
    "briefing.share.revoked",
    { jti, mintedBy: grant?.mintedBy ?? null, mintedAt: grant?.mintedAt ?? null, grantFound: grant != null },
    { orgId: orgId ?? undefined, actorId: actor },
  );
  // Idempotent: revoking an already-revoked (or already-expired) grant is a success, because the caller's
  // intent — "this link must not work" — holds either way.
  return NextResponse.json({ ok: true, jti });
}
