// LightTrack gateway provider — assess() routed through `lt-gateway`, the local OpenAI-compatible
// endpoint in front of the seat-metered CLIs (Claude via `claude -p`, GPT via `codex exec`). The
// gateway owns the ROUTE (gateway.toml `[routes.assess]`: a measured primary and the other seat as
// the usage-limit fallback), the failover, `max_tokens`, and the per-attempt telemetry in LightTrack;
// this adapter is the OpenRouter adapter with its transport pointed at localhost. What it deliberately
// does NOT do:
//   - no json_object fallback: the gateway hands `json_schema` to the engine's own schema path and
//     never rejects it; a rejection there is terminal for every seat, so a second request would only
//     spend a seat on the same bad request;
//   - no app-side retry or LLM_FALLBACK_PROVIDER step (scan-assess.ts skips both for this provider):
//     the gateway already tried every target on the route, and a retry on top would double every
//     exhausted-seat attempt;
//   - no trackLlmCall mirror (scan-assess.ts suppresses it): the gateway records every attempt under
//     the `assess` use case itself, and two rows per call is a double count.
// Parsing and validation stay exactly the app's: parseJsonLoose + validateAssessment + the
// isAssessmentUsable coverage guard. The route was chosen from a measured benchmark — see
// docs/LLM_ROUTES.md for the scorecard and the run id.
//
// Config: LIGHTTRACK_GATEWAY_URL (default http://127.0.0.1:8793/v1), LIGHTTRACK_GATEWAY_ROUTE (default
// "assess" — the route name, sent as `model`), LIGHTTRACK_GATEWAY_TIMEOUT_MS (default 10 min: a seat
// call is a full CLI session, the same class as claude-cli/codex-cli). Select with LLM_PROVIDER=gateway.

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { validateAssessment, isAssessmentUsable } from "@/lib/llm/provider";
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { parseJsonLoose } from "@/lib/llm/json";
import { envNumber, llmMaxTokens, withLlmTimeout } from "@/lib/llm/config";
import { assessmentResponseFormat } from "@/lib/llm/schema";

export const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8793/v1";
export const DEFAULT_GATEWAY_ROUTE = "assess";
/** A seat call behind the gateway is a whole CLI session; the hosted 60s default would abort it. */
const DEFAULT_GATEWAY_TIMEOUT_MS = 600_000;
/** The gateway reads no key; the OpenAI shape wants a non-empty bearer, so send a constant. */
const DUMMY_API_KEY = "lt";

/** The gateway's own block on a chat completion (see tracklight docs/GATEWAY.md). */
interface GatewayBlock {
  route?: string;
  served_by?: string;
  fell_back?: boolean;
  attempts?: { target?: string; outcome?: string }[];
}

export function gatewayBaseUrl(): string {
  return (process.env.LIGHTTRACK_GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
}

/** The system prefix and the per-repo message as one user turn — see the `messages` note in assess(). */
export function foldPrompt(system: string, user: string): string {
  return `${system}\n\n---\n\n${user}`;
}

function describeAttempts(attempts: GatewayBlock["attempts"]): string {
  if (!attempts?.length) return "";
  return ` [${attempts.map((a) => `${a.target ?? "?"}: ${a.outcome ?? "?"}`).join(", ")}]`;
}

export class GatewayProvider implements LLMProvider {
  readonly name = "gateway" as const;
  /** The ROUTE name, not a model id: which seat answered is the gateway's decision per call
   *  (`x-lighttrack-served-by`), recorded in LightTrack, and never branched on here. */
  readonly model: string;

  constructor(opts: { route?: string } = {}) {
    this.model = opts.route || process.env.LIGHTTRACK_GATEWAY_ROUTE || DEFAULT_GATEWAY_ROUTE;
  }

  async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    const { system, user } = buildAssessmentPrompt(input);
    const timeoutMs = Math.max(1_000, envNumber("LIGHTTRACK_GATEWAY_TIMEOUT_MS", DEFAULT_GATEWAY_TIMEOUT_MS));
    const { signal, clear } = withLlmTimeout(opts.signal, timeoutMs, "LightTrack gateway request timed out.");
    try {
      const res = await fetch(`${gatewayBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${DUMMY_API_KEY}` },
        body: JSON.stringify({
          model: this.model,
          // Accepted and ignored by the gateway (the CLIs have no such knob); kept so the body is the
          // same OpenAI shape the other adapters send and a future HTTP target on the route honours it.
          max_tokens: llmMaxTokens("LIGHTTRACK_GATEWAY_MAX_TOKENS"),
          // The SHAPE, not just "is JSON": the gateway enforces json_schema through the engine, which
          // is the lever docs/features/scanning/llm-model-matrix.md found for the assessment op.
          response_format: assessmentResponseFormat(),
          // ONE user turn, the system text folded in front of the per-repo message. Not the shape the
          // other adapters send, and deliberate: the gateway hands a `system` message to the Codex
          // CLI on its command line, capped at 16000 characters, and the assessment prefix is ~22400
          // — so a system turn makes every Codex attempt fail before the model runs, and the seat
          // fallback the route exists for would never answer. Folded, both seats read the same
          // bytes, and the benchmark behind docs/LLM_ROUTES.md measured exactly this shape.
          messages: [{ role: "user", content: foldPrompt(system, user) }],
        }),
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let message = text.slice(0, 200);
        let attempts: GatewayBlock["attempts"];
        try {
          const err = JSON.parse(text) as { error?: { message?: string }; lighttrack?: GatewayBlock };
          message = err.error?.message?.slice(0, 200) ?? message;
          attempts = err.lighttrack?.attempts;
        } catch {
          // not the OpenAI error shape — keep the raw snippet
        }
        // Same "(status)" spelling as the other fetch adapters, so scan-assess's llmErrorStatus reads it.
        throw new Error(`LightTrack gateway request failed (${res.status}): ${message}${describeAttempts(attempts)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        lighttrack?: GatewayBlock;
      };
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("Empty response from LightTrack gateway.");
      opts.onUsage?.({ inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens });
      // Log which seat answered when it was not the primary — observability only, never a branch.
      if (data.lighttrack?.fell_back) {
        console.info(
          `[llm/gateway] route "${this.model}" fell back to ${data.lighttrack.served_by ?? "?"}` +
            describeAttempts(data.lighttrack.attempts),
        );
      }

      const parsed = parseJsonLoose(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("LightTrack gateway returned JSON that is not an assessment object.");
      }
      const assessment = validateAssessment(parsed);
      if (!isAssessmentUsable(assessment, input.signals.length)) {
        console.warn(
          `[llm/gateway] route "${this.model}" (served by ${data.lighttrack?.served_by ?? "?"}) scored only ` +
            `${assessment.dimensions.length}/${input.signals.length} dimensions — the scan will lean on deterministic signals.`,
        );
      }
      return assessment;
    } finally {
      clear();
    }
  }
}
