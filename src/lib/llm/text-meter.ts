// The METERED wrapper over a raw leg call: the shared timeout/disconnect AbortController lifecycle
// plus the tracklight mirror. Split out of text.ts (which keeps provider selection) so the two layers
// — "which endpoint" and "how it is timed and accounted" — are separately readable.
//
// Metering lives HERE rather than in each caller for the same reason the timeout does: these are real
// billed model calls, and every one of them was previously invisible — no `onUsage`, no tracklight
// event — so Shared Org Memory's LLM spend appeared nowhere in /usage, the cost estimate, or the
// observability mirror while every scan-path call was fully accounted. A caller cannot forget to meter
// something it never sees. Failures are metered too (status/error/latency): an endpoint that times out
// on every memory pass is exactly what you need the telemetry to show.

import type { ProviderName } from "@/lib/types";
import { withLlmTimeout } from "@/lib/llm/config";
import { trackLlmCall } from "@/lib/llm/tracklight";
import type { LegCall, ResolvedLegRunner, ResolvedTextRunner, TextRunner, TextRunnerOptions } from "@/lib/llm/leg";

/** Human label used in this seam's error messages, per engine. A FULL Record over ProviderName (the
 *  same discipline PROVIDER_LABEL and TRACKLIGHT_PROVIDER apply) so a new provider fails the compile
 *  here rather than producing an error message that names no engine at all. */
export const ENGINE_LABEL: Record<ProviderName, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  local: "Local LLM server",
  openrouter: "OpenRouter",
  bedrock: "Bedrock",
  "claude-cli": "Claude CLI",
  mock: "Mock",
};

function withTimeout(
  engine: ProviderName,
  model: string,
  label: string,
  timeoutMs: number,
  opts: TextRunnerOptions,
  call: LegCall,
): TextRunner {
  return async (prompt, callerSignal) => {
    const { signal, clear } = withLlmTimeout(callerSignal, timeoutMs, `${label} request timed out.`);
    const startedAt = Date.now();
    try {
      const { text, usage } = await call({ prompt, legKind: opts.legKind }, signal);
      if (usage) opts.onUsage?.(usage);
      trackLlmCall({
        provider: engine,
        model,
        usage,
        latencyMs: Date.now() - startedAt,
        status: "success",
        // The leg kind IS the surface tag unless a caller overrides it — see TextRunnerOptions.legKind.
        surface: opts.surface ?? opts.legKind,
        operation: "text",
      });
      return text;
    } catch (err) {
      trackLlmCall({
        provider: engine,
        model,
        latencyMs: Date.now() - startedAt,
        // An abort that fired on OUR timer is a timeout; a caller disconnect is not this seam's failure.
        status: signal.aborted && !callerSignal?.aborted ? "timeout" : "error",
        error: err instanceof Error ? err.message : String(err),
        surface: opts.surface ?? opts.legKind,
        operation: "text",
      });
      throw err;
    } finally {
      clear();
    }
  };
}

/** Turn a resolved leg runner into the single-shot, metered `TextRunner` its callers expect. */
export function textRunnerFrom(
  leg: ResolvedLegRunner,
  timeoutMs: number,
  opts: TextRunnerOptions,
): ResolvedTextRunner {
  if (leg.ownsTimeout) {
    // claude-cli spawns a process and owns its own timer; racing a second AbortController against it
    // would only give the caller two competing deadlines. It reports no usage either, so there is
    // nothing to meter — this path is unchanged from before the seam had leg kinds.
    return {
      engine: leg.engine,
      model: leg.model,
      run: async (prompt, signal) => (await leg.call({ prompt, legKind: opts.legKind }, signal)).text,
    };
  }
  return {
    engine: leg.engine,
    model: leg.model,
    run: withTimeout(leg.engine, leg.model, ENGINE_LABEL[leg.engine], timeoutMs, opts, leg.call),
  };
}
