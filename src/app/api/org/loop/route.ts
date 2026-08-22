// LOCAL-MODE IMPROVEMENT LOOP control (self-hosted only, ASCENT_AUTOPILOT=1 only).
//
//   GET  ?org=…                                              → { enabled, active, runs }
//   POST { action:"start",  org, repos[], batches?, concurrency?, maxCycles?, curated? } → { run }
//   POST { action:"stop",   org, id }                        → { ok, run }
//   POST { action:"retry",  org, laneId }                    → { ok }
//
// The gates mirror /api/org/local/autopilot exactly, and for the same reasons: selfHostGuard first
// (on managed cloud this surface does not exist, so 404 rather than 403 — a 403 would advertise it),
// then requireOrgAccess for the read and requireOrgRole("owner") for every write, because starting a
// run spawns editing agents inside paired working copies — the same blast radius as pairing itself.
//
// TENANCY. `stop` and `retry` name a run/lane by id, so the id must be re-checked against the org the
// caller was authorized for. Trusting the id alone would let an owner of org A stop org B's run.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { getViewer } from "@/lib/access";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { selfHostGuard } from "@/lib/api/self-host";
import { autopilotEnabled } from "@/lib/local/agent";
import {
  LOOP_CONCURRENCY_CAP,
  LOOP_MAX_CYCLES_CAP,
  getActiveLoopRun,
  getLane,
  getLoopRun,
  listLoopRuns,
  markStaleRunsStopped,
} from "@/lib/db/loop-runs";
import { retryLane, startLoopRun, stopLoopRun } from "@/lib/local/loop-engine";
import { orgIdForSlug } from "@/lib/db/loop-tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = selfHostGuard();
  if (guard) return guard;
  const org = new URL(request.url).searchParams.get("org")?.trim().toLowerCase() ?? "";
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  // Reconcile before reading: a run left `running` by a process that died is not resumable, and
  // rendering it as active would leave the wall spinning on a job nobody is driving.
  await markStaleRunsStopped(org).catch(() => 0);
  const [active, runs] = await Promise.all([getActiveLoopRun(org), listLoopRuns(org, 20)]);
  return NextResponse.json({ enabled: autopilotEnabled(), active, runs });
}

type Body = {
  action?: unknown;
  org?: unknown;
  id?: unknown;
  laneId?: unknown;
  repos?: unknown;
  batches?: unknown;
  concurrency?: unknown;
  maxCycles?: unknown;
  curated?: unknown;
};

export async function POST(request: Request) {
  const guard = selfHostGuard() ?? dbGuard("The improvement loop", "The improvement loop requires a database.");
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as Body;
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const action =
    body.action === "start" || body.action === "stop" || body.action === "retry" ? body.action : null;
  if (!org || !action) return NextResponse.json({ error: "Missing 'org' or 'action'." }, { status: 400 });
  if (org === PUBLIC_ORG) return NextResponse.json({ error: "The public funnel org has no improvement loop." }, { status: 403 });

  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  if (action === "stop") return stop(org, body);
  if (action === "retry") return retry(org, body);

  if (!autopilotEnabled()) {
    return NextResponse.json(
      { error: "The loop is not enabled on this deployment — set ASCENT_AUTOPILOT=1 (and make sure the claude CLI is available)." },
      { status: 409 },
    );
  }
  const repos = Array.isArray(body.repos) ? body.repos.filter((r): r is string => typeof r === "string") : [];
  if (repos.length === 0) return NextResponse.json({ error: "Missing 'repos'." }, { status: 400 });
  const maxCycles = intOr(body.maxCycles, 3);
  if (maxCycles < 1 || maxCycles > LOOP_MAX_CYCLES_CAP) {
    return NextResponse.json({ error: `maxCycles must be 1–${LOOP_MAX_CYCLES_CAP}.` }, { status: 400 });
  }
  const concurrency = intOr(body.concurrency, 2);
  if (concurrency < 1 || concurrency > LOOP_CONCURRENCY_CAP) {
    return NextResponse.json({ error: `concurrency must be 1–${LOOP_CONCURRENCY_CAP}.` }, { status: 400 });
  }

  const viewer = await getViewer().catch(() => null);
  try {
    const run = await startLoopRun({
      org,
      repos,
      batches: parseBatches(body.batches),
      concurrency,
      maxCycles,
      curated: body.curated === true,
      actor: viewer?.login ?? null,
    });
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not start the loop." }, { status: 409 });
  }
}

async function stop(org: string, body: Body): Promise<NextResponse> {
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Missing 'id'." }, { status: 400 });
  const run = await getLoopRun(id);
  if (!run || run.orgId !== (await orgIdForSlug(org))) {
    return NextResponse.json({ error: "No such loop run." }, { status: 404 });
  }
  const ok = await stopLoopRun(id);
  return NextResponse.json({ ok, run: await getLoopRun(id) }, { status: ok ? 200 : 409 });
}

async function retry(org: string, body: Body): Promise<NextResponse> {
  const laneId = typeof body.laneId === "string" ? body.laneId : "";
  if (!laneId) return NextResponse.json({ error: "Missing 'laneId'." }, { status: 400 });
  const lane = await getLane(laneId);
  const run = lane ? await getLoopRun(lane.runId) : null;
  if (!lane || !run || run.orgId !== (await orgIdForSlug(org))) {
    return NextResponse.json({ error: "No such lane." }, { status: 404 });
  }
  const ok = await retryLane(laneId);
  return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
}

const intOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;

/** `{ "owner/repo": ["recId", …] }`, defensively narrowed — it arrives from the wire. */
function parseBatches(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
