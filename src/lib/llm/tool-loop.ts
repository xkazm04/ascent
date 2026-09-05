// THE TOOL LOOP — the multi-leg exchange behind Athena, the resident org-scoped companion.
//
// A single-shot `TextRunner` can only answer from what the prompt already contains, so grounding an
// answer in this org's real data meant pre-fetching everything the model MIGHT want and hoping. This
// loop instead offers the model a set of tools, executes the ones it asks for, feeds the results back,
// and repeats until it answers in prose.
//
// THESE ARE NEW TYPES BESIDE `TextRunner`, NOT A WIDENING OF IT. Widening the runner contract would
// have forced a change on `consolidation.ts:315` and `reflection.ts:347` — two callers that will never
// call a tool — for no benefit to either. `resolveLegRunner` (text.ts) is the shared floor: identical
// provider selection, identical transports.
//
// WHAT THIS MODULE DOES NOT DO. It never dispatches a tool itself and imports nothing from
// `src/lib/mcp/`. The caller supplies `execute`, so the caller owns tool dispatch AND the authorization
// decision for every one of them — this loop has no idea who is asking, which is precisely why it must
// not be the thing that decides what they may see.
//
// FOUR HONESTY RULES, in the order they matter:
//   1. It never fabricates a final answer. Running out of legs or budget sets `truncated: true` and
//      returns what it actually has, even when that is an empty string.
//   2. It reports `grounding` — "tools" when the model could call them, "prefetched" when it could not.
//      A caller must be able to tell the user which mode produced the answer; a silent substitution
//      would present an ungrounded guess with the authority of a grounded one.
//   3. Usage SUMS across legs. (Note `src/lib/scan-assess.ts:209` is last-wins — correct for RETRIES,
//      where only one attempt counts, and an undercount here, where every leg was really billed.)
//   4. Exactly ONE tracklight event per loop, tagged with the leg kind, after the final leg.

import type { ProviderName, TokenUsage } from "@/lib/types";
import { supportsToolCalling } from "@/lib/llm/config";
import { trackLlmCall } from "@/lib/llm/tracklight";
import { meter } from "@/lib/llm/meter";
import { isToolCallingRejection } from "@/lib/llm/transports";
import type { ResolvedLegRunner } from "@/lib/llm/text";
import { resolveLegRunnerWithProvenance } from "@/lib/llm/text-org";
import type { AthenaTool, LegTurn, LlmLegKind, ToolCall, ToolResult } from "@/lib/llm/leg";
import type { MeterContext } from "@/lib/llm/meter";

export type { AthenaTool, ToolCall } from "@/lib/llm/leg";

export type ToolLoopResult = {
  text: string;
  usage: TokenUsage;
  legs: number;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  truncated: boolean;
  grounding: "tools" | "prefetched";
};

/** What {@link runToolLoop} returns: the result plus WHICH engine produced it, so a caller can say
 *  "gemini answered this", the same provenance `ResolvedTextRunner.engine` carries. */
export type ToolLoopRun = ToolLoopResult & { engine: ProviderName; model: string };

/**
 * Hard leg ceiling. Four is one plan leg, two rounds of tool use, and a final answer — enough for a
 * real question, few enough that a model stuck in a call/re-call cycle costs a bounded amount.
 */
export const ATHENA_MAX_LEGS = 4;

/**
 * Cross-leg wall-clock ceiling. `withLlmTimeout` (config.ts:118-127) is strictly PER CALL, so an N-leg
 * loop built on it alone would be allowed N × LLM_TIMEOUT_MS — four 60s legs is four minutes, well past
 * any serverless function limit, and the user would get a 500 instead of a truncated answer. So: ONE
 * deadline controller for the whole loop, combined with the caller's signal via `AbortSignal.any` and
 * threaded through every leg. Copied in shape from the scan-wide LLM budget at
 * `src/lib/scan-assess.ts:264-278`, and distinct from the caller's signal for the same reason it is
 * there — a budget expiry degrades gracefully, a real client disconnect unwinds everything.
 */
