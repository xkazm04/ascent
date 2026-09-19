// GET /api/audit/verify?org=<slug>[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//
// Tamper-evidence for the control-observation ledger (moonshot #1): recompute every daily seal in
// the window from the rows present NOW, check the day-to-day chain, and hand back the recipe so the
// examiner can repeat the check themselves from an export.
//
// The recipe is the point. A verification only WE can perform is a claim, not evidence — so the
// digest is a plain sha256 over canonically-ordered fields with no secret in it, and `SEAL_RECIPE`
// ships in the response body rather than living in our documentation. The stored HMAC is deliberately
// NOT returned: it proves nothing to someone who cannot recompute it, and publishing it would hand
// out a distinguisher against the signing secret.
//
// MC-B14 — THIS ROUTE NO LONGER SEALS. It used to seal lazily, which made an org's tamper-evidence a
// function of how often somebody curled this URL: an org nobody verified accumulated unsealed days
// until retention aged the rows out, leaving no seal behind to prove they had ever existed. Sealing
// moved to the daily rescan cron (`sealAllPendingDays`), whose cadence is a property of the
// deployment. What is left here is a pure read — which is what a verifier should have been all
// along: one that produces its own input is checking its own homework.

import { NextResponse } from "next/server";
import { verifySeals } from "@/lib/db/control-observations";
import { SEAL_RECIPE } from "@/lib/controls/seal";
import { getOrgId, isDbConfigured, recordAudit } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Ledger verification requires a database." }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing 'org' query parameter." }, { status: 400 });

  const denied = await requireOrgRead(org);
  if (denied) return denied;

  const from = searchParams.get("from");
  const to = searchParams.get("to");

  try {
    const chain = await verifySeals(org, { from, to });
    if (!chain) return NextResponse.json({ error: "Ledger verification is unavailable." }, { status: 503 });

    const orgId = await getOrgId(org).catch(() => null);
    await recordAudit(
      "controls.verify",
      {
        from: from ?? null,
        to: to ?? null,
        days: chain.checks.length,
        chainOk: chain.chainOk,
        sealBacklogRemaining: chain.sealBacklogRemaining,
        tampered: chain.checks.filter((c) => c.verdict === "tampered" || c.verdict === "broken-chain").map((c) => c.day),
      },
      { orgId: orgId ?? undefined },
    );

    return NextResponse.json({
      org,
      chainOk: chain.chainOk,
      seals: chain.checks,
      // Days holding rows with no seal yet. Today is always among them (an open day is not sealable),
      // so an empty list here would be the surprising answer, not a full one.
      unsealedDays: chain.unsealedDays,
      // How many CLOSED unsealed days remain beyond what the next scheduled pass can take. Zero
      // means the backlog clears tomorrow; non-zero is a standing hole a retention purge can turn
      // permanent, and it is stated rather than left to be inferred from the array's length.
      sealBacklogRemaining: chain.sealBacklogRemaining,
      recipe: SEAL_RECIPE,
      // Said in the response, not only in our docs, because an examiner reading a `chainOk: true`
      // deserves to know exactly how far it goes.
      scope:
        "chainOk is true when every seal in the range recomputes to its stored root and each day's " +
        "prevRoot matches the preceding sealed day. A day whose rows have all been purged under the " +
        "retention policy is reported as `no-rows`: its seal is kept on purpose, so a deleted window " +
        "stays visible as a gap rather than disappearing. Sealing runs on the daily schedule, not on " +
        "this request: this route only reads. A day listed in `unsealedDays` that is purged before " +
        "the scheduled pass reaches it leaves NO seal behind and is therefore not detectable as a " +
        "gap — `sealBacklogRemaining` is how far the sealer is behind, and a persistently non-zero " +
        "value on a short retention horizon is the condition under which that can happen.",
    });
  } catch (err) {
    console.error("[audit/verify] failed", err);
    return NextResponse.json({ error: "Failed to verify the ledger." }, { status: 500 });
  }
}
