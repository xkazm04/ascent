// The cockpit's HTTP edge — one function per loop endpoint, each throwing an Error carrying the
// server's own message. Kept apart from useLoopRun so the hook is state machine and nothing else,
// and so a test can drive either half (a fetch stub here, or these functions mocked) on its own.

import type { LoopProposal, LoopRunDetail, LoopRunRecord, LoopStatusPayload } from "./loopTypes";

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
}

export const startLoop = (slug: string, input: StartLoopInput): Promise<{ run: LoopRunRecord }> =>
  post<{ run: LoopRunRecord }>(slug, { action: "start", curated: input.batches != null, ...input }, "Could not start the loop");

export const stopLoop = (slug: string, id: string): Promise<{ ok: boolean; run: LoopRunRecord | null }> =>
  post<{ ok: boolean; run: LoopRunRecord | null }>(slug, { action: "stop", id }, "Could not stop the run");

export const retryLoopLane = (slug: string, laneId: string): Promise<{ ok: boolean }> =>
  post<{ ok: boolean }>(slug, { action: "retry", laneId }, "Could not retry that lane");