export const ATHENA_TOTAL_BUDGET_MS = 90_000;

export interface ToolLoopOptions {
  /** The full prompt for the first leg (system framing + the operator's message, caller's choice). */
  prompt: string;
  /** Tools the model may call. Empty = a plain single-shot completion, reported as "prefetched". */
  tools: AthenaTool[];
  /**
   * Runs ONE tool call and returns its result as a string. The caller owns dispatch and its own
   * authorization — see the module header. A throw here is caught and fed back to the model as a tool
   * error, because "that tool failed" is something a good assistant can recover from and a crash is not.
   */
  execute: (call: ToolCall) => Promise<string>;
  legKind: LlmLegKind;
  /** Org whose BYOM provider should answer, when it has one. `null`/"public" uses the platform env. */
  orgSlug?: string | null;
  /** Client disconnect. Distinct from the budget deadline: this one unwinds, the budget truncates. */
  signal?: AbortSignal;
  maxLegs?: number;
  budgetMs?: number;
  /** Called ONCE, with the SUM across every leg — never per leg. */
  onUsage?: (usage: TokenUsage) => void;
  /**
   * Ledger attribution for the whole loop (repo, team, ref). `orgSlug` defaults to `opts.orgSlug`, so
   * Athena's two call sites need no change at all: they already pass the org and the leg kind, which
   * is everything the meter needs to name the lane and its owner.
   */
  meter?: MeterContext;
  /** Test seam: supply the runner instead of resolving one from env/BYOM. */
  runner?: ResolvedLegRunner;
}

const USAGE_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const;

/**
 * Accumulate one leg's usage into the running total. A field the provider did not report stays ABSENT
 * rather than becoming 0 — "we don't know" and "it was free" are different facts, and the tracklight
 * payload now preserves that distinction too (see buildEventBody).
 */
function addUsage(acc: TokenUsage, u: TokenUsage | undefined): void {
  if (!u) return;
  for (const k of USAGE_FIELDS) {
    const v = u[k];
    if (v == null) continue;
    acc[k] = (acc[k] ?? 0) + v;
  }
}

/**
 * Run the tool loop. Returns `null` when no engine is reachable here — the same first-class "no engine"
 * answer `resolveTextRunner` gives, which the caller must surface rather than conflating with silence.
 */
