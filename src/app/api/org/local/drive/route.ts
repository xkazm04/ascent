// LOCAL MODE — drive the fleet to green, headlessly (self-hosted + ASCENT_AUTOPILOT=1 only).
//
//   POST { org, action:"start", repos?, maxRuns?, maxCycles?, concurrency?, model?, effort?, delivery? } → { drive }
//   POST { org, action:"stop", id }                                          → { ok, drive }
//   POST { org, action:"resume", id }                                        → { drive }
//   GET  ?org=<slug>                                                         → { drives }
//
// `resume` re-arms an INTERRUPTED drive (one a server restart orphaned) as a new drive continuing the
// same chain — the run count carries over, so a restart never re-grants rope the operator did not
// give. It is a POST from a human, never something boot does: the boot sweep only tells the truth
// about what died, because an agent that spends money is re-armed by a person.
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
import { normalizeAgentEffort, normalizeAgentModel } from "@/lib/local/agent-options";
import { normalizeDelivery } from "@/lib/local/delivery-options";
import { isAppConfigured } from "@/lib/github/app";
import { DRIVE_MAX_RUNS_CAP, getDrive, listDrives, readDrive, resumeDrive, startDrive, stopDrive } from "@/lib/local/drive";
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
  // The list reads the DB (a drive this process never started still happened), overlaid with the
  // live registry — so a restart reports `interrupted`, not nothing at all.
  return NextResponse.json({ enabled: autopilotEnabled(), drives: await listDrives(org) });
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
    model?: unknown;
    effort?: unknown;
    delivery?: unknown;
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
  if (body.action === "resume") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "Missing 'id'." }, { status: 400 });
    if (!autopilotEnabled()) {
      return NextResponse.json({ error: "The loop is not enabled on this deployment — set ASCENT_AUTOPILOT=1." }, { status: 409 });
    }
    // Tenancy is checked BEFORE anything is armed: `requireOrgRole` above authorized the caller for
    // `org`, and a drive id is not org-scoped on its own.
    const prior = await readDrive(id);
    if (!prior || prior.org !== org) return NextResponse.json({ error: "Unknown drive for this organization." }, { status: 404 });
    try {
      return NextResponse.json({ drive: await resumeDrive(id, await resolveViewerLogin()) }, { status: 202 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
    }
  }
  if (body.action !== "start") {
    return NextResponse.json({ error: "action must be 'start', 'stop' or 'resume'." }, { status: 400 });
  }

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
  // Same closed list and the same honest refusal as /api/org/loop: `pr` is not silently downgraded on
  // a deployment that has no GitHub App, because a drive that ran eight times and quietly opened
  // nothing is the exact shape of the problem delivery exists to fix.
  const delivery = normalizeDelivery(body.delivery);
  if (delivery === "pr" && !isAppConfigured()) {
    return NextResponse.json(
      { error: "This deployment has no GitHub App configured, so the loop cannot open pull requests. Choose another delivery mode." },
      { status: 409 },
    );
  }

  try {
    const drive = await startDrive({
      org,
      repos,
      maxRuns,
      maxCycles,
      concurrency,
      // Same normalization as /api/org/loop, and for the same reason — one closed list, two doors.
      model: normalizeAgentModel(body.model),
      effort: normalizeAgentEffort(body.effort),
      delivery,
      actor: await resolveViewerLogin(),
    });
    return NextResponse.json({ drive }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
