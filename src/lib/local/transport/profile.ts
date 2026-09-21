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
// STUB — WP1 owns the Claude profile and the registry; WP2 owns the Pi profile. Signatures are final.

import type { TransportId } from "@/lib/local/arm";

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

/** Every profile this build knows. WP1 fills `claude`, WP2 fills `pi`. */
export function transportProfile(_id: TransportId): TransportProfile {
  throw new Error("transportProfile: not implemented (WP1)");
}

/** All profiles, for the cockpit's transport picker and the capability matrix surface. */
export function allTransportProfiles(): TransportProfile[] {
  throw new Error("allTransportProfiles: not implemented (WP1)");
}