export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopRun | null> {
  // `byom` rides along with the runner so the meter can record that Ascent was NOT billed for this
  // loop — an org on its own Bedrock account paid its vendor directly, and a dollar figure here would
  // be a number the operator is invited to reconcile against an invoice that does not exist. Unknown
  // (an injected test runner) stays undefined rather than defaulting to false.
  const resolved = opts.runner
    ? { runner: opts.runner, byom: undefined }
    : await resolveLegRunnerWithProvenance(opts.orgSlug ?? null, { legKind: opts.legKind });
  const runner = resolved.runner;
  if (!runner) return null;

  const maxLegs = Math.max(1, opts.maxLegs ?? ATHENA_MAX_LEGS);
  const budgetMs = Math.max(1_000, opts.budgetMs ?? ATHENA_TOTAL_BUDGET_MS);

  // ONE deadline for the whole loop — see ATHENA_TOTAL_BUDGET_MS.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("Athena total budget exceeded")), budgetMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline.signal]) : deadline.signal;

  const usage: TokenUsage = {};
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const history: LegTurn[] = [];
  const startedAt = Date.now();

  // Tools are offered only when the PROVIDER can carry them at all; otherwise the honest answer from
  // the first leg onward is "prefetched", and the caller can say so.
  let toolsOffered = opts.tools.length > 0 && supportsToolCalling(runner.engine);
  let grounding: ToolLoopResult["grounding"] = toolsOffered ? "tools" : "prefetched";
  let toolRejectionHandled = false;

  let text = "";
  let legs = 0;
  let truncated = false;
  let status: "success" | "error" | "timeout" = "success";
  let error: string | undefined;

  const finish = (): ToolLoopRun => {
    trackLlmCall({
      provider: runner.engine,
      model: runner.model,
      usage,
      latencyMs: Date.now() - startedAt,
      status,
      error,
      org: opts.orgSlug ?? null,
      // ONE event for the whole loop, tagged by leg kind — Athena's spend can never be mistaken for
      // scan spend in the cost rollups.
      surface: opts.legKind,
      operation: "tool-loop",
      tags: [`grounding:${grounding}`, ...(truncated ? ["truncated"] : [])],
    });
    // ONE ledger row per LOOP, matching the tracklight event above and carrying the SUMMED usage. A
    // meter call inside the leg loop would count the same exchange up to four times and quadruple
    // Athena's apparent cost — honesty rule 3 (usage sums across legs) applies to the ledger too.
    meter({
      ...opts.meter,
      orgSlug: opts.meter?.orgSlug ?? opts.orgSlug ?? null,
      byom: opts.meter?.byom ?? resolved.byom,
      legKind: opts.legKind,
      provider: runner.engine,
      model: runner.model,
      usage,
      status,
      latencyMs: Date.now() - startedAt,
    });
    opts.onUsage?.(usage);
    return { text, usage, legs, toolCalls, truncated, grounding, engine: runner.engine, model: runner.model };
  };

  try {
    while (legs < maxLegs) {
      let res;
      try {
        res = await runner.call(
          { prompt: opts.prompt, legKind: opts.legKind, history, tools: toolsOffered ? opts.tools : undefined },
          signal,
        );
      } catch (err) {
        // ONE fallback, and it is announced. An OpenAI-compatible endpoint (vLLM / Ollama / LM Studio,
        // or an OpenRouter upstream) may 4xx on `tools` rather than answer without them. Retry the same
        // leg without tools and report "prefetched" — the precedent is isResponseFormatRejection
        // (schema.ts:185-188) driving the one-shot retry at openai.ts:108-120. Never a SILENT swap: the
        // caller has to be able to tell the user which mode grounded the answer.
        if (toolsOffered && !toolRejectionHandled && isToolCallingRejection(err)) {
          console.warn(
            `[llm/tool-loop] model "${runner.model}" (${runner.engine}) rejected tool calling; ` +
              "falling back once to a single-shot prompt (answer is prompt-grounded only).",
          );
          toolsOffered = false;
          toolRejectionHandled = true;
          grounding = "prefetched";
          continue; // no tokens were spent, so this does not consume a leg
        }
        // OUR deadline firing is a truncation, not a failure — return what we have. A real caller
        // disconnect is not this loop's to swallow.
        if (deadline.signal.aborted && !opts.signal?.aborted) {
          truncated = true;
          status = "timeout";
          error = "Athena total budget exceeded";
          break;
        }
        status = "error";
        error = err instanceof Error ? err.message : String(err);
        finish();
        throw err;
      }

      legs += 1;
      addUsage(usage, res.usage);
      text = res.text;

      const calls = res.toolCalls ?? [];
      if (calls.length === 0) break; // the model answered in prose — done

      if (legs >= maxLegs || Date.now() - startedAt >= budgetMs) {
        // The model wants more tools and we have nothing left to give it. Return the partial text
        // (often empty) with truncated: true. Inventing a closing paragraph here would be exactly the
        // fabrication this loop exists to avoid.
        truncated = true;
        break;
      }

      const results: ToolResult[] = [];
      for (const call of calls) {
        toolCalls.push({ name: call.name, args: call.args });
        let content: string;
        try {
          content = await opts.execute(call);
        } catch (err) {
          content = `Tool "${call.name}" failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        results.push({ id: call.id, name: call.name, content });
      }
      history.push({ kind: "assistant", text: res.text, calls });
      history.push({ kind: "toolResults", results });
    }
  } finally {
    clearTimeout(timer);
  }

  return finish();
}
