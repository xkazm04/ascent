// GET /api/org/getting-started?org=slug -> { steps, allDone, personal, onboarding }
//
// The server-derived getting-started checklist (W6a): five steps whose doneness is DERIVED from the
// org's real data on every read (see src/lib/org/getting-started.ts) — nothing is recorded per
// step, so the payload is safe to poll while the member works (do the work through any door and the
// next poll shows it done). `onboarding` is the CALLER's own stamp (the flow gate) so one request
// answers both "what's left" and "should the flow show at all"; null when the caller has no
// membership row (auth-off / no identity).
//
// Member-gated (>= viewer, a real standing in the org) — the checklist names governance/team state
// (stance published, invite pending), which is tenant data.

import { NextResponse } from "next/server";
import { getMembershipRole, getOnboardingStamp, isDbConfigured } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { buildGettingStarted } from "@/lib/org/getting-started";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Getting-started state requires a database." }, { status: 503 });
  }
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRole(org, "viewer");
  if (denied) return denied;

  // The viewer's role scopes step AVAILABILITY (render honestly, never point at a 403); null =
  // no viewer identity (auth-off local/demo), which the model treats as unrestricted — every write
  // route is open on those deployments.
  const login = await resolveViewerLogin();
  const role = login ? await getMembershipRole(org, login) : null;

  const [model, stamp] = await Promise.all([
    buildGettingStarted(org, role),
    login ? getOnboardingStamp(org, login).catch(() => null) : Promise.resolve(null),
  ]);
  if (!model) {
    return NextResponse.json({ error: "Getting-started state requires a database." }, { status: 503 });
  }

  return NextResponse.json({
    steps: model.steps,
    allDone: model.allDone,
    personal: model.personal,
    onboarding: stamp
      ? {
          completedAt: stamp.completedAt?.toISOString() ?? null,
          skippedAt: stamp.skippedAt?.toISOString() ?? null,
          dismissed: stamp.dismissed,
        }
      : null,
  });
}
