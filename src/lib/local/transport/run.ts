// THE ONE DOOR EVERY LANE SUBPROCESS GOES THROUGH, now that there is more than one thing behind it.
//
// `runClaudeAgent` keeps its exact contract and becomes the `claude` transport's implementation; this
// function selects a transport and delegates. The signature is deliberately IDENTICAL to
// `runClaudeAgent`'s so that `LaneDeps.runAgent`, `PlanLaneInput.runAgent` and
// `src/lib/registry/dispatch-local.ts` need no shape change — a transport swap must not become a
// refactor of every caller.
//
// STUB — WP1 implements the registry and the claude path; WP2 adds `pi`. Signature is final.

import type { AgentRunResult, ClaudeAgentOptions } from "@/lib/local/agent";
import type { TransportId } from "@/lib/local/arm";

/** What a spawned session is armed with, beyond the options the caller already passed. */
export interface TransportRunOptions extends ClaudeAgentOptions {
  /**
   * The local inference endpoint this session should talk to, when the arm is a local one.
   *
   * An ENV BLOCK ON THE SPAWN, never a process-wide global: the same server must be able to run a
   * Claude lane and a local lane at the same moment, and a global would make "which endpoint did
   * this lane use?" a question about scheduling order. Absent = the transport's own default auth,
   * which for `claude` is the operator's subscription seat.
   */
  endpoint?: LocalEndpoint | null;
}

export interface LocalEndpoint {
  /** e.g. http://localhost:11434 — the Anthropic-compatible root, no path suffix. */
  baseUrl: string;
  /** The model id as the server knows it. */
  model: string;
  /** Sent as the auth token; local servers ignore the value but reject its absence. */
  token?: string | null;
  /**
   * The context window to DECLARE to the client.
   *
   * Load-bearing, not a tuning knob. A client that does not recognize a model id assumes the largest
   * profile it knows and sends the maximal request; and an Ollama server left at its own default
   * gives 4096 tokens under 24 GB of VRAM, which truncates the tool definitions and produces a model
   * that appears unable to call tools. Declaring the real number is how the substitute stops being
   * blamed for the client's assumption.
   */
  contextTokens: number;
}

/** Run one session through the named transport. Resolves, never rejects — every outcome is cycle
 *  data, exactly as `runClaudeAgent` has always behaved. */
export function runAgentVia(_transport: TransportId, _opts: TransportRunOptions): Promise<AgentRunResult> {
  return Promise.resolve({ ok: false, summary: "runAgentVia: not implemented (WP1)" });
}
