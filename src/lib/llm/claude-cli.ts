// Claude Code CLI provider — LOCAL DEV / EVAL ONLY.
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

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { validateAssessment } from "@/lib/llm/provider";
import { parseJsonLoose } from "@/lib/llm/json";
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { envNumber } from "@/lib/llm/config";

export const DEFAULT_CLAUDE_MODEL = "sonnet";
// Floor for the CLI timeout, mirroring config.ts's MIN_LLM_TIMEOUT_MS rationale: a 0/negative/tiny
// CLAUDE_CLI_TIMEOUT_MS is a misconfiguration, not "no timeout" — it would SIGKILL every CLI run
// instantly and silently route all local-dev scans to the mock floor (the exact failure class the
// other four providers' timeout floor exists to prevent).
const MIN_CLI_TIMEOUT_MS = 1_000;
/**
 * A claude-cli scan runs a full local CLI session per call — ~6 min median, up to ~10 min on a large
 * repo. The old 150s default cut most real scans off mid-answer, which then failed over to the mock
 * floor. Default to 10 min so a stock deploy completes live; override with CLAUDE_CLI_TIMEOUT_MS.
 * Read at CALL time via config.ts's envNumber (same knob semantics as the other providers: blank /
 * garbage → default, NOT NaN→default-by-accident; a configured 0 is floored, not silently reverted)
 * so tests/ops can restub the env without module-load ordering games.
 * Budget note: this 10-min default deliberately exceeds scan.ts's normal 90s total LLM budget —
 * scan.ts's llmTotalBudgetMs() special-cases claude-cli to a 15-min budget, so one full CLI call plus
 * failover headroom fits. The two knobs are sized together; don't shrink one without the other.
 */
function cliTimeoutMs(): number {
  return Math.max(MIN_CLI_TIMEOUT_MS, envNumber("CLAUDE_CLI_TIMEOUT_MS", 600_000));
}

interface CliResult {
  result?: string;
  is_error?: boolean;
  subtype?: string;
  // The `claude -p --output-format json` envelope reports token usage even under subscription auth.
  // Surfacing it populates the /usage token/latency panel for claude-cli deploys (cost stays ~$0 —
  // subscription, not per-token — but volume is no longer blank). Reference-scan P2-5.
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/**
 * Unwrap the `claude -p --output-format json` envelope, or throw with the diagnosable reason. Shared by
 * assess() and {@link runClaudePrompt} so both surface the SAME failure text for a "/login"
 * subscription-auth prompt, rate-limit output, or a missing binary — instead of each collapsing every
 * non-JSON outcome into its own opaque error. Returns the envelope (result guaranteed to be a string).
 */
function unwrapCliEnvelope(raw: string): CliResult & { result: string } {
  let outer: CliResult;
  try {
    outer = JSON.parse(raw) as CliResult;
  } catch {
    // Preserve the actual stdout so the diagnosable reason survives (a "/login" subscription-auth
    // prompt, rate-limit text, a CLI-not-installed message) instead of collapsing every non-JSON
    // outcome into one opaque error that reads as "model unavailable, deterministic scores."
    throw new Error(`Claude CLI did not return a JSON envelope: ${raw.slice(0, 300) || "(empty stdout)"}`);
  }
  if (outer.is_error || typeof outer.result !== "string") {
    const detail = typeof outer.result === "string" ? outer.result : raw;
    throw new Error(`Claude CLI returned an error (${outer.subtype ?? "unknown"}): ${detail.slice(0, 300)}`);
  }
  return outer as CliResult & { result: string };
}

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

    const raw = await runClaude(this.model, prompt, opts.signal);
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
 * LOCAL-DEV-ONLY, like the rest of this module: callers must gate on providerAvailable("claude-cli")
 * and reach it through a `NODE_ENV !== "production"` dynamic import, so the prod build dead-code-prunes
 * this file (and its child_process.spawn) out of the Node File Trace.
 *
 * `timeoutMs` defaults to the scan-sized cliTimeoutMs() (10 min). An INTERACTIVE caller (a user waiting
 * on a UI action) should pass something far smaller — a duplicate check that hangs for ten minutes is a
 * broken page, not a slow one.
 */
export async function runClaudePrompt(
  prompt: string,
  opts: { model?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const model = opts.model || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
  const raw = await runClaude(model, prompt, opts.signal, opts.timeoutMs);
  return unwrapCliEnvelope(raw).result;
}

function runClaude(
  model: string,
  stdin: string,
  signal?: AbortSignal,
  timeoutMs: number = cliTimeoutMs(),
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Claude CLI aborted."));
      return;
    }
    const bin = process.env.CLAUDE_CLI_PATH || "claude";
    // shell:true (needed for Windows claude.cmd resolution) re-parses argv as a shell command line,
    // so a model value like "sonnet; rm -rf x" or "$(…)" would be executed. Validate the model as a
    // simple token before it reaches the spawn — it is the value most likely to become
    // per-request/org-configurable (the provider abstraction's whole point), so lock it down now.
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model)) {
      reject(new Error(`Invalid CLAUDE_MODEL "${model}" — expected a simple model id (no shell metacharacters).`));
      return;
    }
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // force subscription auth (not pay-per-token)

    const child = spawn(bin, ["-p", "--output-format", "json", "--model", model], {
      shell: true, // needed on Windows to resolve claude.cmd
      cwd: tmpdir(), // neutral cwd so it doesn't auto-load the project's CLAUDE.md/tools
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let out = "";
    let err = "";
    // Cap the accumulated subprocess output. json.ts caps recovery at 256KB, but the subprocess layer
    // that FEEDS it had no upstream byte cap — a runaway/looping CLI (compromised binary, a giant
    // `.result`, a never-ending progress stream) grows the heap during accumulation, before
    // parseJsonLoose ever runs, and OOMs the whole Node server (not just this scan). A real scan
    // envelope is KBs.
    const MAX_OUT_BYTES = 4 * 1024 * 1024; // 4 MB
    const MAX_ERR_BYTES = 16 * 1024; //       16 KB — only err.slice(0,200) is ever surfaced
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Claude CLI timed out."));
    }, timeoutMs);

    // Client disconnected — kill the spawned process so an abandoned scan doesn't keep a
    // (subscription-billed) CLI run going to completion.
    const onAbort = () => {
      child.kill("SIGKILL");
      reject(signal?.reason ?? new Error("Claude CLI aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    child.stdout.on("data", (d) => {
      if (out.length > MAX_OUT_BYTES) return; // already over cap and being killed — stop accumulating
      out += d;
      if (out.length > MAX_OUT_BYTES) {
        child.kill("SIGKILL");
        cleanup();
        reject(new Error(`Claude CLI output exceeded ${MAX_OUT_BYTES} bytes (possible runaway output).`));
      }
    });
    child.stderr.on("data", (d) => {
      if (err.length < MAX_ERR_BYTES) err += d; // only a short prefix is ever surfaced
    });
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("close", (code) => {
      cleanup();
      if (code !== 0) reject(new Error(`Claude CLI exited ${code}: ${err.slice(0, 200)}`));
      else resolve(out);
    });

    // A child that dies immediately (missing binary, bad --model, auth failure) can close its
    // stdin; writing to a broken pipe emits an 'error' on child.stdin which, unhandled, becomes an
    // uncaught exception that tears down the whole Node process — not just this scan. Handle it.
    child.stdin.on("error", (e) => {
      cleanup();
      reject(e);
    });
    if (!child.stdin.destroyed) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}
