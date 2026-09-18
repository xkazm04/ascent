// THE AGENT'S STREAM, parsed as it arrives (spark theater-upgrade, 2026-09-18; WP4 implements).
//
// `claude -p --output-format stream-json --verbose` emits one JSON object per line: system init,
// assistant messages carrying `tool_use` blocks (Read / Grep / Glob / Edit / Write … with their inputs),
// user messages carrying `tool_result`, and a final `result` object with the SAME fields the one-shot
// `json` envelope has. This module turns that into `AgentStreamEvent`s for the lane's activity sink, and
// hands the final `result` object back so `parseAgentEnvelope` reads exactly what it reads today.
//
// TOLERANT BY CONTRACT: an unknown event type is ignored, a malformed line is skipped, and a stream that
// never produced a `result` object yields `null` — the caller then falls back to today's failure summary.
// The envelope must never be WORSE than it was before streaming.

import type { AgentStreamEvent } from "@/lib/local/runner-types";

export interface StreamParser {
  /** Feed a raw stdout chunk (may split or join lines arbitrarily). */
  push(chunk: string): void;
  /** Flush the trailing partial line and return the final `result` object's raw JSON text, or null. */
  end(): string | null;
}

/** STUB (WP0): collects nothing and reports no result. */
export function createStreamParser(_onEvent: (e: AgentStreamEvent) => void): StreamParser {
  return {
    push() {},
    end() {
      return null;
    },
  };
}
