// Claude Code CLI adapter — the reference implementation of the transport contract. The spawn /
// parse / env-strip / stdout-cap guts moved here from src/lib/llm/claude-cli.ts (which now
// delegates, keeping its exported API and behavior identical); the seam-level gating
// (cliProviderAllowed) deliberately stays with the CONSUMERS — this module is mechanism, not policy.
//
// Runs under the operator's Claude Pro/Max **subscription** (not pay-per-token API credits) because
// ANTHROPIC_API_KEY is stripped from the child env at run() — the CLI prefers a visible metered key
// over the cached seat session, so the strip is what keeps mass local scans effectively free.

import { tmpdir } from "node:os";
import { envNumber } from "@/lib/llm/config";
import { captureCli, CliRunError, SAFE_MODEL_RE } from "@/lib/llm/transport/spawn";
import type { AgentCliTransport, TransportProbe, TransportRunArgs, TransportRunResult } from "@/lib/llm/transport/types";

export const DEFAULT_CLAUDE_MODEL = "sonnet";

// Floor for the CLI timeout, mirroring config.ts's MIN_LLM_TIMEOUT_MS rationale: a 0/negative/tiny
// CLAUDE_CLI_TIMEOUT_MS is a misconfiguration, not "no timeout" — it would SIGKILL every CLI run
// instantly and silently route all local-dev scans to the mock floor (the exact failure class the
// other providers' timeout floor exists to prevent).
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
export function claudeCliTimeoutMs(): number {
  return Math.max(MIN_CLI_TIMEOUT_MS, envNumber("CLAUDE_CLI_TIMEOUT_MS", 600_000));
}

export interface ClaudeCliEnvelope {
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
 * Unwrap the `claude -p --output-format json` envelope, or throw with the diagnosable reason. Shared
 * by this adapter and claude-cli.ts's assess()/runClaudePrompt (which re-reads usage off the raw
 * capture) so every consumer surfaces the SAME failure text for a "/login" subscription-auth prompt,
 * rate-limit output, or a missing binary — instead of each collapsing every non-JSON outcome into
 * its own opaque error. Returns the envelope (result guaranteed to be a string).
 */
export function unwrapCliEnvelope(raw: string): ClaudeCliEnvelope & { result: string } {
  let outer: ClaudeCliEnvelope;
  try {
    outer = JSON.parse(raw) as ClaudeCliEnvelope;
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
  return outer as ClaudeCliEnvelope & { result: string };
}

function fail(started: number, error: TransportRunResult["error"], raw = ""): TransportRunResult {
  return { ok: false, raw, durationMs: Date.now() - started, error };
}

export const claudeCliTransport: AgentCliTransport = {
  name: "claude-cli",
  capabilities: {
    // Verified live on this machine against claude 2.1.245 (see the agent-cli-transport subject's
    // research notes). Re-verify and re-date when a row changes — these tools ship weekly.
    verifiedOn: "2026-08-25",
    verifiedVersion: "2.1.245",
    // `edit` deliberately ABSENT: the editing seam is src/lib/local/agent.ts (worktree isolation +
    // ASCENT_AUTOPILOT consent gate), a separate module on purpose — see types.ts header.
    // `readonly-scan` absent until a consumer needs it: claude's read-only stance
    // (--permission-mode plan) is tool policy, not an OS sandbox, and stays unwired rather than
    // promised untested.
    modes: ["generate"],
    answerChannel: "single-json", // answer in `.result`; is_error/subtype carry the error class
    schemaOutput: "inline-flag", // --json-schema exists in the tool…
    schemaWired: false, //           …but inline JSON through a shell:true argv is a quoting hazard;
    //                               unwired until a consumer needs it (typed not-supported today).
    readonlyEnforcement: "policy",
    billing: { direction: "strip", envVars: ["ANTHROPIC_API_KEY"] },
  },

  /** `claude --version` (install) + `claude auth status` (zero-token login proof — a JSON with
   *  `loggedIn`; credential-FILE existence would prove nothing). */
  async probe(): Promise<TransportProbe> {
    const bin = process.env.CLAUDE_CLI_PATH || "claude";
    const env = { ...process.env };
    let version: string | undefined;
    try {
      const raw = await captureCli({ bin, args: ["--version"], cwd: tmpdir(), env, stdin: "", timeoutMs: 15_000, label: "Claude CLI" });
      version = raw.trim().split(/\s+/)[0] || raw.trim(); // "2.1.245 (Claude Code)" — parse leniently
    } catch (e) {
      return { available: false, authed: false, detail: e instanceof Error ? e.message.slice(0, 300) : String(e) };
    }
    try {
      const raw = await captureCli({ bin, args: ["auth", "status"], cwd: tmpdir(), env, stdin: "", timeoutMs: 15_000, label: "Claude CLI" });
      const status = JSON.parse(raw) as { loggedIn?: boolean };
      return { available: true, authed: status.loggedIn === true, version };
    } catch (e) {
      return { available: true, authed: false, version, detail: e instanceof Error ? e.message.slice(0, 300) : String(e) };
    }
  },

  async run(args: TransportRunArgs): Promise<TransportRunResult> {
    const started = Date.now();
    if (args.mode !== "generate") {
      return fail(started, {
        kind: "not-supported",
        message:
          args.mode === "edit"
            ? "claude-cli transport does not run edit sessions — the editing seam is src/lib/local/agent.ts (worktree + ASCENT_AUTOPILOT gate), kept separate on purpose."
            : `claude-cli transport does not implement mode "${args.mode}" yet (capability matrix: modes=[generate]).`,
      });
    }
    if (args.schema) {
      return fail(started, {
        kind: "not-supported",
        message: "claude-cli transport has not wired --json-schema through the shell:true spawn door (schemaWired: false); parse the text answer instead.",
      });
    }
    const model = args.model || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
    if (!SAFE_MODEL_RE.test(model)) {
      return fail(started, {
        kind: "config",
        message: `Invalid CLAUDE_MODEL "${model}" — expected a simple model id (no shell metacharacters).`,
      });
    }
    // Strip the metered key LAST, after all other env construction, so nothing re-introduces it —
    // this is what keeps the run on the operator's subscription seat.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // force subscription auth (not pay-per-token)
    try {
      const raw = await captureCli({
        bin: process.env.CLAUDE_CLI_PATH || "claude",
        args: ["-p", "--output-format", "json", "--model", model],
        cwd: tmpdir(), // neutral cwd so it doesn't auto-load the project's CLAUDE.md/tools
        env,
        stdin: args.prompt,
        timeoutMs: Math.max(MIN_CLI_TIMEOUT_MS, args.timeoutMs ?? claudeCliTimeoutMs()),
        signal: args.signal,
        label: "Claude CLI",
      });
      try {
        const envelope = unwrapCliEnvelope(raw);
        return { ok: true, text: envelope.result, raw, durationMs: Date.now() - started };
      } catch (e) {
        const envelope = ((): ClaudeCliEnvelope => {
          try {
            return JSON.parse(raw) as ClaudeCliEnvelope;
          } catch {
            return {};
          }
        })();
        return fail(started, { kind: "envelope", message: e instanceof Error ? e.message : String(e), subtype: envelope.subtype }, raw);
      }
    } catch (e) {
      if (e instanceof CliRunError) return fail(started, { kind: e.kind, message: e.message, cause: e.cause });
      return fail(started, { kind: "spawn", message: e instanceof Error ? e.message : String(e), cause: e });
    }
  },
};
