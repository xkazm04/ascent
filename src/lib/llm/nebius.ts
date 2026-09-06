// Nebius Token Factory — hosted open-weight inference, reported as its own provider.
//
// WHY THIS EXISTS AS ITS OWN PROVIDER, AND NOT AS `local` WITH A DIFFERENT BASE URL.
// Nebius speaks the OpenAI Chat Completions protocol, so `LLM_PROVIDER=local` +
// LOCAL_LLM_BASE_URL=https://api.tokenfactory.nebius.com/v1 would have worked on the first try.
// That is exactly the shortcut `local.ts` was written to warn about, one vendor over:
//
//   - Provenance. A scan run on GLM or Nemotron would persist `engineProvider: "local"`, so /usage's
//     "By inference engine" bars and the briefing's "Scored by" line would tell an operator the work
//     was done on their own hardware when it was done in someone else's datacenter. On an
//     open-source-first product that is the single most important fact about a scan to get right —
//     and it is worse in this direction than in the one local.ts documents, because the honest
//     answer here is "your code went somewhere".
//   - Cost. `local` is a $0 cost class. Nebius bills per token, so inheriting that class would print
//     $0.00 for inference that costs real money — the same defect as a local model billed at a
//     hosted rate, with the sign flipped.
//   - Privacy disclosure. /connect's "where your code goes" notice can say "nowhere" for `local`.
//     It must not say that here.
//
// CONFIG:
//   NEBIUS_API_KEY   required. The same key the Token Factory console issues.
//   NEBIUS_MODEL     required. An exact model id from GET /v1/models, e.g. "zai-org/GLM-5.3-Flash",
//                    "nvidia/Nemotron-3_5-Lightning", "MiniMaxAI/MiniMax-M3".
//   NEBIUS_BASE_URL  optional override; defaults to the public endpoint below.
//
// Deliberately no default model, for the reason local.ts gives: an invented default would 404 on an
// account that has not enabled it, and a 404 for a model id the operator never chose is a worse
// first run than a startup error naming the variable to set.
//
// A NOTE ON REASONING MODELS. Several models here emit their chain of thought into `content` rather
// than a separate field — measured 2026-09-05: `nvidia/Nemotron-3_5-Lightning` answered a "reply
// with exactly OK" probe with a numbered thinking process. The parent class's strict json_schema
// decode with a one-shot json_object retry already absorbs that (it is the same failure as any
// model prefacing its JSON with prose), which is the whole reason this subclasses OpenAiProvider
// instead of reimplementing a client.

import { OpenAiProvider } from "@/lib/llm/openai";
import type { AssessOptions, LlmScoreInput } from "@/lib/llm/provider";
import type { LlmAssessment } from "@/lib/types";

/** The public Token Factory endpoint. OpenAI-compatible; `/chat/completions` hangs off it. */
export const NEBIUS_DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1";

/** Whether both required knobs are present — the availability contract for `LLM_PROVIDER=nebius`. */
export function nebiusConfigured(): boolean {
  return Boolean(process.env.NEBIUS_API_KEY?.trim() && process.env.NEBIUS_MODEL?.trim());
}

/**
 * Hosted Nebius inference. Subclasses rather than wraps OpenAiProvider so every hardening already in
 * that class — the strict json_schema decode with the one-shot json_object retry, the max-tokens
 * floor, the shape guard, the timeout/abort composition — applies here without being restated.
 */
export class NebiusProvider extends OpenAiProvider {
  /** Kept because the parent's `baseUrl` is private, and the configuration guard checks it. */
  private readonly endpoint: string;
  /**
   * The model the operator actually asked for, before the parent's fallback chain.
   *
   * `OpenAiProvider`'s constructor resolves `opts.model || OPENAI_MODEL || "gpt-4o-mini"`, so by the
   * time it lands on `this.model` an unset NEBIUS_MODEL has become **gpt-4o-mini** — a model Nebius
   * does not serve. Guarding on `this.model` would therefore never fire, and the operator would get
   * an opaque 404 for a model id they never chose instead of the variable name to set. So the
   * request is remembered here, unresolved, and that is what the guard reads.
   */
  private readonly requestedModel: string;

  constructor(opts: { model?: string; baseUrl?: string; apiKey?: string } = {}) {
    const endpoint = (opts.baseUrl || process.env.NEBIUS_BASE_URL || NEBIUS_DEFAULT_BASE_URL).trim();
    const requested = (opts.model || process.env.NEBIUS_MODEL || "").trim();
    super({
      name: "nebius",
      label: "Nebius Token Factory",
      // Unlike `local`, this is a hosted API and the key is not optional: without it every call is
      // a 401, and failing at the door names the variable instead.
      requireApiKey: true,
      apiKey: opts.apiKey ?? process.env.NEBIUS_API_KEY ?? "",
      model: requested,
      baseUrl: endpoint,
    });
    this.endpoint = endpoint;
    this.requestedModel = requested;
  }

  /** Fail with the variable NAME rather than letting an empty model become a confusing 400. */
  private assertConfigured(): void {
    if (!this.requestedModel || !this.endpoint) {
      throw new Error(
        "LLM_PROVIDER=nebius requires NEBIUS_API_KEY and NEBIUS_MODEL (an exact id from " +
          'GET /v1/models, e.g. "zai-org/GLM-5.3-Flash"). Set them in .env.local.',
      );
    }
  }

  override async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    this.assertConfigured();
    return super.assess(input, opts);
  }
}
