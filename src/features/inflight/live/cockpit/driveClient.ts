// The cockpit's HTTP edge for the DRIVE route — one function per verb, each throwing an Error
// carrying the server's own message (a 409 "a drive is already running for this organization" is the
// single most useful thing the panel can say, and a generic failure would throw it away).
//
// Same shape and same reasons as loopClient.ts: kept apart from the hook so useDrive is a state
// machine and nothing else.

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
  repos: string[];
  /** The rope: how many loop runs the drive may spend before it stops at the ceiling. */
  maxRuns: number;
  maxCycles: number;
  concurrency: number;
  /** Inherited by EVERY run the drive dispatches, so the whole drive is one experiment. */
  model: string | null;
  effort: string | null;
}

export const startDrive = (slug: string, input: StartDriveInput): Promise<{ drive: DriveStatus }> =>
  post<{ drive: DriveStatus }>(slug, { action: "start", ...input }, "Could not start the drive");

export const stopDrive = (slug: string, id: string): Promise<{ ok: boolean; drive: DriveStatus }> =>
  post<{ ok: boolean; drive: DriveStatus }>(slug, { action: "stop", id }, "Could not stop the drive");

/** Re-arm an INTERRUPTED drive. The server starts a NEW drive continuing the same chain, so the
 *  response carries a different id from the one asked about — the caller adopts what comes back. */
export const resumeDrive = (slug: string, id: string): Promise<{ drive: DriveStatus }> =>
  post<{ drive: DriveStatus }>(slug, { action: "resume", id }, "Could not resume the drive");
