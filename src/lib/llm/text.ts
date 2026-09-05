// "PROMPT IN → MODEL TEXT OUT" against the SAME provider selection the scan pipeline uses.
//
// WHY THIS EXISTS: LLMProvider.assess() is shaped around one contract (LlmScoreInput → LlmAssessment).
// The non-scan surfaces — Shared Org Memory's write-gate and reflection passes, and Athena's chat
// turns — need a single free-form judgment and own their own schema. Until this existed the only text
// seam in the codebase was runClaudePrompt (src/lib/llm/claude-cli.ts), which is LOCAL-DEV-ONLY, so
// every one of those surfaces was structurally dead in production.
//
// THIS IS NOT A SECOND PROVIDER PATH. It reuses `resolveProviderChoice()` + `providerAvailable()` (so
// "which provider, and is it usable here?" still has exactly ONE answer in this codebase), the shared
// env knobs from config.ts (temperature, max tokens, timeout, the AbortController lifecycle), and the
// same lazy-import discipline the providers use. What it does NOT reuse is the assessment prompt, the
// JSON schema, the token metering and the validateAssessment safety net — none of which apply to a
// caller that brings its own contract.
//
// SELECTION IS DELIBERATELY THE SAME RULE AS getProvider(), NOT A NEW ONE:
//   - an EXPLICIT LLM_PROVIDER wins; if that provider isn't available here, this returns null (the
//     caller degrades honestly) rather than silently substituting a provider the operator didn't pick;
//   - LLM_PROVIDER=auto/unset resolves to Gemini when a key is present, else null;
//   - LLM_PROVIDER=mock returns null. There is no deterministic "mock text" that would be honest to
//     hand a caller whose whole job is judgment — "no engine" is the truthful answer.
// Returning null is a first-class result: callers surface it as `llmUnavailable`.
//
// TWO LAYERS. `resolveLegRunner` returns the RAW, unmetered leg call (prompt + prior turns + tools →
// text/toolCalls/usage) — that is what the multi-leg tool loop needs, because a loop must own ONE
// cross-leg deadline and emit ONE telemetry event, not N of each. `resolveTextRunner` wraps a leg
// runner in the per-call timeout + metering and hands back the single-shot `TextRunner` its existing
// callers already use. The wire formats live in src/lib/llm/transports.ts, the timeout + tracklight
// wrapper in src/lib/llm/text-meter.ts, and the shared vocabulary in src/lib/llm/leg.ts.

import type { ProviderName } from "@/lib/types";
import { providerAvailable, resolveProviderChoice } from "@/lib/llm";
import { llmTimeoutMs } from "@/lib/llm/config";
import { DEFAULT_GEMINI_MODEL } from "@/lib/llm/gemini";
import { DEFAULT_OPENAI_MODEL } from "@/lib/llm/openai";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/llm/openrouter";
import { DEFAULT_BEDROCK_MODEL, DEFAULT_BEDROCK_REGION, type BedrockCredentials } from "@/lib/llm/bedrock";
import type { LegCall, ResolvedLegRunner, ResolvedTextRunner, TextRunnerOptions } from "@/lib/llm/leg";
import { bedrockLeg, geminiLeg, openAiCompatibleLeg } from "@/lib/llm/transports";
import { ENGINE_LABEL, textRunnerFrom } from "@/lib/llm/text-meter";

// The seam's vocabulary lives in leg.ts (a leaf, so the transports and the metering wrapper can share
// it without a cycle); re-exported here because "@/lib/llm/text" is the import path every caller knows.
export type {
  LegCall,
  ResolvedLegRunner,
  ResolvedTextRunner,
  TextRunner,
  TextRunnerOptions,
} from "@/lib/llm/leg";
export { textRunnerFrom } from "@/lib/llm/text-meter";

/** Everything needed to talk to one endpoint, resolved from env or from an org's BYOM record. */
export type LegConnection =
  | { engine: "gemini"; model: string; apiKey: string }
  | { engine: "openai"; model: string; baseUrl: string; apiKey: string }
  | { engine: "local"; model: string; baseUrl: string; apiKey: string }
  | { engine: "openrouter"; model: string; apiKey: string }
  | { engine: "bedrock"; model: string; region: string; credentials?: BedrockCredentials };

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Bind a connection to its wire transport. ONE switch, shared by the env path, the org BYOM path and
 * the tool loop, so a provider can never be reachable from one of them and not the others.
 */
