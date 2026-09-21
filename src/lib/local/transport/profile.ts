// THE DATED CAPABILITY MATRIX — what each agent CLI supports, as DATA with a date and a method,
// never as a timeless constant baked into an adapter.
//
// The tools wrapped here ship weekly, rename binaries, deprecate flags and change default models. An
// adapter that hardcodes "this tool supports that flag" is writing documentation that starts rotting
// at commit time, with the rot arriving at runtime as an argument error that reads exactly like a
// model failure. So every claim below carries the date it was verified, the version it was verified
// against, and HOW.
//
// THE UNIT OF VERIFICATION IS THE WHOLE INVOCATION, NOT THE FLAG. A flag's acceptance is
// position-dependent in tools that route headless mode through a subcommand — one accepted before the
// subcommand is rejected after it. So a capability cell records the invocation that was actually
// smoked, and a cell no method has confirmed reads `unverified`, never silently true or false.
//
// DEPENDENCY-FREE (no `process`, no `node:*`), like `arm.ts` beside it: the cockpit renders this
// matrix, and the plan ceiling below is read by modules the browser loads. Environment resolution and
// spawning stay in `run.ts` / `agent.ts`; a `process.env` read here would drag the spawn side across
// the client boundary the first time the matrix appeared on a page.

import type { TransportId } from "@/lib/local/arm";
import { claudeLocalTiming, claudeProfile } from "@/lib/local/transport/claude";
import { piProfile } from "@/lib/local/transport/pi-profile";

/** How a capability was established, weakest last. A live run proves behaviour; help text proves a
 *  flag exists, not what it does; vendor docs describe the version the vendor wishes you had. */
export type VerificationMethod = "live-run" | "help-text" | "vendor-docs";

/** One capability claim with its witness. `value: null` + `method` absent = unverified. */
export interface CapabilityCell<T> {
  value: T;
  /** ISO date the claim was checked. */
  verifiedAt: string;
  /** The tool version it was checked against. */
  version: string;
  method: VerificationMethod;
  /** The exact invocation smoked, when the claim is about a flag. */
  invocation?: string;
}

/** A claim nothing has confirmed. Renders as unverified everywhere; never coerced to a boolean. */
export type MaybeCell<T> = CapabilityCell<T> | null;

/**
 * The per-transport timing band.
 *
 * These were three module constants (`AGENT_TIMEOUT_DEFAULT_MS`, `PLAN_TIMEOUT_MS`, `PHASE_QUIET_MS`)
 * sized for a hosted frontier model answering at hundreds of tokens per second. A local 27B at Q4 on
 * one consumer GPU generates at roughly a tenth of that, so a shared ceiling forces a choice between
 * failing every local lane on the clock and removing the tripwire that catches a genuinely stuck
 * Claude lane. Per-transport bands refuse the choice: a timeout then means "this arm ran out of ITS
 * budget", which is an attributable finding rather than an anonymous one.
 */
export interface TransportTiming {
  /** Ceiling for one executing session. */
  agentMs: number;
  /** Ceiling for one planning session. Replaces the hard-coded PLAN_TIMEOUT_MS. */
  planMs: number;
  /** Silence after which the theater reports the agent as quiet. */
  quietMs: number;
}

export interface TransportCaps {
  /** Emits a parseable per-line event stream (whatever the flag is spelled). */
  streamJson: MaybeCell<boolean>;
  /** The editing stance flag AND its position, as smoked. */
  editStance: MaybeCell<string>;
  /** The read-only planning stance, or null when the tool has none. */
  planStance: MaybeCell<string | null>;
  /** Can continue an earlier session. */
  resume: MaybeCell<boolean>;
  /** Accepts the prompt on stdin (never the argument vector: prompts contain flag-shaped text). */
  promptOnStdin: MaybeCell<boolean>;
}

export interface TransportProfile {
  id: TransportId;
  /** Display name for the cockpit and the ledger. */
  label: string;
  /** The binary, env-overridable per transport. */
  bin: string;
  timing: TransportTiming;
  /**
   * TRUE when this transport's own cost figures are MEANINGLESS and must be discarded.
   *
   * Measured 2026-09-21: `claude -p` against a local Ollama endpoint reports
   * `total_cost_usd: 0.084` with `costBasis: "unknown"` — a price computed from a rate card for a
   * model that was never called. Banking it would enter fabricated dollars in the same column as
   * real spend and silently wreck the one metric this whole feature exists to measure. A zero-cost
   * transport therefore records `costSource: "none"` with `costMicros: null` — NEVER 0, because a
   * display that divides would report an infinite lift-per-cent.
   */
  zeroCost: boolean;
  caps: TransportCaps;
}

/** Every profile this build knows. */
export function transportProfile(id: TransportId): TransportProfile {
  return id === "pi" ? piProfile : claudeProfile;
}

/** All profiles, for the cockpit's transport picker and the capability matrix surface. Declaration
 *  order, not alphabetical: `claude` is the proven path and reads first. */
export function allTransportProfiles(): TransportProfile[] {
  return [claudeProfile, piProfile];
}

/**
 * THE BAND A LANE WILL ACTUALLY RUN UNDER — the transport's, widened when the arm points at a LOCAL
 * ENDPOINT.
 *
 * `TransportProfile.timing` is one band per transport, and that is the right shape for a capability
 * matrix; but the same `claude` binary answering from a 27B at 4-bit on one consumer GPU is not the
 * same clock as the same binary on a subscription seat. The endpoint, not the transport id, is what
 * changes the arithmetic, so it is a parameter here rather than a second row in the matrix — a second
 * row would claim there are two Claude CLIs.
 *
 * `local` on a transport with no measured local band falls through to that transport's own timing
 * rather than inventing one: an unmeasured number presented as a band is exactly what the dated
 * matrix above exists to refuse.
 */
export function transportTiming(id: TransportId, opts?: { local?: boolean } | null): TransportTiming {
  if (opts?.local && id === "claude") return claudeLocalTiming;
  return transportProfile(id).timing;
}
