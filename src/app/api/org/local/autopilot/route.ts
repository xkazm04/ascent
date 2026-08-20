// LOCAL MODE autopilot control (self-hosted only, ASCENT_AUTOPILOT=1 only).
//
//   GET  ?org=…                                → the org's current/last job (the band's poll)
//   POST { org, action:"start", fullName, maxCycles? } → arm a run (owner-gated)
//   POST { org, action:"stop" }                → cooperative stop (owner-gated)
//
// OWNER for both writes: starting spawns an editing agent inside a paired working copy — the same
// blast radius as pairing itself. The GET is member-visible like every other war-room read.
// The consent flag is checked HERE too (not only in the agent runner) so a disabled deployment
// answers an honest 409 with the fix, instead of arming a job whose first agent call refuses.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { selfHostGuard } from "@/lib/api/self-host";
import { autopilotEnabled } from "@/lib/local/agent";
import { MAX_CYCLES_CAP, getAutopilotJob, requestAutopilotStop, startAutopilot } from "@/lib/local/autopilot";
import { getRepoLocalPath } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = selfHostGuard();
  if (guard) return guard;
  const org = new URL(request.url).searchParams.get("org")?.trim().toLowerCase() ?? "";
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  return NextResponse.json({ enabled: autopilotEnabled(), job: getAutopilotJob(org) });
}

export async function POST(request: Request) {
  const guard = selfHostGuard() ?? dbGuard("Autopilot", "The autopilot requires a database.");
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as {
    org?: unknown;
    action?: unknown;
    fullName?: unknown;
    maxCycles?: unknown;
  };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const action = body.action === "start" || body.action === "stop" ? body.action : null;
  if (!org || !action) return NextResponse.json({ error: "Missing 'org' or 'action'." }, { status: 400 });
  if (org === PUBLIC_ORG) return NextResponse.json({ error: "The public funnel org has no autopilot." }, { status: 403 });

  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  if (action === "stop") {
    const stopped = requestAutopilotStop(org);
    return NextResponse.json({ ok: stopped, job: getAutopilotJob(org) }, { status: stopped ? 200 : 409 });
  }

  if (!autopilotEnabled()) {
    return NextResponse.json(
      { error: "Autopilot is not enabled on this deployment — set ASCENT_AUTOPILOT=1 (and make sure the claude CLI is available)." },
      { status: 409 },
    );
  }
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (!fullName) return NextResponse.json({ error: "Missing 'fullName'." }, { status: 400 });
  const path = await getRepoLocalPath(org, fullName);
  if (!path) {
    return NextResponse.json({ error: `${fullName} is not paired with a local path — pair it on Admin → Pairing.` }, { status: 409 });
  }
  const maxCycles = typeof body.maxCycles === "number" && Number.isFinite(body.maxCycles) ? Math.round(body.maxCycles) : 3;
  if (maxCycles < 1 || maxCycles > MAX_CYCLES_CAP) {
    return NextResponse.json({ error: `maxCycles must be 1–${MAX_CYCLES_CAP}.` }, { status: 400 });
  }

  try {
    const job = await startAutopilot({ org, repo: fullName, path, maxCycles });
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not start the autopilot." }, { status: 409 });
  }
}
