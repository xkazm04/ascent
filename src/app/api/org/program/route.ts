// GET    /api/org/program?org=slug                                   -> { program, status }
// POST   /api/org/program { org, name, targetLevel, targetDate?, cadence? } -> { program }
// PATCH  /api/org/program { org, status }                            -> { ok }
// DELETE /api/org/program?org=slug                                   -> { ok }
//
// The org's transition programme (W1c) — its named, dated commitment and the state that outlives
// onboarding. See src/lib/db/org-program.ts for the model and the frozen-baseline contract.
//
// THE BASELINE IS CAPTURED SERVER-SIDE, ON CREATE, AND ONLY THEN. The client never supplies it and
// cannot re-supply it: a caller who could set the origin could also move it, and a baseline that
// moves is not a baseline. POST on an EXISTING programme is a re-target — it edits name/target/date/
// cadence and deliberately leaves `baselineAt`/`baselineJson` alone (see startProgram).
//
// Writes are member-gated via requireOrgAccess, matching the sibling planning routes.

import { NextResponse } from "next/server";
import { getOrgHeaderSummary } from "@/lib/db";
import {
  endProgram,
  getOrgProgram,
  getOrgProgramStatus,
  isLevelId,
  isProgramCadence,
  isProgramStatus,
  setProgramStatus,
  startProgram,
  type ProgramBaseline,
} from "@/lib/db/org-program";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";
import { dbGuard, invalidTargetDate } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME = 80;

export async function GET(request: Request) {
  const guard = dbGuard("The transition programme");
  if (guard) return guard;
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const [program, status] = await Promise.all([getOrgProgram(org), getOrgProgramStatus(org)]);
  return NextResponse.json({ program, status });
}

export async function POST(request: Request) {
  const guard = dbGuard("The transition programme");
  if (guard) return guard;
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    name?: string;
    targetLevel?: string;
    targetDate?: string | null;
    cadence?: string;
  };
  if (!body.org || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Provide { org, name }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;

  const targetLevel = body.targetLevel ?? "L4";
  if (!isLevelId(targetLevel)) {
    return NextResponse.json({ error: "targetLevel must be L1..L5." }, { status: 400 });
  }
  const cadence = body.cadence ?? "weekly";
  if (!isProgramCadence(cadence)) {
    return NextResponse.json({ error: "cadence must be weekly | biweekly | monthly." }, { status: 400 });
  }
  const badDate = invalidTargetDate(body.targetDate);
  if (badDate) return badDate;

  // Capture the origin HERE, once, from the org's own live rollup — never from the request body.
  // A fleet with nothing scanned yet stores a null baseline: an honest absent origin beats a zeroed
  // one, which would make the first scan read as pure programme progress.
  const existing = await getOrgProgram(body.org);
  let baseline: ProgramBaseline | null = null;
  if (!existing) {
    const summary = await getOrgHeaderSummary(body.org).catch(() => null);
    baseline =
      summary && summary.scannedCount > 0
        ? {
            overall: summary.avgOverall,
            adoption: summary.avgAdoption,
            rigor: summary.avgRigor,
            scannedCount: summary.scannedCount,
            repoCount: summary.repoCount,
          }
        : null;
  }

  try {
    const program = await startProgram(body.org, {
      name: body.name.trim().slice(0, MAX_NAME),
      targetLevel,
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
      cadence,
      baseline,
      startedBy: null,
    });
    if (!program) return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    return NextResponse.json({ program }, { status: existing ? 200 : 201 });
  } catch {
    return NextResponse.json({ error: "Failed to save the programme." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const guard = dbGuard("The transition programme");
  if (guard) return guard;
  const body = (await request.json().catch(() => ({}))) as { org?: string; status?: string };
  if (!body.org || !body.status) return NextResponse.json({ error: "Provide { org, status }." }, { status: 400 });
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  if (!isProgramStatus(body.status)) {
    return NextResponse.json({ error: "status must be active | paused | achieved." }, { status: 400 });
  }
  const ok = await setProgramStatus(body.org, body.status);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "No programme to update." }, { status: 404 });
}

export async function DELETE(request: Request) {
  const guard = dbGuard("The transition programme");
  if (guard) return guard;
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  const ok = await endProgram(org);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "No programme to end." }, { status: 404 });
}
