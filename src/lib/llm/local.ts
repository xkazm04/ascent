// Local-inference provider — Ollama, vLLM, LM Studio, llama.cpp's server, or anything else that
// speaks the OpenAI Chat Completions protocol on a host you control. Select with LLM_PROVIDER=local.
//
// WHY THIS EXISTS AS ITS OWN PROVIDER. A local server was already reachable through
// `LLM_PROVIDER=openai` + `OPENAI_BASE_URL`, so this is not new capability — it is new IDENTITY, and
// identity is what the surrounding system reasons about:
//
//   - Provenance. The run was persisted as `engineProvider: "openai"`, so /usage's "By inference
//     engine" bars and the executive briefing's "Scored by" line told a self-hoster their scores came
//     from OpenAI when no byte had left their laptop. On an open-source-first product, that is the
//     single most important fact about the scan to get right.
//   - Cost. The built-in price table is keyed on model-id prefixes. A local model whose tag happens to
//     share a prefix with a hosted one got billed at the hosted rate, so /usage invented a dollar
//     figure for inference that cost nothing. `local` is a $0 cost class (see isZeroCostProvider in
//     src/lib/llm/config.ts) — the estimate reads $0.00 because that is the truth, not "no estimate".
//   - Privacy disclosure. /connect's "where your code goes" notice can now say "nowhere" honestly.
//
// CONFIG. Both variables are REQUIRED and neither has a guessed default:
//   LOCAL_LLM_BASE_URL   e.g. http://localhost:11434/v1 (Ollama) · http://localhost:1234/v1 (LM
//                        Studio) · http://localhost:8000/v1 (vLLM). Ports differ per runtime, so
//                        there is no default that is right more often than it is wrong.
//   LOCAL_LLM_MODEL      the exact tag you have pulled, e.g. "qwen2.5-coder:14b".
//   LOCAL_LLM_API_KEY    optional; most local servers ignore auth entirely, so it is omitted unless set.
//
// Deliberately no default model: an invented default ("llama3") would 404 on a machine that never
// pulled it, and a 404 from a model id the operator never chose is a far worse first run than a
// startup error naming the variable to set. `providerAvailable("local")` requires both, so `auto`
// only picks this path once it can actually work.
//
// A small local model will often score fewer than half the rubric's dimensions, at which point the
// scan leans on the deterministic floor — the inherited coverage warning (isAssessmentUsable) names
// the model, so the fix ("use a bigger coder model") is discoverable. Prefer a 14B-class coder model
// or better; the assessment is a multi-KB structured JSON, not a chat reply.

import { OpenAiProvider } from "@/lib/llm/openai";
import type { AssessOptions, LlmScoreInput } from "@/lib/llm/provider";
import type { LlmAssessment } from "@/lib/types";

/** Whether both required knobs are present — the availability contract for `LLM_PROVIDER=local`. */
export function localLlmConfigured(): boolean {
  return Boolean(process.env.LOCAL_LLM_BASE_URL?.trim() && process.env.LOCAL_LLM_MODEL?.trim());
}

/**
 * A local OpenAI-compatible endpoint, reported as its own provider. Subclasses rather than wraps
 * OpenAiProvider so every hardening already in that class — the strict json_schema decode with the
 * one-shot json_object retry, the max-tokens floor that Ollama's tiny `num_predict` default needs,
 * the shape guard, the timeout/abort composition — applies here without being restated.
 */
export class LocalProvider extends OpenAiProvider {
  /** The resolved endpoint, kept here because the parent's `baseUrl` is private — this is what the
   *  configuration guard checks, so a constructor-supplied URL counts just like the env one. */
  private readonly endpoint: string;

  constructor(opts: { model?: string; baseUrl?: string; apiKey?: string } = {}) {
    const endpoint = (opts.baseUrl || process.env.LOCAL_LLM_BASE_URL || "").trim();
    super({
      name: "local",
      label: "the local LLM server",
      // Local servers do not authenticate. Passing the key through anyway means an operator who DID
      // put a token in front of theirs (a reverse proxy, vLLM's --api-key) is still served.
      requireApiKey: false,
      apiKey: opts.apiKey ?? process.env.LOCAL_LLM_API_KEY ?? "",
      model: (opts.model || process.env.LOCAL_LLM_MODEL || "").trim(),
      baseUrl: endpoint,
    });
    this.endpoint = endpoint;
  }

  /** Fail with the variable NAME rather than letting an empty base URL become a `fetch("/chat/…")`
   *  relative-URL crash, or an empty model become a confusing 400 from the server. */
  private assertConfigured(): void {
    if (!this.model || !this.endpoint) {
      throw new Error(
        "LLM_PROVIDER=local requires both LOCAL_LLM_BASE_URL (e.g. http://localhost:11434/v1 for " +
          'Ollama) and LOCAL_LLM_MODEL (e.g. "qwen2.5-coder:14b"). Set them in .env.local and make ' +
          "sure the model is pulled.",
      );
    }
  }

  override async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    this.assertConfigured();
    return super.assess(input, opts);
  }
}
