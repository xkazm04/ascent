// Claude Code CLI provider — LOCAL DEV / SELF-HOSTED ONLY.
//
// Shells out to the locally-installed `claude` CLI in headless mode, which runs under
// your Claude Pro/Max **subscription** (not pay-per-token API credits) when no
// ANTHROPIC_API_KEY is present. This is ideal for mass-testing / quality iteration
// without burning API credits. It cannot run on Vercel (no `claude` binary), so it's
// selected explicitly via LLM_PROVIDER=claude-cli for local runs.
//
// The Claude Agent SDK only supports API-key auth, so we deliberately spawn the CLI
// (Node child_process — no Rust needed). Verified: `claude -p --output-format json`
// returns the answer in `.result`.
//
// The spawn / parse / env-strip / stdout-cap mechanics live in the agent-CLI transport seam
// (src/lib/llm/transport/claude.ts) — this module keeps the ASSESSMENT-seam identity: the
// cliProviderAllowed gate, the prompt/usage contract, and mode "generate" (neutral tmpdir cwd, no
// permission flags — an agent that cannot touch files). The EDITING seam is src/lib/local/agent.ts,
// deliberately separate with its own gate; see the headers there and in transport/types.ts.

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { validateAssessment } from "@/lib/llm/provider";
import { parseJsonLoose } from "@/lib/llm/json";
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { cliProviderAllowed } from "@/lib/llm/config";
import { claudeCliTransport, unwrapCliEnvelope, DEFAULT_CLAUDE_MODEL } from "@/lib/llm/transport/claude";

// Re-exported from the transport adapter so existing consumers (config.test.ts, index.ts's mirror
// comment) keep their import surface.
export { DEFAULT_CLAUDE_MODEL };

export class ClaudeCliProvider implements LLMProvider {
  readonly name = "claude-cli" as const;
  readonly model: string;

  constructor(model = process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL) {
    this.model = model;
  }

  async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    const { system, user } = buildAssessmentPrompt(input);
    // Fold the system instructions into the single piped prompt to avoid shell arg
    // quoting issues (the prompt contains quotes/newlines); model treats it as input.
    const prompt = `${system}\n\n${user}`;

    const raw = await runClaude(prompt, { model: this.model, signal: opts.signal });
    const outer = unwrapCliEnvelope(raw);
    // Report token usage (before the parse/usability check, like the other providers) so a claude-cli
    // scan's volume + latency populate the metering columns instead of reading as null. [P2-5]
    if (outer.usage) {
      opts.onUsage?.({
        inputTokens: outer.usage.input_tokens,
        outputTokens: outer.usage.output_tokens,
        cacheReadTokens: outer.usage.cache_read_input_tokens,
        cacheWriteTokens: outer.usage.cache_creation_input_tokens,
      });
    }
    return validateAssessment(parseJsonLoose(outer.result));
  }
}

/**
 * General-purpose "prompt in → model text out" call against the same local `claude` CLI, for the
 * non-scan surfaces that need a single judgment rather than a full LlmAssessment (today: the Shared Org
 * Memory write-intelligence pass — see src/lib/memory/consolidation.ts). Deliberately returns the RAW
 * `.result` string: each caller owns its own schema and parses/validates it (with parseJsonLoose),
 * exactly as assess() does, so this seam stays contract-free.
 *
 * Available wherever the CLI provider is — development, or a SELF-HOSTED production deployment (see
 * cliProviderAllowed in src/lib/llm/config.ts). Callers should still gate on
 * providerAvailable("claude-cli") and reach this module through a dynamic import, so a managed cloud
 * build never pulls it on a path that can't use it.
 *
 * `timeoutMs` defaults to the scan-sized claudeCliTimeoutMs() (10 min — transport/claude.ts). An
 * INTERACTIVE caller (a user waiting on a UI action) should pass something far smaller — a duplicate
 * check that hangs for ten minutes is a broken page, not a slow one.
 */
export async function runClaudePrompt(
  prompt: string,
  opts: { model?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  // Mirror the CLI provider's gate EXACTLY (cliProviderAllowed: dev, or a self-hosted deployment).
  // A caller that skips the documented convention — a new non-scan surface importing this module
  // directly — would otherwise shell out to a `claude` binary that doesn't exist on managed cloud with
  // no explicit "why did this fail" signal. Defense-in-depth, not the primary guard.
  //
  // Sharing the predicate matters more than it looks: when this was `NODE_ENV === "production"` alone,
  // unblocking the CLI provider for self-hosting would have left the Shared Org Memory
  // write-intelligence pass (src/lib/memory/consolidation.ts) still throwing on the very deployments
  // that had just gained a working CLI — one feature quietly dead on the open-source build because two
  // copies of "is the CLI usable here?" had drifted apart. (G3-27)
  if (!cliProviderAllowed()) {
    throw new Error(
      "runClaudePrompt needs a local `claude` binary and is not available on this managed deployment. " +
        "Set ASCENT_SELF_HOSTED=1 if you are running Ascent on your own machine.",
    );
  }
  const raw = await runClaude(prompt, opts);
  return unwrapCliEnvelope(raw).result;
}

/**
 * One assessment-seam call through the transport adapter, returning the RAW envelope capture so both
 * consumers above keep reading `.usage`/`.result` off it exactly as before. Failure parity with the
 * pre-transport implementation: the transport reports a typed error whose `cause` preserves the
 * original rejection object (an abort's `signal.reason`, a spawn ENOENT) and whose message text is
 * unchanged, so this throws the identical things the old private runClaude() rejected with.
 */
async function runClaude(
  prompt: string,
  opts: { model?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const res = await claudeCliTransport.run({
    prompt,
    mode: "generate",
    model: opts.model, // adapter resolves opts.model || CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL
    signal: opts.signal,
    timeoutMs: opts.timeoutMs, // adapter defaults to claudeCliTimeoutMs()
  });
  if (!res.ok) {
    // Envelope failures carry their diagnosable message; spawn/abort failures carry the original
    // thrown value in `cause`. Either way the surfaced failure text is byte-identical to before.
    if (res.error?.kind === "envelope") throw new Error(res.error.message);
    throw (res.error?.cause ?? new Error(res.error?.message ?? "Claude CLI failed."));
  }
  return res.raw;
}
