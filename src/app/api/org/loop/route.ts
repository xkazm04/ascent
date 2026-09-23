// IMPROVEMENT LOOP control. Three executors, three different gate sets — `local` (self-hosted only,
// ASCENT_AUTOPILOT=1 only), `remote-agent` (the customer's own harness claims the lanes) and `hosted`
// (ADR-0001: Ascent Cloud dispatches a worker of its own). Only the first reads the server's disk,
// and only the first is behind `selfHostGuard`.
//
//   GET  ?org=…                                              → { enabled, active, runs, hosted }
//   GET  ?org=…&beforeSeq=<n>&limit=<k>                      → { runs }   (the ledger chronicle's page)
//   POST { action:"start",  org, repos[], batches?, concurrency?, maxCycles?, curated?, model?, effort?,
//          delivery?, batchSize?, agentTimeoutMs?, verifyMode?, verifyTimeoutMs?, rescanCadence?,
//          modelPolicy?, models?, arms?, armPolicy?, planMode? }            → { run }
//          (every field after `delivery` is parsed by `run-spec.ts`, as the drive door's `dials` are)
//   POST { action:"stop",   org, id }                        → { ok, run }
//   POST { action:"retry",  org, laneId }                    → { ok }
//   POST { action:"review", org, laneId, cover, verdict }    → { ok, deliverables }
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
import { agentTimeoutMs, autopilotEnabled } from "@/lib/local/agent";
import { normalizeDelivery } from "@/lib/local/delivery-options";
import { parseRunSpec } from "@/lib/local/run-spec";
import { isAppConfigured } from "@/lib/github/app";
import {
  LOOP_CONCURRENCY_CAP,
  LOOP_MAX_CYCLES_CAP,
  getActiveLoopRun,
  getLane,
  getLoopRun,
  getOrgPriceList,
  listLoopRuns,
  markStaleRunsStopped,
  reviewDeliverable,
} from "@/lib/db/loop-runs";
import {
  HostedRunRefused,
  isLoopRunLive,
  loopRunStopRequested,
  retryLane,
  startHostedRun,
  startLoopRun,
  startRemoteRun,
  stopLoopRun,
} from "@/lib/local/loop-engine";
import { hostedBlockStatus } from "@/lib/local/hosted-gate";
import { resolveHostedGate } from "@/lib/local/hosted-dispatch";
import { orgIdForSlug } from "@/lib/db/loop-tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // THE READ IS NO LONGER SELF-HOSTED-ONLY (moonshot #3), and the old reasoning is what changed
  // rather than being overruled. `selfHostGuard` 404'd here because on managed cloud the surface did
  // not exist, and a 403 would have advertised a feature the deployment could not run. A cloud org
  // can now arm a `remote-agent` run, so the surface DOES exist there and 404ing its own runs would
  // hide the operator's own rows from them. What is still honest is `enabled`, which stays
  // `autopilotEnabled()` — the answer to "can this deployment run a LOCAL loop", which on cloud is
  // still no. The write path keeps the guard for exactly the executor that needs it.
  const params = new URL(request.url).searchParams;
  const org = params.get("org")?.trim().toLowerCase() ?? "";
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  // THE CHRONICLE'S PAGE (spark theater-upgrade, 2026-09-18). `beforeSeq`/`limit` ask for a LEAN page of
  // older runs — `{ runs }` and nothing else — so the ledger's "Older runs" does not re-derive the price
  // list or reconcile stale runs on every click. Without either parameter the response below is exactly
  // what every existing caller has always received.
  if (params.has("beforeSeq") || params.has("limit")) return runsPage(org, params);
  // Reconcile before reading: a run left `running` by a process that died is not resumable, and
  // rendering it as active would leave the wall spinning on a job nobody is driving. A run THIS
  // process is driving is not stale — without the predicate this GET stopped the run it was
  // rendering (2026-08-26).
  await markStaleRunsStopped(org, isLoopRunLive).catch(() => 0);
  // The price list is derived at read time from the org's own lanes — it stores nothing, and it is
  // org-scoped: there is no cross-tenant "what does a D3 point cost" figure here, which would be a
  // separate product decision rather than a free extension of this one.
  const [active, runs, prices] = await Promise.all([
    getActiveLoopRun(org),
    listLoopRuns(org, 20),
    getOrgPriceList(org).catch(() => null),
  ]);
  // `prAvailable` answers ONE question honestly: can this deployment open a PR at all. The cockpit's
  // delivery dial disables `pr` and says why when it cannot, rather than offering a mode that would be
  // refused on submit — and the refusal below is what makes the disabled control a courtesy rather
  // than the enforcement.
  // STOP IS COOPERATIVE, AND THAT HAS TO BE VISIBLE (PRIYA-L2-C6). A stop request does not end the
  // run: in-flight lanes finish the phase they are in, and an agent session's phase ends only when
  // the session does — up to that run's own ceiling. Both facts travel with the status so the header
  // can say "Stopping…" and name the horizon, instead of reverting to "Stop" the moment the POST
  // returns and leaving the operator to press it again. `stopHorizonMs` is RESOLVED here because the
  // deployment's `ASCENT_AUTOPILOT_TIMEOUT_MS` is a server fact — a browser guessing "20 min" would
  // be wrong on every deployment that raised it.
  const stopping = active ? loopRunStopRequested(active.id) : false;
  const stopHorizonMs = active ? agentTimeoutMs(active.agentTimeoutMs) : null;
  // ADR-0001 §3 — THE FACT THAT RETIRES THE `hosted` CARD. `enabled` above answers "can this
  // deployment run a LOCAL loop", and the cockpit used to infer everything else from `selfHosted` in
  // the browser: a cloud owner who could dispatch was shown a self-hosting guide because a client-side
  // read of deployment mode is not the question. `hosted` is the server's own answer to "can THIS org
  // dispatch a run Ascent gets worked", with the reason when it cannot. A read failure degrades to
  // refused-with-a-reason rather than absent, because an absent field means "an older server" to the
  // gate and would be read as the old behaviour.
  const hosted = await resolveHostedGate(org).catch(() => ({
    enabled: false,
    reason: "Could not read this organization's hosted-dispatch status.",
    available: false,
  }));
  return NextResponse.json({
    enabled: autopilotEnabled(),
    active,
    runs,
    prices,
    prAvailable: isAppConfigured(),
    stopping,
    stopHorizonMs,
    hosted,
  });
}

