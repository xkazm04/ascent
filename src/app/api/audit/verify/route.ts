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
// This route also SEALS lazily. Sealing is the only write here and it only ever touches CLOSED days
// that hold rows and have no seal, so the ledger needs no cron of its own and no `vercel.json` entry
// — the surface that cares about seals is the one that creates them. `verifySeals` itself never
// writes; a verifier that produced its own input would be checking its own homework.

import { NextResponse } from "next/server";
import { sealPendingDays, verifySeals } from "@/lib/db/control-observations";
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
    // Seal first, verify second. Any day sealed on this request is a day that had rows and no seal —
    // its root is computed from the rows as they stand, so it verifies trivially. That is honest, and
    // the response says which days were sealed just now so nobody reads a fresh seal as a long-
    // standing one.
    const sealedNow = await sealPendingDays(org).catch(() => [] as string[]);
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
        sealedNow: sealedNow.length,
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
      sealedOnThisRequest: sealedNow,
      recipe: SEAL_RECIPE,
      // Said in the response, not only in our docs, because an examiner reading a `chainOk: true`
      // deserves to know exactly how far it goes.
      scope:
        "chainOk is true when every seal in the range recomputes to its stored root and each day's " +
        "prevRoot matches the preceding sealed day. A day whose rows have all been purged under the " +
        "retention policy is reported as `no-rows`: its seal is kept on purpose, so a deleted window " +
        "stays visible as a gap rather than disappearing.",
    });
  } catch (err) {
    console.error("[audit/verify] failed", err);
    return NextResponse.json({ error: "Failed to verify the ledger." }, { status: 500 });
  }
}
