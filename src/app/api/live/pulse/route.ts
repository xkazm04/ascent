// GET /api/live/pulse?token=… → the runner's pulse for a `view: "theater"` kiosk link (no session).
//
// The token IS the capability, verified by `resolveLiveShare` — the SAME function the kiosk page
// (/live/shared/[token]) calls: signature + domain + expiry, then per-link revocation and owner binding,
// all failing closed. The org is taken FROM the token, never from the request, so there is no second
// identifier a caller could swap. A wall link (every link minted before the theater existed) is refused:
// it was granted to show the fleet rollup, not the runner's lanes.
//
// It serves exactly one thing — `getLoopPulse(org)` stripped of prose by `kioskPulse` — and nothing else:
// no plans, no ledger, no action. Same envelope as the signed-in `GET /api/org/loop/pulse`:
// `{ pulse: LoopPulse | null }`, null when there is nothing to report.

import { NextResponse } from "next/server";
import { resolveLiveShare } from "@/lib/live-share-access";
import { getLoopPulse } from "@/lib/db/loop-pulse";
import { kioskPulse } from "./kioskPulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const access = await resolveLiveShare(token);
  if (!access.ok) {
    if (access.reason === "no-db") {
      return NextResponse.json({ error: "This deployment has no database configured." }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json(
      { error: access.reason === "revoked" ? "This link has been revoked." : "This link is expired or invalid." },
      { status: 403, headers: NO_STORE },
    );
  }
  if (access.claims.view !== "theater") {
    return NextResponse.json({ error: "This link is not a theater link." }, { status: 403, headers: NO_STORE });
  }
  let pulse: Awaited<ReturnType<typeof getLoopPulse>>;
  try {
    pulse = await getLoopPulse(access.claims.org);
  } catch {
    // A failed read is a 500, never a pulse of zeros: the theater says "Reconnecting…" for this one.
    return NextResponse.json({ error: "The pulse could not be read." }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ pulse: pulse ? kioskPulse(pulse) : null }, { headers: NO_STORE });
}