/** `?beforeSeq=<n>&limit=<k>` → `{ runs }`: runs numbered below `n`, newest first, at most `k` (1–100,
 *  default 20). A malformed parameter is a 400, never a silently different page. */
async function runsPage(org: string, params: URLSearchParams) {
  const int = (raw: string | null, min: number, max: number): number | null | false => {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : false;
  };
  const beforeSeq = int(params.get("beforeSeq"), 1, Number.MAX_SAFE_INTEGER);
  const limit = int(params.get("limit"), 1, 100);
  if (beforeSeq === false) return NextResponse.json({ error: "'beforeSeq' must be a positive whole number." }, { status: 400 });
  if (limit === false) return NextResponse.json({ error: "'limit' must be a whole number from 1 to 100." }, { status: 400 });
  const runs = await listLoopRuns(org, limit ?? 20, { beforeSeq });
  return NextResponse.json({ runs });
}

type Body = {
  action?: unknown;
  org?: unknown;
  id?: unknown;
  laneId?: unknown;
  cover?: unknown;
  verdict?: unknown;
  repos?: unknown;
  batches?: unknown;
  concurrency?: unknown;
  maxCycles?: unknown;
  curated?: unknown;
  model?: unknown;
  effort?: unknown;
  modelPolicy?: unknown;
  models?: unknown;
  /** The ARMS of a run (src/lib/local/arm.ts) — transport + model each, optionally a different
   *  planning half. Supersedes `models`, which could only ever name Claude aliases. */
  arms?: unknown;
  /** `single` | `compare`. Read only when `arms` is present. */
  armPolicy?: unknown;
  /** branch | land | pr — what happens to each lane's branch when its cycle succeeds. */
  delivery?: unknown;
  /** Items per lane per cycle (1–BATCH_SIZE_CAP); omitted = the default 5. */
  batchSize?: unknown;
  /** Per-session agent ceiling in ms; omitted = the deployment's ASCENT_AUTOPILOT_TIMEOUT_MS. */
  agentTimeoutMs?: unknown;
  /** `on` | `off` — the A/B degradation guard. Omitted = `on`. */
  verifyMode?: unknown;
  /** Budget for ONE run of the repository's verification command, ms. Omitted = 10 minutes. */
  verifyTimeoutMs?: unknown;
  /** `cycle` | `run` — rescan after every cycle (default) or once after the last cycle a repo
   *  progressed in. Opt-in: intermediate cycles then settle at the run's end, not their own. */
  rescanCadence?: unknown;
  /**
   * `on` — run the read-only PLANNING session before the editing one. Omitted = off, which is what
   * every manual run before this field did.
   *
   * IT IS LOAD-BEARING FOR A SPLIT ARM AND IT WAS MISSING. An arm may name a different transport and
   * model for its planning half, and that half is only ever spawned by the planning session — so
   * with plan mode off, a "Claude plans, a local model executes" arm silently ran the local model for
   * BOTH halves and recorded `planModel: null`. The configuration the arms feature exists for was
   * unreachable from this door; only the standing runner, which sets `planMode` itself, could produce
   * it. Found by running one (2026-09-21) and reading the lane row rather than the intent.
   *
   * Since challenge-2026-09-23b a split arm with no `planMode` implies `on`, and `off` beside a split
   * arm is a 400 (`run-spec.ts`): the cockpit's manual Run never sent the field, so the fix at this
   * route alone still left the cockpit's own door producing the collapse.
   */
  planMode?: unknown;
  /** #3 — `local` (the default, and what every caller before it meant), `remote-agent`, or `hosted`
   *  (ADR-0001: a run Ascent Cloud dispatches to a worker of its own). The wire word is `hosted`; the
   *  lane rows record `hosted-worker`, which is the executor vocabulary's word for the same thing. */
  executor?: unknown;
};

