// THE PREFLIGHT PROBE'S BROWSER EDGE — one POST per transport, and the reading of what comes back.
//
// Pure and hook-free on purpose (same split as `driveClient.ts` beside it): the hook is a state
// machine and nothing else, and the sentence an operator has to ACT on is built here where it can be
// tested without a DOM.
//
// A blocked probe must say what to DO. "Local transport not ready" is a red light; "your server's
// declared context is 4096, set OLLAMA_CONTEXT_LENGTH to 65536 and restart" is a fix — and the
// `remedy` field on every failed finding is where the probe puts it, so this file only has to refuse
// to throw it away.

import type { TransportId } from "@/lib/local/arm";
import type { ProbeFinding, ProbeResult } from "@/lib/local/transport/probe";

/** WP4's route. Same `/api/org/local/*` family and same `org` body field as the drive route. */
const ENDPOINT = "/api/org/local/probe";

/** The route's reply: the result, plus the one sentence it refuses with (null when it passed). */
export interface ProbeReply {
  probe: ProbeResult;
  refusal: string | null;
}

/**
 * No `endpoint` is sent. The panel has no field for one, and it should not: the local endpoint is
 * resolved from the server's environment (`transport/run.ts`), so a base URL typed in a browser would
 * be a second answer to a question the deployment already answers — and the probe's whole point is to
 * measure the environment the run will actually use.
 */
export async function probeTransportOverHttp(slug: string, transport: TransportId): Promise<ProbeReply> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org: slug, transport }),
  });
  const body = (await res.json().catch(() => null)) as { probe?: ProbeResult; refusal?: string | null; error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `Could not probe ${transport} (${res.status}).`);
  if (!body?.probe || typeof body.probe.ok !== "boolean") throw new Error(`Could not probe ${transport}.`);
  return { probe: body.probe, refusal: body.refusal ?? null };
}

/** Every failed check across every probed transport, in the order they were checked. */
export function failedFindings(results: readonly ProbeResult[]): { transport: TransportId; finding: ProbeFinding }[] {
  return results.flatMap((r) => r.findings.filter((f) => !f.ok).map((finding) => ({ transport: r.transport, finding })));
}

/** One failed check as a sentence: what was wrong, and the action. Observed/required are printed when
 *  present because "4096 where 65536 is required" is the half of the message that makes the remedy
 *  believable. */
export function findingSentence(f: ProbeFinding): string {
  const gap =
    f.observed && f.required ? `${f.observed} — ${f.required} required` : (f.observed ?? f.required ?? "check failed");
  return f.remedy ? `${gap}. ${f.remedy}` : `${gap}.`;
}

export const allOk = (results: readonly ProbeResult[]): boolean => results.length > 0 && results.every((r) => r.ok);