export function legCallFor(conn: LegConnection): LegCall {
  switch (conn.engine) {
    case "gemini":
      return (req, signal) => geminiLeg(conn.model, conn.apiKey, req, signal);
    case "bedrock":
      return (req, signal) => bedrockLeg(conn.model, conn.region, req, signal, conn.credentials);
    case "openrouter":
      return (req, signal) =>
        openAiCompatibleLeg({
          url: `${OPENROUTER_BASE_URL}/chat/completions`,
          headers: {
            authorization: `Bearer ${conn.apiKey}`,
            // OpenRouter's requested app-attribution headers, mirroring OpenRouterProvider.
            "HTTP-Referer": "https://ascent.dev",
            "X-Title": "Ascent",
          },
          model: conn.model,
          label: ENGINE_LABEL.openrouter,
          maxTokensEnv: "OPENROUTER_MAX_TOKENS",
          req,
          signal,
        });
    case "openai":
    case "local":
      return (req, signal) =>
        openAiCompatibleLeg({
          url: `${conn.baseUrl}/chat/completions`,
          headers: conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {},
          model: conn.model,
          label: ENGINE_LABEL[conn.engine],
          // `local` reads the OpenAI cap on purpose: LocalProvider IS an OpenAiProvider subclass and
          // uses OPENAI_MAX_TOKENS on the scan path, so the two paths cannot drift apart.
          maxTokensEnv: "OPENAI_MAX_TOKENS",
          req,
          signal,
        });
  }
}

/**
 * OpenRouter runner for an EXPLICIT key + model. Shared by the env selection below and the per-org
 * BYOM path (text-org.ts), so an org's own key runs the identical transport, headers and metering as
 * the platform's — there is no second OpenRouter code path to drift.
 */
export function openRouterRunner(
  model: string,
  apiKey: string,
  timeoutMs: number,
  opts: TextRunnerOptions,
): ResolvedTextRunner {
  return textRunnerFrom(openRouterLegRunner(model, apiKey), timeoutMs, opts);
}

/** Bedrock runner for an explicit model/region, optionally with an org's own credentials (BYOM). */
export function bedrockRunner(
  model: string,
  region: string,
  timeoutMs: number,
  opts: TextRunnerOptions,
  credentials?: BedrockCredentials,
): ResolvedTextRunner {
  return textRunnerFrom(bedrockLegRunner(model, region, credentials), timeoutMs, opts);
}

/** The unmetered leg twins of the two BYOM runners above (the tool loop meters once, not per leg). */
export function openRouterLegRunner(model: string, apiKey: string): ResolvedLegRunner {
  return { engine: "openrouter", model, call: legCallFor({ engine: "openrouter", model, apiKey }) };
}
export function bedrockLegRunner(
  model: string,
  region: string,
  credentials?: BedrockCredentials,
): ResolvedLegRunner {
  return { engine: "bedrock", model, call: legCallFor({ engine: "bedrock", model, region, credentials }) };
}

/**
 * Resolve the RAW leg runner for the configured provider, or null when none is reachable here.
 *
 * `null` is expected, not exceptional: an unset/mock provider, a missing key, or a claude-cli selection
 * on a production host all mean "no engine". Callers must report that state to the user rather than
 * conflating it with "the model had nothing to say".
 */
