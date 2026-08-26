// LOCAL MODE — drive the fleet to green, headlessly (self-hosted + ASCENT_AUTOPILOT=1 only).
//
//   POST { org, action:"start", repos?, maxRuns?, maxCycles?, concurrency? } → { drive }
//   POST { org, action:"stop", id }                                          → { ok, drive }
//   GET  ?org=<slug>                                                         → { drives }
//
// A drive is a sequence of loop runs re-measured against the fleet's own green predicate after every
// run, stopping on green, on a dry run (debt did not fall), or at the operator's ceiling — see
// src/lib/local/drive.ts. It exists so the loop can be handed a TARGET rather than a batch, by an
// operator with curl or by the companion, without a tab open.
//
// Guards mirror /api/org/loop exactly: self-host 404 (the surface does not exist on managed cloud),
// DB, PUBLIC_ORG 403, then OWNER — a drive spawns coding agents inside paired working copies, the
// same blast radius the loop's own start has. The autopilot flag answers 409, like the loop does.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { selfHostGuard } from "@/lib/api/self-host";
import { resolveViewerLogin } from "@/lib/access";
import { autopilotEnabled } from "@/lib/local/agent";
import { DRIVE_MAX_RUNS_CAP, getDrive, listDrives, startDrive, stopDrive } from "@/lib/local/drive";
import { LOOP_CONCURRENCY_CAP, LOOP_MAX_CYCLES_CAP } from "@/lib/local/loop-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const intOr = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : d);

async function gate(org: string) {
  const guard = selfHostGuard() ?? dbGuard("Drive", "A drive requires a database.");
  if (guard) return guard;
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  if (org === PUBLIC_ORG) return NextResponse.json({ error: "The public funnel org cannot be driven." }, { status: 403 });
  return requireOrgRole(org, "owner");
}

export async function GET(request: Request) {
  const org = (new URL(request.url).searchParams.get("org") ?? "").trim().toLowerCase();
  const denied = await gate(org);
  if (denied) return denied;
  return NextResponse.json({ enabled: autopilotEnabled(), drives: listDrives(org) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    org?: unknown;
    action?: unknown;
    id?: unknown;
    repos?: unknown;
    maxRuns?: unknown;
    maxCycles?: unknown;
    concurrency?: unknown;
  };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const denied = await gate(org);
  if (denied) return denied;

  if (body.action === "stop") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "Missing 'id'." }, { status: 400 });
    const drive = getDrive(id);
    if (!drive || drive.org !== org) return NextResponse.json({ error: "Unknown drive for this organization." }, { status: 404 });
    return NextResponse.json({ ok: stopDrive(id), drive });
  }
  if (body.action !== "start") return NextResponse.json({ error: "action must be 'start' or 'stop'." }, { status: 400 });

  if (!autopilotEnabled()) {
    return NextResponse.json(
      { error: "The loop is not enabled on this deployment — set ASCENT_AUTOPILOT=1 with the claude CLI on PATH." },
      { status: 409 },
    );
  }
  const maxRuns = intOr(body.maxRuns, 3);
  const maxCycles = intOr(body.maxCycles, 3);
  const concurrency = intOr(body.concurrency, 2);
  if (maxRuns < 1 || maxRuns > DRIVE_MAX_RUNS_CAP) return NextResponse.json({ error: `maxRuns must be 1–${DRIVE_MAX_RUNS_CAP}.` }, { status: 400 });
  if (maxCycles < 1 || maxCycles > LOOP_MAX_CYCLES_CAP) return NextResponse.json({ error: `maxCycles must be 1–${LOOP_MAX_CYCLES_CAP}.` }, { status: 400 });
  if (concurrency < 1 || concurrency > LOOP_CONCURRENCY_CAP) return NextResponse.json({ error: `concurrency must be 1–${LOOP_CONCURRENCY_CAP}.` }, { status: 400 });
  const repos = Array.isArray(body.repos) ? body.repos.filter((r): r is string => typeof r === "string") : undefined;

  try {
    const drive = await startDrive({ org, repos, maxRuns, maxCycles, concurrency, actor: await resolveViewerLogin() });
    return NextResponse.json({ drive }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
