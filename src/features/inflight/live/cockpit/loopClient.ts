// The cockpit's HTTP edge — one function per loop endpoint, each throwing an Error carrying the
// server's own message. Kept apart from useLoopRun so the hook is state machine and nothing else,
// and so a test can drive either half (a fetch stub here, or these functions mocked) on its own.

import type { LoopDelivery } from "@/lib/local/delivery-options";
import type { VerifyMode } from "@/lib/local/run-limits";
import type { LoopLessonRow, LoopProposal, LoopRunDetail, LoopRunRecord, LoopStatusPayload, RemediationPriceList } from "./loopTypes";

async function json<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `${fallback} (${res.status}).`);
  if (!body) throw new Error(fallback);
  return body;
}

export async function fetchLoopStatus(slug: string): Promise<LoopStatusPayload> {
  const res = await fetch(`/api/org/loop?org=${encodeURIComponent(slug)}`, { cache: "no-store" });
  return json<LoopStatusPayload>(res, "Could not read the loop status");
}

/**
 * The org's remediation price list, off the SAME status route (it has no route of its own: it is
 * derived at read time and stores nothing, so there is no id to gate). `null` when the deployment
 * cannot produce one — which the panel renders as silence, not as zeros.
 */
export async function fetchLoopPrices(slug: string): Promise<RemediationPriceList | null> {
  const status = await fetchLoopStatus(slug);
  return status.prices ?? null;
}

export async function fetchLoopDetail(slug: string, id: string): Promise<LoopRunDetail> {
  const res = await fetch(`/api/org/loop/${encodeURIComponent(id)}?org=${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });
  return json<LoopRunDetail>(res, "Could not read that run");
}

export async function fetchLoopProposals(slug: string, repos: readonly string[]): Promise<LoopProposal[]> {
  if (repos.length === 0) return [];
  const q = `org=${encodeURIComponent(slug)}&repos=${encodeURIComponent(repos.join(","))}`;
  const res = await fetch(`/api/org/loop/propose?${q}`, { cache: "no-store" });
  const body = await json<{ proposals?: LoopProposal[] }>(res, "Could not propose a batch");
  return body.proposals ?? [];
}

/** Pending lesson CANDIDATES — nothing here is in Org Memory until a human keeps it. */
export async function fetchLoopLessons(slug: string): Promise<LoopLessonRow[]> {
  const res = await fetch(`/api/org/loop/lessons?org=${encodeURIComponent(slug)}&status=pending`, { cache: "no-store" });
  const body = await json<{ lessons?: LoopLessonRow[] }>(res, "Could not read the lesson candidates");
  return body.lessons ?? [];
}

/** Keep (promote into memory, through the shared memory door) or discard (soft) one candidate. */
export async function settleLoopLesson(slug: string, id: string, action: "keep" | "discard"): Promise<LoopLessonRow> {
  const res = await fetch("/api/org/loop/lessons", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org: slug, id, action }),
  });
  const body = await json<{ lesson: LoopLessonRow }>(res, "Could not settle that lesson");
  return body.lesson;
}

export interface LanePrResult {
  prNumber: number;
  prUrl: string;
  /** True when an open PR for this branch already existed and was returned instead of a new one. */
  reused: boolean;
}

/**
 * Push a finished lane's branch and open a reviewed PR (moonshot #26). `confirm` must be the lane's
 * own `repoFullName` — the route checks it, and the typed confirmation is the friction that belongs
 * on the one loop action whose effect leaves the operator's machine.
 */
export async function openLanePr(slug: string, runId: string, laneId: string, confirm: string): Promise<LanePrResult> {
  const res = await fetch(`/api/org/loop/${encodeURIComponent(runId)}/pr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org: slug, laneId, confirm }),
  });
  return json<LanePrResult>(res, "Could not open a PR for that lane");
}

async function post<T>(slug: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const res = await fetch("/api/org/loop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org: slug, ...body }),
  });
  return json<T>(res, fallback);
}

export interface StartLoopInput {
  repos: string[];
  /** `{ "owner/repo": [recId, …] }` — the pruned batch, omitted to let the engine pick its own. */
  batches?: Record<string, string[]>;
  concurrency: number;
  maxCycles: number;
  /** Agent configuration for this run; null on either means "use the deployment's default". */
  model: string | null;
  effort: string | null;
  /** What happens to each lane's branch: `branch` | `land` | `pr`. Omitted means `branch`. */
  delivery?: LoopDelivery;
  /** Items one lane works per cycle. Omitted = the default 5, byte-identical to a pre-dial run. */
  batchSize?: number;
  /** Per-session agent ceiling, MILLISECONDS (the dial is in minutes; the wire is in ms because the
   *  server's band is). Omitted = the deployment's own `ASCENT_AUTOPILOT_TIMEOUT_MS`. */
  agentTimeoutMs?: number;
  /** The A/B degradation guard. Omitted = `on`. */
  verifyMode?: VerifyMode;
  /** Budget for ONE run of the repository's own check, MILLISECONDS. Omitted = 10 minutes. */
  verifyTimeoutMs?: number;
}

export const startLoop = (slug: string, input: StartLoopInput): Promise<{ run: LoopRunRecord }> =>
  post<{ run: LoopRunRecord }>(slug, { action: "start", curated: input.batches != null, ...input }, "Could not start the loop");

export const stopLoop = (slug: string, id: string): Promise<{ ok: boolean; run: LoopRunRecord | null }> =>
  post<{ ok: boolean; run: LoopRunRecord | null }>(slug, { action: "stop", id }, "Could not stop the run");

export const retryLoopLane = (slug: string, laneId: string): Promise<{ ok: boolean }> =>
  post<{ ok: boolean }>(slug, { action: "retry", laneId }, "Could not retry that lane");

/**
 * The quick-approval gate: record the owner's ruling on one deliverable row. `cover` is the row's
 * first `covers` id, or its headline when it covers nothing — the same key the store matches on.
 */
export const reviewLoopDeliverable = (
  slug: string,
  laneId: string,
  cover: string,
  verdict: "approved" | "dismissed",
): Promise<{ ok: boolean }> =>
  post<{ ok: boolean }>(slug, { action: "review", laneId, cover, verdict }, "Could not record the review");
