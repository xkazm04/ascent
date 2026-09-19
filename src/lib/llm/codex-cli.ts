// OpenAI Codex CLI provider — LOCAL DEV / SELF-HOSTED ONLY, the assessment-seam twin of
// claude-cli.ts on the codex transport adapter.
//
// Shells out to the locally-installed `codex` CLI (`codex exec --json`, prompt over stdin), which
// runs under the operator's ChatGPT-plan seat (OPENAI_API_KEY is stripped at the spawn door so a
// visible metered key never silently outbids the subscription). Like claude-cli it cannot run on
// managed cloud (no binary on the host), so it is selected explicitly via LLM_PROVIDER=codex-cli
// and gated by the SAME cliProviderAllowed() predicate — one answer to "is a local agent CLI
// usable here?", never two drifting copies.
//
// The spawn / JSONL-parse / env-strip / stdout-cap mechanics live in the transport seam
// (src/lib/llm/transport/codex.ts). This module keeps the ASSESSMENT-seam identity: the gate, the
// prompt/usage contract, and mode "generate" (neutral tmpdir cwd — an agent that cannot touch
// files). The EDITING seam (src/lib/local/agent.ts) stays claude-only on purpose: the codex
// transport returns a typed not-supported error for mode "edit".

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { validateAssessment } from "@/lib/llm/provider";
import { parseJsonLoose } from "@/lib/llm/json";
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { codexCliTransport, parseCodexJsonl } from "@/lib/llm/transport/codex";

/**
 * Display/persistence identity when CODEX_MODEL is unset: the CLI picks its own configured default
 * model, and we cannot know that id without spending a probe — so the sentinel says exactly that
 * instead of inventing a model name. It is NEVER passed to `codex -m` (see assess below); set
 * CODEX_MODEL to persist (and price) a real model id.
 */
export const DEFAULT_CODEX_MODEL = "codex-default";

export class CodexCliProvider implements LLMProvider {
  readonly name = "codex-cli" as const;
  readonly model: string;

  constructor(model = process.env.CODEX_MODEL || DEFAULT_CODEX_MODEL) {
    this.model = model;
  }

  async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    const { system, user } = buildAssessmentPrompt(input);
    // Fold the system instructions into the single piped prompt, same as claude-cli: the prompt
    // goes over stdin (never argv), so quoting is a non-issue but the CLI has no system-slot.
    const prompt = `${system}\n\n${user}`;

    const res = await codexCliTransport.run({
      prompt,
      mode: "generate",
      // The sentinel is a DISPLAY identity, not a model id — passing it as `-m codex-default`
      // would make every call fail against a model that doesn't exist. Omit → the CLI's default.
      model: this.model === DEFAULT_CODEX_MODEL ? undefined : this.model,
      signal: opts.signal,
      // timeoutMs: adapter defaults to codexCliTimeoutMs() (CODEX_CLI_TIMEOUT_MS, 10 min).
    });
    if (!res.ok) {
      if (res.error?.kind === "envelope") throw new Error(res.error.message);
      throw (res.error?.cause ?? new Error(res.error?.message ?? "Codex CLI failed."));
    }
    // Usage rides in the JSONL's `turn.completed` event, kept in the raw capture. Report input/
    // output only: codex's `cached_input_tokens` semantics relative to `input_tokens` (subset vs
    // disjoint) are not pinned by a fixture yet, and guessing a mapping would flow straight into
    // billableInputTokens()'s cost fold — an unreported field means "unknown", never a wrong number.
    const usage = parseCodexJsonl(res.raw).usage;
    if (usage) {
      opts.onUsage?.({
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      });
    }
    return validateAssessment(parseJsonLoose(res.text ?? ""));
  }
}
