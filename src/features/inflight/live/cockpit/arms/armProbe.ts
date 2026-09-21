// THE PREFLIGHT PROBE'S BROWSER EDGE — one POST for the whole ARM SET, and the reading of what comes
// back.
//
// Pure and hook-free on purpose (same split as `driveClient.ts` beside it): the hook is a state
// machine and nothing else, and the sentence an operator has to ACT on is built here where it can be
// tested without a DOM.
//
// A blocked probe must say what to DO, and WHICH ARM it is about. "Local transport not ready" is a
// red light; "arm 2's execute half: your server's declared context is 32768, set
// OLLAMA_CONTEXT_LENGTH to 65536 and restart" is a fix — the `remedy` field on every failed finding
// carries the action, the arm verdict carries the attribution, and this file only has to refuse to
// throw either away.
//
// THE WIRE TYPES LIVE HERE and the route imports them (the same direction
// `practiceApplyShared`'s `BatchResult` runs). One declaration, so a reply the route can build is by
// construction a reply this edge can read.

import type { ArmPolicy, TransportId } from "@/lib/local/arm";
import type { ProbeFinding, ProbeResult } from "@/lib/local/transport/probe";

/** WP4's route. Same `/api/org/local/*` family and same `org` body field as the drive route. */
const ENDPOINT = "/api/org/local/probe";

/** Which half of an arm a verdict is about. A split arm has two that differ. */
export type ArmHalfRole = "execute" | "plan";

export interface ArmHalfVerdict {
  role: ArmHalfRole;
  transport: TransportId;
  model: string;
  /** The local endpoint this half resolved to, server-side, or null for "the transport's own seat". */
  endpoint: string | null;
  /** Index into `ArmProbeReply.probes`. Two halves that ask an identical question share one. */
  probe: number;
}

export interface ArmVerdict {
  armId: string;
  label: string;
  /** Every half's probe passed. A run may only be armed when this is true of every arm. */
  ok: boolean;
  /** The one sentence this arm's refusal shows, naming the arm and the half. Null when it passed. */
  refusal: string | null;
  halves: ArmHalfVerdict[];
}

/** The route's reply: a verdict per arm, the de-duplicated probes they rest on, and the joined
 *  refusal (null when every arm passed). */
export interface ArmProbeReply {
  arms: ArmVerdict[];
  probes: ProbeResult[];
  refusal: string | null;
}

function isReply(v: unknown): v is ArmProbeReply {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.arms) && Array.isArray(o.probes);
}

/**
 * Probe the arms as configured.
 *
 * `arms` is `draftsToWire(drafts)` — the same plain records the start route receives, so the probe is
 * a verdict about the configuration that will actually be armed and not about a summary of it. No
 * `endpoint` is sent: the local endpoint is resolved from the server's environment
 * (`src/lib/local/endpoint.ts`, the one place an arm half is judged local and given something to talk
 * to), and a base URL typed in a browser would be a second answer to a question the deployment
 * already answers. The MODEL travels, because the endpoint cannot be resolved without one.
 */
export async function probeArmsOverHttp(
  slug: string,
  arms: readonly Record<string, unknown>[],
  policy: ArmPolicy,
): Promise<ArmProbeReply> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org: slug, arms, armPolicy: policy }),
  });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const error = body && typeof body === "object" ? (body as { error?: string }).error : undefined;
    throw new Error(error ?? `Could not probe the arms (${res.status}).`);
  }
  if (!isReply(body)) throw new Error("Could not probe the arms.");
  return body;
}

/** One failed check, carrying the arm and the half it blocks. */
export interface BlockedCheck {
  armId: string;
  label: string;
  role: ArmHalfRole;
  transport: TransportId;
  finding: ProbeFinding;
}

/**
 * Every failed check, attributed to the arm and half that depends on it.
 *
 * A non-split arm's two halves share one probe, so its findings are listed ONCE per arm — the
 * de-duplication is in the work and in the repetition, never in the attribution: two arms blocked by
 * the same server both say so, because "which arm can I not run" is the question being answered.
 */
export function blockedChecks(reply: ArmProbeReply | null): BlockedCheck[] {
  if (!reply) return [];
  const out: BlockedCheck[] = [];
  for (const arm of reply.arms) {
    if (arm.ok) continue;
    const seen = new Set<number>();
    for (const half of arm.halves) {
      if (seen.has(half.probe)) continue;
      seen.add(half.probe);
      const probe = reply.probes[half.probe];
      if (!probe) continue;
      for (const finding of probe.findings) {
        if (!finding.ok) {
          out.push({ armId: arm.armId, label: arm.label, role: half.role, transport: half.transport, finding });
        }
      }
    }
  }
  return out;
}

/** One failed check as a sentence: what was wrong, and the action. Observed/required are printed when
 *  present because "32768 where 65536 is required" is the half of the message that makes the remedy
 *  believable. */
export function findingSentence(f: ProbeFinding): string {
  const gap =
    f.observed && f.required ? `${f.observed} — ${f.required} required` : (f.observed ?? f.required ?? "check failed");
  return f.remedy ? `${gap}. ${f.remedy}` : `${gap}.`;
}

/** Every probe in the reply was free. False means one of them spent tokens. */
export const allZeroToken = (reply: ArmProbeReply | null): boolean => !!reply && reply.probes.every((p) => p.zeroToken);

export const allArmsOk = (reply: ArmProbeReply | null): boolean =>
  !!reply && reply.arms.length > 0 && reply.arms.every((a) => a.ok);
