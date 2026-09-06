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
import { trackLlmCall, legKindUseCase } from "@/lib/llm/tracklight";
import { meter } from "@/lib/llm/meter";
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
  "codex-cli": "Codex CLI",
  nebius: "Nebius Token Factory",
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
        name: legKindUseCase(opts.legKind),
        operation: "text",
      });
      // The DURABLE half of the same fact. tracklight is an optional local mirror an operator may not
      // run; the meter is the org's own ledger, and /usage reads it. Both, or the spend is visible in
      // exactly the deployments that were already instrumented.
      meter({
        ...opts.meter,
        orgSlug: opts.meter?.orgSlug ?? null,
        legKind: opts.legKind,
        provider: engine,
        model,
        usage,
        status: "success",
        latencyMs: Date.now() - startedAt,
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
        name: legKindUseCase(opts.legKind),
        operation: "text",
      });
      // A FAILED call is metered too, with no tokens and no cost: an endpoint that times out on every
      // memory pass is exactly what the ledger has to be able to show. Silence would read as "that
      // lane costs nothing", which is the opposite of what a stream of timeouts means.
      meter({
        ...opts.meter,
        orgSlug: opts.meter?.orgSlug ?? null,
        legKind: opts.legKind,
        provider: engine,
        model,
        status: signal.aborted && !callerSignal?.aborted ? "timeout" : "error",
        latencyMs: Date.now() - startedAt,
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
    // would only give the caller two competing deadlines. It also reports NO USAGE — so the event this
    // path writes carries null tokens and a null cost, and says so.
    //
    // A token-less row rather than no row at all, deliberately: the CALL happened, and a lane that ran
    // fifty times on a claude-cli deployment must not read as a lane that never ran. `unpricedCalls`
    // on the read side is what tells an operator the difference between "this lane is free" and "this
    // lane's cost is not knowable from here" — and that number only exists if the row does.
    return {
      engine: leg.engine,
      model: leg.model,
      run: async (prompt, signal) => {
        const startedAt = Date.now();
        try {
          const { text } = await leg.call({ prompt, legKind: opts.legKind }, signal);
          meter({
            ...opts.meter,
            orgSlug: opts.meter?.orgSlug ?? null,
            legKind: opts.legKind,
            provider: leg.engine,
            model: leg.model,
            status: "success",
            latencyMs: Date.now() - startedAt,
          });
          return text;
        } catch (err) {
          meter({
            ...opts.meter,
            orgSlug: opts.meter?.orgSlug ?? null,
            legKind: opts.legKind,
            provider: leg.engine,
            model: leg.model,
            // This transport owns its own deadline, so an abort here is ITS timeout, not one we can
            // distinguish from a caller disconnect — "error" is the honest label at this seam.
            status: "error",
            latencyMs: Date.now() - startedAt,
          });
          throw err;
        }
      },
    };
  }
  return {
    engine: leg.engine,
    model: leg.model,
    run: withTimeout(leg.engine, leg.model, ENGINE_LABEL[leg.engine], timeoutMs, opts, leg.call),
  };
}
