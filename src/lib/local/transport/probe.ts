// THE PREFLIGHT PROBE — is this arm's transport installed, authorized, and pointed at something that
// will answer HONESTLY? Proven without spending tokens, and proven THROUGH THE SAME SPAWN DOOR AND
// ENVIRONMENT the real run will use.
//
// The second clause is the one that earns its keep. These tools compute their own auth and capability
// report from the environment they are handed, so a probe run anywhere else describes a process
// nobody will launch. A probe that cannot be zero-cost says so; it never pretends.
//
// WHY THIS BLOCKS RATHER THAN WARNS. A comparison run costs hours of wall clock, and the two failures
// measured on this machine on 2026-09-21 both produce a RESULT rather than an error: a server left at
// its default context truncates the tool definitions, and the model then looks incapable of calling
// tools; and a server below the release that stopped the client's token-countdown message from
// breaking the key-value cache re-prefills the whole prompt every single turn, so the arm looks slow.
// Either one yields a confidently wrong verdict about a model — the most expensive answer available
// here — and a warning in an unattended overnight drive is a warning nobody reads.
//
// STUB — WP4 implements. Signatures are final.

import type { TransportId } from "@/lib/local/arm";
import type { LocalEndpoint } from "@/lib/local/transport/run";

/** One thing the probe checked. `ok: false` carries what to DO about it, not just what is wrong. */
export interface ProbeFinding {
  check: "binary" | "endpoint" | "model" | "context" | "server-version" | "auth";
  ok: boolean;
  /** What was observed. Absent when the check could not run at all. */
  observed?: string | null;
  /** What is required for this check to pass. */
  required?: string | null;
  /** The operator's next action, when `ok` is false. */
  remedy?: string | null;
}

export interface ProbeResult {
  transport: TransportId;
  /** Every check passed. A run may only be armed when this is true. */
  ok: boolean;
  /** The transport binary's version, recorded whether or not the probe passed — a capability matrix
   *  row is worthless without the version it was verified against. */
  binVersion?: string | null;
  /** The inference server's version, when the arm is a local one. */
  serverVersion?: string | null;
  findings: ProbeFinding[];
  /** ISO timestamp. Stamped onto the run as `probeJson` so a result carries what it ran under. */
  at: string;
  /** True when the probe itself consumed no model tokens. False means the figure below is real. */
  zeroToken: boolean;
}

/** The minimum declared context an arm may run with. Below this, tool definitions are truncated and
 *  the model's apparent incapacity is an artifact of the harness. */
export const MIN_CONTEXT_TOKENS = 65_536;

/** Probe one transport, optionally against a local endpoint. Never throws: an unreachable server is a
 *  finding, not an exception. */
export function probeTransport(_transport: TransportId, _endpoint?: LocalEndpoint | null): Promise<ProbeResult> {
  return Promise.reject(new Error("probeTransport: not implemented (WP4)"));
}

/** The one sentence an arming refusal shows, naming the specific failure and its remedy. Null when
 *  the probe passed. */
export function probeRefusal(_result: ProbeResult): string | null {
  return null;
}

export function serializeProbe(result: ProbeResult): string {
  return JSON.stringify(result);
}
