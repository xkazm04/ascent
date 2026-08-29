// The vocabulary of a metered LLM **leg** — one request/response round trip against a model.
//
// WHY A "LEG KIND" EXISTS AT ALL. Until now every non-scan model call in this app was anonymous: the
// free-form text seam (text.ts) tagged everything "text", so Shared Org Memory's write-gate, its
// reflection pass and (from now on) Athena's chat turns all landed in one undifferentiated bucket in
// /usage and in the tracklight mirror. That is fine while there is exactly one non-scan surface and
// useless the moment there are three. `LlmLegKind` is the chokepoint tag: it names WHICH surface is
// spending, it selects the sampling temperature (scan legs stay pinned for D29 score reproducibility
// while a chat leg may sample), and it is a REQUIRED argument on TextRunnerOptions — deliberately with
// no default, because a default turns a chokepoint back into a habit and the untagged caller is
// exactly the one you needed to see.
//
// This module is a LEAF: it holds only types, imports nothing from the rest of `src/lib/llm/**`, and
// so can be imported by the transports, the runner resolution, the metering wrapper and the tool loop
// without a cycle.

import type { ProviderName, TokenUsage } from "@/lib/types";
// TYPE-ONLY, and deliberately so: meter.ts imports this module's `LlmLegKind`, so a runtime import in
// this direction would close a cycle. `import type` is erased, and this file stays the leaf it says
// it is in the header.
import type { MeterContext } from "@/lib/llm/meter";

/**
 * Which surface a model call belongs to.
 *
 *   - `scan`         — the scoring pipeline. Pinned-temperature, reproducible (docs/VALUE-CASE.md D29).
 *   - `memory`       — Shared Org Memory's write-gate + reflection passes (src/lib/memory/**).
 *   - `athena_turn`  — one interactive Athena reply to an operator's message.
 *   - `athena_cycle` — Athena's unattended background pass (no human waiting on it).
 *   - `briefing`     — the executive briefing's one LLM-written paragraph (src/lib/org/briefing-narrative.ts).
 *                      It does NOT run through this seam's transports (it calls the Anthropic Messages
 *                      API directly), so the kind exists to NAME the surface in the meter, not to route
 *                      it. Like `scan` and `memory` it is deliberately ABSENT from LEG_TEMPERATURE_ENV /
 *                      LEG_TEMPERATURE_DEFAULT (src/lib/llm/config.ts): adding a row there would change
 *                      a resolved temperature, which is a scoring-reproducibility decision (D29), not a
 *                      metering one.
 */
export type LlmLegKind = "scan" | "memory" | "athena_turn" | "athena_cycle" | "briefing";

/** A tool Athena may call. `inputSchema` is a JSON Schema object, the same source of truth every
 *  provider's own function-calling envelope wraps (Bedrock `inputSchema.json`, Gemini
 *  `parametersJsonSchema`, OpenAI `function.parameters`). */
export interface AthenaTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** One tool invocation the model asked for. `id` is the provider's correlation handle (synthesized
 *  for Gemini, which correlates function responses by NAME rather than by id). */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** The answer to one tool call, as the caller's `execute` produced it. Always a string: the caller
 *  owns serialization, so the loop never has to guess how to render a tool's result. */
export interface ToolResult {
  id: string;
  name: string;
  content: string;
}

/**
 * One prior turn of a multi-leg exchange, in a PROVIDER-NEUTRAL form. The loop accumulates these and
 * each transport translates them into its own wire shape — so the loop never learns three message
 * formats and a new provider is one translation, not a new loop.
 */
export type LegTurn =
  | { kind: "assistant"; text: string; calls: ToolCall[] }
  | { kind: "toolResults"; results: ToolResult[] };

/** What a transport is asked for: the prompt, the leg kind (which picks temperature), the prior turns
 *  of this exchange, and the tools the model may call on this leg (absent = plain text completion). */
export interface LegRequest {
  prompt: string;
  legKind: LlmLegKind;
  history?: LegTurn[];
  tools?: AthenaTool[];
}

/**
 * What a transport returns. `text` may be EMPTY when the model answered purely with tool calls — that
 * is a valid reply, not an error, and reading `toolCalls` before the empty-response check is what keeps
 * the very first tool turn from hard-failing on all three transports.
 */
export interface LegResult {
  text: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
}

// ---------------------------------------------------------------------------
// Runner vocabulary
// ---------------------------------------------------------------------------

/** Same shape as the memory cores' injected `RunPrompt`, kept structural so neither side imports the other. */
export type TextRunner = (prompt: string, signal?: AbortSignal) => Promise<string>;

export interface ResolvedTextRunner {
  /** Which provider actually answers - reported to the user so "an LLM ran" names WHICH one. */
  engine: ProviderName;
  model: string;
  run: TextRunner;
}

/** One raw round trip against a model: no timeout wrapper, no telemetry. */
export type LegCall = (req: LegRequest, signal?: AbortSignal) => Promise<LegResult>;

export interface ResolvedLegRunner {
  engine: ProviderName;
  model: string;
  call: LegCall;
  /**
   * True when the transport enforces its OWN timeout (claude-cli spawns a process rather than issuing
   * a request), so the text-runner wrapper must not race a second AbortController against it.
   */
  ownsTimeout?: boolean;
}

export interface TextRunnerOptions {
  /**
   * WHICH SURFACE IS SPENDING. Required, and deliberately WITHOUT a default.
   *
   * It sets the tracklight tag (so Athena's chat traffic can never be mistaken for scan traffic in the
   * cost rollups the way the old blanket "text" tag mixed every non-scan surface together) and it
   * selects the sampling temperature (`llmTemperature`) - a scan leg stays pinned for score
   * reproducibility while a chat leg may sample. A default would make this a habit rather than a
   * chokepoint, and the caller that forgets to tag itself is exactly the one you needed to see.
   */
  legKind: LlmLegKind;
  /**
   * Per-call timeout. An INTERACTIVE caller (a human waiting on a button) should pass something well
   * under the scan-sized default; the caller degrades to its own no-LLM path when this fires.
   */
  timeoutMs?: number;
  /**
   * Token usage per call, when the provider reports it - the same metering hook `AssessOptions.onUsage`
   * gives the scan path. These are REAL billed model calls, and until this existed they were the only
   * LLM traffic in the app that no meter could see: absent from /usage, absent from the cost estimate,
   * and never charged. Optional, so a caller that doesn't meter is unaffected.
   */
  onUsage?: (usage: TokenUsage) => void;
  /** Override the tracklight tag. Defaults to `legKind`, which is what a caller almost always wants. */
  surface?: string;
  /**
   * WHOSE LEDGER this call lands in — the org, and optionally the row/repo/team it belongs to. The
   * seam derives the lane from `legKind`, so a caller usually supplies only `{ orgSlug }`.
   *
   * Optional, and its absence is not a silent free pass: `meter()` writes NOTHING for an org it
   * cannot name (see its own contract). An unattributable event is worth less than the row it costs.
   */
  meter?: MeterContext;
}
