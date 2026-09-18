// THE LEDGER'S HTTP EDGE — every call the ledger makes, in ONE module, so the request/response shapes
// the view depends on can be reconciled against the routes in one place.
//
// Each function throws an Error carrying the SERVER's own message (a 409 "This plan is already
// approved" is the most useful sentence the inbox can show; a generic failure would throw it away).
// Nothing here is optimistic: a caller updates its state from what these RETURN, never from what it
// asked for.

import type { PlanDecisionBody } from "@/lib/local/runner-types";
import { resumeRunnerRepo } from "../cockpit/driveClient";
import type { LoopRunDetail } from "../cockpit/loopTypes";
import type {
  DriveStatus,
  LoopDirectionRecord,
  LoopPlanRecord,
  LoopRunChronicleEntry,
  RunnerKeptLessonRow,
  RunnerMergeResponse,
} from "./ledgerTypes";

async function json<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `${fallback} (${res.status}).`);
  if (!body) throw new Error(fallback);
  return body;
}

const post = (url: string, body: unknown): Promise<Response> =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const q = (v: string) => encodeURIComponent(v);

// ── the inbox ────────────────────────────────────────────────────────────────────────────────────

/** `GET /api/org/loop/plans?org=&status=pending` — re-read after a revoke returns plans to pending. */
export async function fetchPendingPlans(slug: string): Promise<LoopPlanRecord[]> {
  const res = await fetch(`/api/org/loop/plans?org=${q(slug)}&status=pending&limit=200`, { cache: "no-store" });
  return (await json<{ plans: LoopPlanRecord[] }>(res, "Could not read the pending plans")).plans ?? [];
}

/** `POST /api/org/loop/plans/[id]` → `{ plan, direction }` (direction only on approve). */
export async function decidePlan(
  id: string,
  body: PlanDecisionBody,
): Promise<{ plan: LoopPlanRecord; direction: LoopDirectionRecord | null }> {
  const res = await post(`/api/org/loop/plans/${q(id)}`, body);
  return json(res, "The decision did not land");
}

/** `POST /api/org/local/drive { action: "resume-repo" }` → the drive — lifts one repo's pause. ONE door
 *  to that action: the cockpit's `resumeRunnerRepo` is the implementation, listed here so this module
 *  stays the ledger's complete inventory of what it calls. */
export async function resumeRepo(slug: string, repo: string): Promise<DriveStatus> {
  return (await resumeRunnerRepo(slug, repo)).drive;
}

// ── the runner branch ────────────────────────────────────────────────────────────────────────────

/** `POST /api/org/local/runner/merge { org, repo }`. A `commands` outcome is a 200 answer, not an error. */
export async function mergeRunner(slug: string, repo: string): Promise<RunnerMergeResponse> {
  const res = await post("/api/org/local/runner/merge", { org: slug, repo });
  return json<RunnerMergeResponse>(res, "Could not merge the runner branch");
}

// ── directions ───────────────────────────────────────────────────────────────────────────────────

/** `POST /api/org/loop/directions/[id] { action }` → `{ direction }`. */
export async function settleDirection(id: string, action: "revoke" | "done"): Promise<LoopDirectionRecord> {
  const res = await post(`/api/org/loop/directions/${q(id)}`, { action });
  return (await json<{ direction: LoopDirectionRecord }>(res, "Could not update that direction")).direction;
}

// ── the chronicle ────────────────────────────────────────────────────────────────────────────────

/** `GET /api/org/loop?org=&beforeSeq=&limit=` → `{ runs }` — the page of runs numbered below `beforeSeq`. */
export async function fetchRunsPage(slug: string, beforeSeq: number, limit: number): Promise<LoopRunChronicleEntry[]> {
  const res = await fetch(`/api/org/loop?org=${q(slug)}&beforeSeq=${beforeSeq}&limit=${limit}`, { cache: "no-store" });
  return (await json<{ runs: LoopRunChronicleEntry[] }>(res, "Could not read older runs")).runs ?? [];
}

/** `GET /api/org/loop/<id>?org=` — one run in full (the existing detail route). */
export async function fetchRunDetail(slug: string, id: string): Promise<LoopRunDetail> {
  const res = await fetch(`/api/org/loop/${q(id)}?org=${q(slug)}`, { cache: "no-store" });
  return json<LoopRunDetail>(res, "Could not read that run");
}

// ── runner-kept lessons ──────────────────────────────────────────────────────────────────────────

/** `POST /api/org/loop/lessons { action: "revoke" }` → `{ lesson }` (owner). Archives the memory. */
export async function revokeLesson(slug: string, id: string): Promise<RunnerKeptLessonRow> {
  const res = await post("/api/org/loop/lessons", { org: slug, id, action: "revoke" });
  return (await json<{ lesson: RunnerKeptLessonRow }>(res, "Could not revoke that lesson")).lesson;
}

// ── the presence stamp ───────────────────────────────────────────────────────────────────────────

/** `POST /api/org/loop/seen { org }` — advance the viewer's own "since you last looked" anchor. */
export async function stampLiveSeen(slug: string): Promise<boolean> {
  const res = await post("/api/org/loop/seen", { org: slug });
  return (await json<{ seen: boolean }>(res, "Could not record the visit")).seen === true;
}
