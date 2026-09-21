// THE ONE DOOR EVERY LANE SUBPROCESS GOES THROUGH, now that there is more than one thing behind it.
//
// `runClaudeAgent` keeps its exact contract and becomes the `claude` transport's implementation; this
// function selects a transport and delegates. The signature is deliberately IDENTICAL to
// `runClaudeAgent`'s so that `LaneDeps.runAgent`, `PlanLaneInput.runAgent` and
// `src/lib/registry/dispatch-local.ts` need no shape change — a transport swap must not become a
// refactor of every caller.
//
// WHY `endpoint` LIVES HERE AND NOT IN `ClaudeAgentOptions`: the endpoint is a property of the ARM,
// resolved by whoever armed the run, and every existing caller of `runClaudeAgent` must keep passing
// exactly what it always passed. Extending the options type instead would have made "does this lane
// talk to Anthropic?" a question about a field nobody set.

import { runAgentSession, type AgentRunResult, type ClaudeAgentOptions } from "@/lib/local/agent";
import type { TransportId } from "@/lib/local/arm";
import { runPiAgent } from "@/lib/local/transport/pi";

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

/**
 * Run one session through the named transport. Resolves, never rejects — every outcome is cycle
 * data, exactly as `runClaudeAgent` has always behaved.
 *
 * THE `claude` PATH WITH NO ENDPOINT IS TODAY'S PATH, BYTE FOR BYTE. Not "equivalent", not "the same
 * shape": the same function, the same argv (pinned against a literal in `claude.test.ts`), the same
 * stripped environment, the same sentences. That is the property every lane in the fleet depends on,
 * and it is the one a registry is most likely to break quietly while looking correct.
 *
 * A `switch` rather than a lookup table of implementations, deliberately: the transport id reaches a
 * re-parsing shell, `TRANSPORT_IDS` is a closed list for that reason, and an exhaustive switch is
 * what makes a third transport a COMPILE error here instead of a runtime fallthrough onto `claude`
 * — which would run a lane on the wrong arm and record it under the right name.
 */
export function runAgentVia(transport: TransportId, opts: TransportRunOptions): Promise<AgentRunResult> {
  const { endpoint, ...session } = opts;
  switch (transport) {
    case "pi":
      return runPiAgent(opts);
    case "claude":
      return runAgentSession(session, { transport: "claude", endpoint: endpoint ?? null });
  }
}
