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
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { parseJsonLoose } from "@/lib/llm/json";

export const DEFAULT_CLAUDE_MODEL = "sonnet";
const CLI_TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS) || 150_000;

interface CliResult {
  result?: string;
  is_error?: boolean;
  subtype?: string;
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
    let outer: CliResult;
    try {
      outer = JSON.parse(raw) as CliResult;
    } catch {
      throw new Error("Claude CLI did not return JSON envelope.");
    }
    if (outer.is_error || typeof outer.result !== "string") {
      throw new Error(`Claude CLI returned an error (${outer.subtype ?? "unknown"}).`);
    }
    return validateAssessment(parseJsonLoose(outer.result));
  }
}

function runClaude(model: string, stdin: string, signal?: AbortSignal): Promise<string> {
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
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Claude CLI timed out."));
    }, CLI_TIMEOUT_MS);

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

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
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
