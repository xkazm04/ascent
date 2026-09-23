// LOCAL MODE — drive the fleet to green, headlessly (self-hosted + ASCENT_AUTOPILOT=1 only).
//
//   POST { org, action:"start", repos?, maxRuns?, maxCycles?, concurrency?, model?, effort?, delivery?,
//          dials?, mode?, spendCeilingUsd? }                                  → { drive }
//   POST { org, action:"stop", id }                                          → { ok, drive }
//   POST { org, action:"resume", id }                                        → { drive }
//   POST { org, action:"resume-repo", repo }                                 → { drive }
//   GET  ?org=<slug>                                                         → { drives }
//
// `mode:"continuous"` arms the STANDING RUNNER (spark theater-upgrade, 2026-09-18): no run cap, never
// stops on green or dry, pauses on named breakers, lands verified work on each repo's `ascent/runner`
// branch. It always delivers `runner` and always verifies, so a `delivery` other than `runner` or a
// `dials.verifyMode:"off"` is a 400 rather than a silent override. `spendCeilingUsd` omitted = the
// default daily ceiling, `0`/`null` = none. `resume-repo` lifts one repo's pause on the live runner.
// `dials` (batch, session ceiling, guard, its timeout, cadence, model policy, arms, plan mode) reach
// EVERY run either mode dispatches, parsed by the SAME function /api/org/loop calls (`run-spec.ts`).
// A drive reads the arms ONLY from `dials.arms`: a top-level `arms`/`armPolicy`/`planMode` is a stale
// client and a 400 saying where they belong, never silently dropped (challenge-2026-09-23b).
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
import { normalizeDelivery } from "@/lib/local/delivery-options";
import { isAppConfigured } from "@/lib/github/app";
import { DRIVE_MAX_RUNS_CAP, getDrive, listDrives, readDrive, resumeDrive, startDrive, stopDrive } from "@/lib/local/drive";
import { LOOP_CONCURRENCY_CAP, LOOP_MAX_CYCLES_CAP } from "@/lib/local/loop-engine";
import { toDriveDials } from "@/lib/local/drive-dials";
import { parseRunSpec, parseWholeCount } from "@/lib/local/run-spec";
import { resumeRunnerRepo } from "@/lib/local/runner-control";
import { MICROS_PER_USD } from "@/lib/local/runner-breakers";
import { SPEND_CEILING_STORABLE_MAX_MICROS } from "@/lib/db/drives";
import type { DriveMode } from "@/lib/local/runner-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/** The runner's daily ceiling from the body: omitted = the default, `null`/`0` = none, else a finite
 *  non-negative USD amount the column can store. Returns an error string for anything else. */
function parseSpendCeiling(v: unknown): { ok: true; usd: number | null | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, usd: undefined };
  if (v === null) return { ok: true, usd: null };
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return { ok: false, error: "spendCeilingUsd must be a non-negative number of US dollars, or null for no ceiling." };
  if (Math.round(v * MICROS_PER_USD) > SPEND_CEILING_STORABLE_MAX_MICROS) {
    const max = Math.floor((SPEND_CEILING_STORABLE_MAX_MICROS / MICROS_PER_USD) * 100) / 100;
    return { ok: false, error: `spendCeilingUsd can be at most ${max} on this deployment (or null for no ceiling).` };
  }
  return { ok: true, usd: v };
}

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
    mode?: unknown;
    spendCeilingUsd?: unknown;
    dials?: unknown;
    repo?: unknown;
    /** Read only to refuse them: a drive's arms and plan mode live in `dials`. */
    arms?: unknown;
    armPolicy?: unknown;
    planMode?: unknown;
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
  if (body.action === "resume-repo") {
    // Lifting a pause is re-arming a repo the runner will spend agent sessions on — the owner gate
    // above covers it, and the live runner is found by the org the caller was authorized for.
    const repo = typeof body.repo === "string" ? body.repo.trim() : "";
    if (!repo) return bad("Missing 'repo'.");
    const res = await resumeRunnerRepo(org, repo);
    return res.ok ? NextResponse.json({ drive: res.drive }) : NextResponse.json({ error: res.error }, { status: res.status });
  }
  if (body.action !== "start") {
    return bad("action must be 'start', 'stop', 'resume' or 'resume-repo'.");
  }

  if (!autopilotEnabled()) {
    return NextResponse.json(
      { error: "The loop is not enabled on this deployment — set ASCENT_AUTOPILOT=1 with the claude CLI on PATH." },
      { status: 409 },
    );
  }
  if (body.mode !== undefined && body.mode !== "bounded" && body.mode !== "continuous") {
    return bad("mode must be 'bounded' or 'continuous'.");
  }
  const mode: DriveMode = body.mode === "continuous" ? "continuous" : "bounded";
  // A runner has no rope, so `maxRuns` is not its to validate. Same whole-number rule as every count.
  const rope = mode === "bounded" ? parseWholeCount(body.maxRuns, 3, 1, DRIVE_MAX_RUNS_CAP, "maxRuns") : { ok: true as const, value: 3 };
  if (!rope.ok) return bad(rope.error);
  const maxRuns = rope.value;
  // THE RUN SPEC, parsed by the loop door's own function: cycles, lanes and the agent configuration
  // from the top of the body, the dials from `body.dials`. One verdict per input at either door.
  const spec = parseRunSpec(body, { maxCycles: LOOP_MAX_CYCLES_CAP, concurrency: LOOP_CONCURRENCY_CAP }, "dials");
  if (!spec.ok) return bad(spec.error);
  const { maxCycles, concurrency, model, effort } = spec.value;
  const repos = Array.isArray(body.repos) ? body.repos.filter((r): r is string => typeof r === "string") : undefined;
  // Same closed list and the same honest refusal as /api/org/loop: `pr` is not silently downgraded on
  // a deployment that has no GitHub App, because a drive that ran eight times and quietly opened
  // nothing is the exact shape of the problem delivery exists to fix.
  const delivery = normalizeDelivery(body.delivery);
  // `runner` delivery needs lanes cut from the runner branch and a merge-in before every run, which only
  // the runner performs; and the runner delivers nowhere else. Both mismatches are refused, not coerced.
  if (mode === "bounded" && delivery === "runner") return bad("A bounded drive cannot deliver to the runner branch — start a continuous drive.");
  if (mode === "continuous" && body.delivery !== undefined && delivery !== "runner") {
    return bad("The standing runner always delivers to its runner branch; omit 'delivery' or send 'runner'.");
  }
  const dials = toDriveDials(spec.value.dials);
  if (mode === "continuous" && dials?.verifyMode === "off") {
    return bad("The standing runner lands only verified work, so its guard cannot be switched off.");
  }
  if (mode === "continuous" && dials?.planMode === "off") {
    return bad("The standing runner always plans before it edits, so dials.planMode cannot be 'off'.");
  }
  const ceiling = parseSpendCeiling(body.spendCeilingUsd);
  if (!ceiling.ok) return bad(ceiling.error);
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
      model,
      effort,
      delivery: mode === "continuous" ? "runner" : delivery,
      dials,
      ...(mode === "continuous" ? { mode, spendCeilingUsd: ceiling.usd } : {}),
      actor: await resolveViewerLogin(),
    });
    return NextResponse.json({ drive }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
