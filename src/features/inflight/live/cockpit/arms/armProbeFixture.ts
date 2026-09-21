// THE PROBE REPLY, SHAPED LIKE THE ROUTE'S — shared by the two DOM tests beside it so that what they
// drive is one description of the wire rather than two that can drift from it and from each other.
//
// Pure data and no hooks, so it deliberately carries no `"use client"`.

import type { ProbeFinding, ProbeResult } from "@/lib/local/transport/probe";
import type { ArmProbeReply, ArmVerdict } from "./armProbe";

export const CONTEXT_REMEDY = "set OLLAMA_CONTEXT_LENGTH to 65536 and restart the server";

/** The context miss measured on this machine on 2026-09-21: 32 768 served where 65 536 is required. */
export const CONTEXT_MISS: ProbeFinding = {
  check: "context",
  ok: false,
  observed: "4096",
  required: "65536",
  remedy: CONTEXT_REMEDY,
};

export function probeFixture(transport: ProbeResult["transport"], ...findings: ProbeFinding[]): ProbeResult {
  return {
    transport,
    ok: findings.every((f) => f.ok),
    at: "2026-09-21T10:00:00.000Z",
    zeroToken: true,
    findings: [{ check: "binary", ok: true, observed: `${transport} 1.0.0` }, ...findings],
  };
}

export interface ArmFixture {
  armId: string;
  label: string;
  /** Index into the reply's `probes` for the executing half. */
  execProbe: number;
  /** Index for the planning half — the same one for a non-split arm. */
  planProbe?: number;
}

/** A reply carrying `probes`, with each arm's two halves pointing at the indices it was given. */
export function replyFixture(probes: ProbeResult[], arms: ArmFixture[]): ArmProbeReply {
  const verdicts: ArmVerdict[] = arms.map((a) => {
    const plan = a.planProbe ?? a.execProbe;
    const ok = probes[a.execProbe]!.ok && probes[plan]!.ok;
    return {
      armId: a.armId,
      label: a.label,
      ok,
      refusal: ok ? null : `Arm “${a.label}”, execute half: it is not ready on this machine.`,
      halves: [
        { role: "execute", transport: probes[a.execProbe]!.transport, model: "sonnet", endpoint: null, probe: a.execProbe },
        { role: "plan", transport: probes[plan]!.transport, model: "sonnet", endpoint: null, probe: plan },
      ],
    };
  });
  const refusal = verdicts.map((v) => v.refusal).filter((s): s is string => s !== null);
  return { arms: verdicts, probes, refusal: refusal.length ? refusal.join(" ") : null };
}
