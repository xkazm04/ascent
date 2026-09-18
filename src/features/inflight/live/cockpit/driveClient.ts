// The cockpit's HTTP edge for the DRIVE route — one function per verb, each throwing an Error
// carrying the server's own message (a 409 "a drive is already running for this organization" is the
// single most useful thing the panel can say, and a generic failure would throw it away).
//
// Same shape and same reasons as loopClient.ts: kept apart from the hook so useDrive is a state
// machine and nothing else. The Ledger's per-repo "Resume" and the cockpit's share `resumeRunnerRepo`
// here — one door to `action: "resume-repo"`, not two spellings of it.

import type { LoopDelivery } from "@/lib/local/delivery-options";
import type { DriveDials, DriveMode } from "@/lib/local/runner-types";
import type { DriveStatus, DriveStatusPayload } from "./driveTypes";

const ENDPOINT = "/api/org/local/drive";

async function json<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `${fallback} (${res.status}).`);
  if (!body) throw new Error(fallback);
  return body;
}

export async function fetchDriveStatus(slug: string): Promise<DriveStatusPayload> {
  const res = await fetch(`${ENDPOINT}?org=${encodeURIComponent(slug)}`, { cache: "no-store" });
  return json<DriveStatusPayload>(res, "Could not read the drive status");
}

async function post<T>(slug: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org: slug, ...body }),
  });
  return json<T>(res, fallback);
}

export interface StartDriveInput {
  /** Explicit scope. Omitted (the runner's default) = every watched, paired repo, resolved server-side. */
  repos?: string[];
  /** The rope: how many loop runs a BOUNDED drive may spend. A runner has none — omit it. */
  maxRuns?: number;
  maxCycles: number;
  concurrency: number;
  /** Inherited by EVERY run the drive dispatches, so the whole drive is one experiment. */
  model: string | null;
  effort: string | null;
  /** Inherited the same way, and it survives a resume — see `resumeParams`. Never sent for a runner:
   *  the route forces `runner` delivery and refuses any other. */
  delivery?: LoopDelivery;
  /** The run dials every dispatched run is armed with (`drive-dials.ts` validates them). Both modes. */
  dials?: DriveDials;
  /** `continuous` arms the standing runner; omitted = a bounded drive. */
  mode?: DriveMode;
  /** The runner's daily ceiling in USD; `0` = none. Omitted = the deployment default. */
  spendCeilingUsd?: number;
}

export const startDrive = (slug: string, input: StartDriveInput): Promise<{ drive: DriveStatus }> =>
  post<{ drive: DriveStatus }>(slug, { action: "start", ...input }, "Could not start the drive");

export const stopDrive = (slug: string, id: string): Promise<{ ok: boolean; drive: DriveStatus }> =>
  post<{ ok: boolean; drive: DriveStatus }>(slug, { action: "stop", id }, "Could not stop the drive");

/** Re-arm an INTERRUPTED drive. The server starts a NEW drive continuing the same chain, so the
 *  response carries a different id from the one asked about — the caller adopts what comes back. */
export const resumeDrive = (slug: string, id: string): Promise<{ drive: DriveStatus }> =>
  post<{ drive: DriveStatus }>(slug, { action: "resume", id }, "Could not resume the drive");

/** Lift ONE repo's pause on the live standing runner (a failure streak, a branch conflict, a dry
 *  backoff). The live runner is found by the org; the response is the runner as it now stands. */
export const resumeRunnerRepo = (slug: string, repo: string): Promise<{ drive: DriveStatus }> =>
  post<{ drive: DriveStatus }>(slug, { action: "resume-repo", repo }, `Could not resume ${repo}`);
