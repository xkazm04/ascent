// LOCAL-MODE IMPROVEMENT LOOP control (self-hosted only, ASCENT_AUTOPILOT=1 only).
//
//   GET  ?org=…                                              → { enabled, active, runs }
//   POST { action:"start",  org, repos[], batches?, concurrency?, maxCycles?, curated?, model?, effort?,
//          delivery?, batchSize?, agentTimeoutMs?, verifyMode?, verifyTimeoutMs? }  → { run }
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
import { autopilotEnabled } from "@/lib/local/agent";
import { normalizeAgentEffort, normalizeAgentModel } from "@/lib/local/agent-options";
import { normalizeDelivery } from "@/lib/local/delivery-options";
import {
  BATCH_SIZE_CAP,
  AGENT_TIMEOUT_CAP_MS,
  AGENT_TIMEOUT_MIN_MS,
  VERIFY_TIMEOUT_CAP_MS,
  VERIFY_TIMEOUT_MIN_MS,
  normalizeAgentTimeoutMs,
  normalizeBatchSize,
  normalizeVerifyMode,
  normalizeVerifyTimeoutMs,
} from "@/lib/local/run-limits";
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
import { isLoopRunLive, retryLane, startLoopRun, startRemoteRun, stopLoopRun } from "@/lib/local/loop-engine";
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
  const org = new URL(request.url).searchParams.get("org")?.trim().toLowerCase() ?? "";
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
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
  return NextResponse.json({ enabled: autopilotEnabled(), active, runs, prices, prAvailable: isAppConfigured() });
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
  /** #3 — `local` (the default, and what every caller before it meant) or `remote-agent`. */
  executor?: unknown;
};

/**
 * The two arms of an `ab` run, validated. `null` = "this body did not ask for an A/B run".
 *
 * Throws with a human reason for anything that asked and got it wrong, because an A/B run that
 * silently degrades to a single-model run produces a comparison the operator thinks they ran and did
 * not. Each name is checked against the SAME token rule `agent.ts` enforces before a spawn — `shell:
 * true` re-parses argv on Windows, so an unvalidated model name is an argument-injection surface and
 * the answer is a 400, never a spawn.
 */
const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function parseArms(body: Body): string[] | null {
  if (body.modelPolicy !== "ab") return null;
  const raw = Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === "string") : [];
  const arms = [...new Set(raw.map((m) => m.trim()).filter(Boolean))];
  if (arms.length !== 2) throw new Error("An A/B run needs exactly two distinct models in 'models'.");
  const bad = arms.find((m) => !MODEL_TOKEN.test(m));
  if (bad) throw new Error(`Invalid model "${bad}".`);
  return arms;
}

export async function POST(request: Request) {
  // THE BODY IS READ BEFORE THE SELF-HOST GUARD (moonshot #3), and only for that guard's sake.
  // `executor: "remote-agent"` starts a run Ascent does not drive: no worktree, no process, no
  // filesystem. The self-hosted and autopilot gates exist because a LOCAL run spawns an editing agent
  // inside a paired working copy — neither reason applies to a run whose work happens in somebody
  // else's harness, and applying them anyway would make the hosted half of the protocol unreachable
  // on the exact deployments it exists for. Every other gate below is unchanged, including
  // `requireOrgRole("owner")`.
  const body = (await request.json().catch(() => ({}))) as Body;
  const remote = body.executor === "remote-agent";
  const guard = (remote ? null : selfHostGuard()) ?? dbGuard("The improvement loop", "The improvement loop requires a database.");
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

  if (!remote && !autopilotEnabled()) {
    return NextResponse.json(
      { error: "The loop is not enabled on this deployment — set ASCENT_AUTOPILOT=1 (and make sure the claude CLI is available)." },
      { status: 409 },
    );
  }
  const repos = Array.isArray(body.repos) ? body.repos.filter((r): r is string => typeof r === "string") : [];
  if (repos.length === 0) return NextResponse.json({ error: "Missing 'repos'." }, { status: 400 });

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

  const maxCycles = intOr(body.maxCycles, 3);
  if (maxCycles < 1 || maxCycles > LOOP_MAX_CYCLES_CAP) {
    return NextResponse.json({ error: `maxCycles must be 1–${LOOP_MAX_CYCLES_CAP}.` }, { status: 400 });
  }
  const concurrency = intOr(body.concurrency, 2);
  if (concurrency < 1 || concurrency > LOOP_CONCURRENCY_CAP) {
    return NextResponse.json({ error: `concurrency must be 1–${LOOP_CONCURRENCY_CAP}.` }, { status: 400 });
  }

  let arms: string[] | null;
  try {
    arms = parseArms(body);
  } catch (err) {
    // A malformed A/B request is a 400 (the caller sent something invalid), not a 409 (the server
    // cannot do it right now) — and it never reaches the spawn seam.
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid model policy." }, { status: 400 });
  }

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

  // THE THROUGHPUT + GUARD DIALS. Each normalizer NEVER GUESSES (`run-limits.ts`): an unrecognised
  // value is `null`, and a caller that SENT one gets a 400 naming the band rather than a run quietly
  // configured with a number nobody asked for. Omitting a field entirely is the supported way to say
  // "use the deployment default", and that path is byte-identical to every run before these existed.
  const batchSize = normalizeBatchSize(body.batchSize);
  if (body.batchSize !== undefined && batchSize === null) {
    return NextResponse.json({ error: `batchSize must be a whole number 1–${BATCH_SIZE_CAP}.` }, { status: 400 });
  }
  const agentTimeoutMs = normalizeAgentTimeoutMs(body.agentTimeoutMs);
  if (body.agentTimeoutMs !== undefined && agentTimeoutMs === null) {
    return NextResponse.json(
      { error: `agentTimeoutMs must be a whole number of milliseconds between ${AGENT_TIMEOUT_MIN_MS} and ${AGENT_TIMEOUT_CAP_MS}.` },
      { status: 400 },
    );
  }
  const verifyMode = normalizeVerifyMode(body.verifyMode);
  if (body.verifyMode !== undefined && verifyMode === null) {
    return NextResponse.json({ error: "verifyMode must be 'on' or 'off'." }, { status: 400 });
  }
  const verifyTimeoutMs = normalizeVerifyTimeoutMs(body.verifyTimeoutMs);
  if (body.verifyTimeoutMs !== undefined && verifyTimeoutMs === null) {
    return NextResponse.json(
      { error: `verifyTimeoutMs must be a whole number of milliseconds between ${VERIFY_TIMEOUT_MIN_MS} and ${VERIFY_TIMEOUT_CAP_MS}.` },
      { status: 400 },
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
      // a re-parsing shell in the agent runner. An unrecognised value falls back to the deployment
      // default rather than 400-ing — a run must not fail because a stale tab sent a retired name.
      model: normalizeAgentModel(body.model),
      effort: normalizeAgentEffort(body.effort),
      delivery,
      batchSize,
      agentTimeoutMs,
      verifyMode,
      verifyTimeoutMs,
      ...(arms ? { modelPolicy: "ab" as const, models: arms } : {}),
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