export async function POST(request: Request) {
  // THE BODY IS READ BEFORE THE SELF-HOST GUARD (moonshot #3), and only for that guard's sake.
  // `executor: "remote-agent"` starts a run Ascent does not drive: no worktree, no process, no
  // filesystem. The self-hosted and autopilot gates exist because a LOCAL run spawns an editing agent
  // inside a paired working copy — neither reason applies to a run whose work happens in somebody
  // else's harness, and applying them anyway would make the hosted half of the protocol unreachable
  // on the exact deployments it exists for. Every other gate below is unchanged, including
  // `requireOrgRole("owner")`.
  //
  // ADR-0001 adds a THIRD executor on the same reasoning. `hosted` is a run ASCENT CLOUD gets worked:
  // still no worktree, still no process here, so `selfHostGuard` does not apply to it either — and
  // applying it would 404 the one surface the managed product exists to offer. What replaces the
  // self-hosted checks for it is the gate table in `startHostedRun`, which is stricter than the local
  // one, not looser: entitlement, credit headroom, a recorded per-repo admission, and pr-only delivery.
  const body = (await request.json().catch(() => ({}))) as Body;
  const remote = body.executor === "remote-agent";
  const hosted = body.executor === "hosted";
  const guard = (remote || hosted ? null : selfHostGuard()) ?? dbGuard("The improvement loop", "The improvement loop requires a database.");
  if (guard) return guard;

  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const action =
    body.action === "start" || body.action === "stop" || body.action === "retry" || body.action === "review"
      ? body.action
      : null;
  if (!org || !action) return NextResponse.json({ error: "Missing 'org' or 'action'." }, { status: 400 });
  if (org === PUBLIC_ORG) return NextResponse.json({ error: "The public funnel org has no improvement loop." }, { status: 403 });

  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  // `stop` / `retry` / `review` are unaffected by the executor: they name a row, and a remote run's
  // rows are stopped and reviewed by exactly the same owner-gated, tenancy-rechecked path.
  if (action === "stop") return stop(org, body);
  if (action === "retry") return retry(org, body);
  // `review` sits with stop/retry, BEFORE the autopilot gate: ruling on what a past run delivered
  // must work on a deployment where the loop itself has since been switched off.
  if (action === "review") return review(org, body);

  if (!remote && !hosted && !autopilotEnabled()) {
    return NextResponse.json(
      { error: "The loop is not enabled on this deployment — set ASCENT_AUTOPILOT=1 (and make sure the claude CLI is available)." },
      { status: 409 },
    );
  }
  const repos = Array.isArray(body.repos) ? body.repos.filter((r): r is string => typeof r === "string") : [];
  if (repos.length === 0) return NextResponse.json({ error: "Missing 'repos'." }, { status: 400 });

  if (hosted) {
    // A HOSTED RUN takes the same none-of-the-local-dials shape a remote one does, for the same
    // reason: Ascent schedules nothing, the worker decides its own cycle, and a model Ascent did not
    // choose must not be recorded on the row. `delivery` is the ONE dial it reads, and only so that a
    // caller who asked for `land` is refused with that fact rather than silently given a PR.
    const viewer = await getViewer().catch(() => null);
    try {
      const run = await startHostedRun({
        org,
        repos,
        batches: parseBatches(body.batches),
        delivery: normalizeDelivery(body.delivery),
        actor: viewer?.login ?? null,
      });
      return NextResponse.json({ run }, { status: 202 });
    } catch (err) {
      // Each gate answers with its OWN code (402 money, 403 a decision, 409 not the caller's to fix).
      // Everything else keeps the 409 every arm failure on this route has always been.
      if (err instanceof HostedRunRefused) {
        return NextResponse.json({ error: err.message, code: err.block }, { status: hostedBlockStatus(err.block) });
      }
      return NextResponse.json({ error: err instanceof Error ? err.message : "Could not arm the run." }, { status: 409 });
    }
  }

  if (remote) {
    // A REMOTE RUN takes none of the local dials — no concurrency (Ascent schedules nothing), no
    // cycle count (an agent decides its own), no model or A/B arms (Ascent does not choose the model
    // and must not record one it did not choose). Silently accepting them would put numbers on the
    // row that describe a run nobody configured.
    const viewer = await getViewer().catch(() => null);
    try {
      const run = await startRemoteRun({
        org,
        repos,
        batches: parseBatches(body.batches),
        actor: viewer?.login ?? null,
      });
      return NextResponse.json({ run });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Could not arm the run." }, { status: 409 });
    }
  }

  // THE RUN SPEC: cycles, lanes, the agent configuration and every dial, parsed by `run-spec.ts`, the
  // SAME function the drive door calls on `body.dials` (challenge-2026-09-23b). Two hand-kept copies
  // had stopped agreeing on a sent null, a modelPolicy typo and a fractional cycle count; now an input
  // has one verdict at either door. Absent or null = the deployment default; sent-but-unrecognised =
  // a 400 naming the band, never a run quietly configured with a number nobody asked for.
  //
  // PLAN MODE is implied `on` for a split arm, and an explicit `off` beside one is refused: the planning
  // session is the only thing that spawns an arm's planning half, so off would run the executing
  // transport for both halves under the split arm's name.
  const spec = parseRunSpec(body, { maxCycles: LOOP_MAX_CYCLES_CAP, concurrency: LOOP_CONCURRENCY_CAP }, "body");
  if (!spec.ok) return NextResponse.json({ error: spec.error }, { status: 400 });
  const { maxCycles, concurrency, model, effort, dials } = spec.value;

  // DELIVERY. Normalized against the same closed list the picker offers (`normalizeDelivery`), so an
  // unknown value is `null` — "unchosen", which the run records as `branch`. `pr` is the one mode that
  // can be genuinely unavailable, and it is REFUSED rather than downgraded: a run armed for PRs that
  // quietly left branches behind would leave the operator believing their work was in review.
  const delivery = normalizeDelivery(body.delivery);
  if (delivery === "pr" && !isAppConfigured()) {
    return NextResponse.json(
      { error: "This deployment has no GitHub App configured, so the loop cannot open pull requests. Choose another delivery mode." },
      { status: 409 },
    );
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
      // Normalized against the closed list the picker offers, never passed through: both values reach
      // a re-parsing shell in the agent runner (`parseRunShape`).
      model,
      effort,
      delivery,
      // Null, not omitted: a column the caller named no value for records the deployment default,
      // byte-identical to every run armed before these dials existed.
      batchSize: dials.batchSize ?? null,
      agentTimeoutMs: dials.agentTimeoutMs ?? null,
      verifyMode: dials.verifyMode ?? null,
      verifyTimeoutMs: dials.verifyTimeoutMs ?? null,
      rescanCadence: dials.rescanCadence ?? null,
      // Null, not omitted-and-defaulted: `startLoopRun` persists `planMode` on the row so a retry
      // plans exactly as the original did, and a split arm's two halves depend on it.
      planMode: dials.planMode === "on" ? "on" : null,
      // The two vocabularies, never merged: `arms` is what a run armed today carries, `models` is the
      // pre-arms Claude pair. A body that sends arms takes the arm path; anything else replays.
      ...(dials.arms && dials.armPolicy
        ? { arms: dials.arms, armPolicy: dials.armPolicy }
        : dials.modelPolicy === "ab" && dials.models
          ? { modelPolicy: "ab" as const, models: dials.models }
          : {}),
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

/** The quick-approval gate: record an owner's ruling on one deliverable row (the loop proposes, the
 *  human disposes). Same tenancy re-check as `retry` — the laneId names a row, authorization named
 *  a slug, so the lane's run must belong to the org the caller was authorized for. */
async function review(org: string, body: Body): Promise<NextResponse> {
  const laneId = typeof body.laneId === "string" ? body.laneId : "";
  const cover = typeof body.cover === "string" ? body.cover.trim() : "";
  const verdict = body.verdict === "approved" || body.verdict === "dismissed" ? body.verdict : null;
  if (!laneId || !cover || !verdict) {
    return NextResponse.json({ error: "Missing 'laneId', 'cover' or 'verdict' (approved | dismissed)." }, { status: 400 });
  }
  const lane = await getLane(laneId);
  const run = lane ? await getLoopRun(lane.runId) : null;
  if (!lane || !run || run.orgId !== (await orgIdForSlug(org))) {
    return NextResponse.json({ error: "No such lane." }, { status: 404 });
  }
  const deliverables = await reviewDeliverable(laneId, cover, verdict);
  if (!deliverables) return NextResponse.json({ error: "Could not record the review." }, { status: 409 });
  return NextResponse.json({ ok: true, deliverables });
}

/** `{ "owner/repo": ["recId", …] }`, defensively narrowed — it arrives from the wire. */
function parseBatches(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