export async function resolveLegRunner(opts: TextRunnerOptions): Promise<ResolvedLegRunner | null> {
  const choice = resolveProviderChoice();
  // `auto` (and an unset flag) follows getProvider(): Gemini when a key is present, else nothing.
  const name: ProviderName = choice === "auto" ? "gemini" : choice;
  if (!providerAvailable(name)) return null;

  switch (name) {
    case "gemini": {
      const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
      return {
        engine: "gemini",
        model,
        call: legCallFor({
          engine: "gemini",
          model,
          apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
        }),
      };
    }
    case "openai": {
      const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
      const baseUrl = (process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL).replace(/\/$/, "");
      return {
        engine: "openai",
        model,
        call: legCallFor({ engine: "openai", model, baseUrl, apiKey: process.env.OPENAI_API_KEY ?? "" }),
      };
    }
    case "local": {
      // WAS MISSING ENTIRELY. `providerAvailable("local")` returns true once both knobs are set
      // (src/lib/llm/index.ts:148-151), so LLM_PROVIDER=local passed the guard above and then fell into
      // `default: → null` — meaning a self-hoster on Ollama got "no engine" from EVERY non-scan LLM
      // surface (memory write-gate, reflection, and now Athena) while their scans ran fine. It speaks
      // the OpenAI protocol, so it is the same transport with its own identity (see local.ts on why
      // identity, not capability, is the point).
      const model = (process.env.LOCAL_LLM_MODEL ?? "").trim();
      const baseUrl = (process.env.LOCAL_LLM_BASE_URL ?? "").trim().replace(/\/$/, "");
      return {
        engine: "local",
        model,
        call: legCallFor({
          engine: "local",
          model,
          baseUrl,
          // Local servers usually ignore auth; pass a key through only when the operator set one
          // (a reverse proxy, vLLM's --api-key), mirroring LocalProvider.
          apiKey: process.env.LOCAL_LLM_API_KEY ?? "",
        }),
      };
    }
    case "openrouter":
      return openRouterLegRunner(
        process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
        process.env.OPENROUTER_API_KEY ?? "",
      );
    case "bedrock":
      return bedrockLegRunner(
        process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL,
        process.env.BEDROCK_REGION || process.env.AWS_REGION || DEFAULT_BEDROCK_REGION,
      );
    case "claude-cli": {
      // The dynamic import lives INSIDE a `NODE_ENV !== "production"` block, not after a guard `throw`:
      // the production build inlines NODE_ENV, folds this to `false`, and prunes the block — import
      // included — dropping claude-cli.ts and its child_process.spawn from the Node File Trace. Same
      // trick as LazyClaudeCliProvider (index.ts) and the PGlite boot (instrumentation.ts). providerAvailable
      // already returned false in production, so this branch is unreachable there anyway; the shape is
      // what keeps the bundler from following the import. Do not "simplify" it.
      if (process.env.NODE_ENV !== "production") {
        const { runClaudePrompt } = await import("@/lib/llm/claude-cli");
        const model = process.env.CLAUDE_MODEL || "sonnet";
        const timeoutMs = opts.timeoutMs ?? llmTimeoutMs();
        return {
          engine: "claude-cli",
          model,
          // The CLI owns its own timeout (it spawns a process rather than issuing a request), so pass
          // it through instead of racing a second AbortController against it. It also cannot be handed
          // tools — `--output-format json` collapses the whole session (see supportsToolCalling in
          // config.ts) — so `req.tools` is intentionally ignored here and the loop degrades honestly.
          call: async (req, signal) => ({ text: await runClaudePrompt(req.prompt, { signal, timeoutMs }) }),
          ownsTimeout: true,
        };
      }
      return null;
    }
    case "codex-cli":
      // The codex CLI serves the ASSESSMENT seam only (src/lib/llm/codex-cli.ts). There is no
      // runCodexPrompt counterpart yet, so the non-scan surfaces (memory, Athena) honestly report
      // "no engine" under LLM_PROVIDER=codex-cli rather than silently substituting a provider the
      // operator never chose — the same rule the header states for an unavailable explicit choice.
      return null;
    default:
      // "mock" — see the header: there is no honest deterministic text for a judgment call.
      return null;
  }
}

/**
 * Resolve a single-shot text runner for the configured provider, or null when none is reachable here.
 * See {@link resolveLegRunner} for what `null` means.
 */
export async function resolveTextRunner(opts: TextRunnerOptions): Promise<ResolvedTextRunner | null> {
  const leg = await resolveLegRunner(opts);
  return leg ? textRunnerFrom(leg, opts.timeoutMs ?? llmTimeoutMs(), opts) : null;
}
