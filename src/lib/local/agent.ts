// LOCAL MODE agent runner — spawn one headless `claude -p` session INSIDE a repository worktree,
// with file-editing permissions, and wait for it to finish. The autopilot's work-executing primitive
// (self-hosted deployments only; see src/lib/local/autopilot.ts for the loop and its guardrails).
//
// This is deliberately a SEPARATE seam from src/lib/llm/claude-cli.ts, not a widening of it. That
// module's runClaudePrompt is an ASSESSMENT call: neutral tmpdir cwd (so no project CLAUDE.md or
// tools load) and no permission flags — an agent that cannot touch files. This one is the opposite
// on both axes: the project cwd and its guidance ARE the point, and `--permission-mode acceptEdits`
// is what lets the session actually commit fixes. Folding the two into one parameterized function
// would make "which mode am I in?" a bug that type-checks.
//
// CONSENT: gated on autopilotEnabled() — the operator must set ASCENT_AUTOPILOT=1. Spawning an
// auto-editing agent is a deliberate opt-in even on a box you own, never a default.
//
//   acceptEdits, NOT --dangerously-skip-permissions: file edits and the pre-approved tool set run
//   unattended, while genuinely dangerous actions still refuse rather than prompt (headless -p has
//   no one to ask). The worktree isolation (autopilot.ts) is the real blast-radius bound; this flag
//   is the second belt.

import { spawn } from "node:child_process";
import { cliProviderAllowed, envNumber } from "@/lib/llm/config";
import { envBool } from "@/lib/env";
import { normalizeAgentEffort, normalizeAgentModel, type AgentConfig } from "@/lib/local/agent-options";

/** Operator consent for the autopilot (spawning editing agents). Off by default, everywhere. */
export function autopilotEnabled(): boolean {
  return envBool("ASCENT_AUTOPILOT") && cliProviderAllowed();
}

/** The model a run falls back to when neither the operator nor the deployment named one. */
export const DEFAULT_AGENT_MODEL = "sonnet";

/**
 * Resolve what a run will ACTUALLY be armed with, from the operator's choice and the deployment's env.
 *
 * Resolved once at arm time rather than per session, and the resolved values are what get persisted
 * on the run: a row reading `model: null` would mean "whatever CLAUDE_MODEL happened to be that day",
 * which is precisely the fact the ledger needs and the one an env var cannot recover after the fact.
 *
 * `effort` stays null when nothing asked for one, and that is not the same as a default: the CLI flag
 * is only passed when a level was chosen, so a `claude` build without `--effort` is unaffected by this
 * feature existing.
 *
 * THE ENV NAME IS `ASCENT_AGENT_EFFORT`, NOT `CLAUDE_EFFORT`, and that is not a style choice.
 * `CLAUDE_EFFORT` is set by the Claude Code harness itself in the environment it hands to child
 * processes (verified 2026-08-28 — it was in the ambient env of the very session that wrote this, and
 * a test asserting "no effort chosen" failed because of it). A self-hosted Ascent started from inside
 * a Claude Code session would have inherited an effort level nobody chose, on every run, invisibly.
 * `CLAUDE_MODEL` carries no such collision and keeps its existing name.
 */
export function resolveAgentConfig(choice: AgentConfig | null | undefined): { model: string; effort: string | null } {
  const picked = normalizeAgentModel(choice?.model);
  const envModel = process.env.CLAUDE_MODEL?.trim();
  return {
    model: picked ?? (envModel || DEFAULT_AGENT_MODEL),
    effort: normalizeAgentEffort(choice?.effort) ?? normalizeAgentEffort(process.env.ASCENT_AGENT_EFFORT?.trim()),
  };
}

/** Per-session ceiling. A fix batch is a real working session — default 20 min, env-tunable. The
 *  same "0 is a misconfiguration, not 'no timeout'" floor as every other timeout knob. */
function agentTimeoutMs(): number {
  return Math.max(60_000, envNumber("ASCENT_AUTOPILOT_TIMEOUT_MS", 1_200_000));
}

const MAX_STDOUT = 4 * 1024 * 1024; // mirror claude-cli.ts's runaway-subprocess caps
const MAX_STDERR = 16 * 1024;

export interface AgentRunResult {
  ok: boolean;
  /** The session's final text (claude -p json envelope `.result`), or the failure reason. */
  summary: string;
}

/** Run one editing session in `cwd`. Resolves (never rejects) — the autopilot treats every outcome
 *  as cycle data: a failed session ends the cycle with its reason in the log, not a stack. */
export function runClaudeAgent(opts: { cwd: string; prompt: string; model?: string; effort?: string | null }): Promise<AgentRunResult> {
  return new Promise((resolve) => {
    if (!autopilotEnabled()) {
      resolve({ ok: false, summary: "Autopilot is not enabled — set ASCENT_AUTOPILOT=1 on this deployment." });
      return;
    }
    const model = opts.model || process.env.CLAUDE_MODEL || DEFAULT_AGENT_MODEL;
    // shell:true is required on Windows (claude.cmd), which re-parses argv — so the model must stay
    // a plain token, same validation and reasoning as claude-cli.ts.
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model)) {
      resolve({ ok: false, summary: `Invalid model "${model}".` });
      return;
    }
    // Effort is normalized against the SAME closed list the picker offers (agent-options.ts) rather
    // than passed through: it reaches a re-parsing shell exactly as the model does. An unrecognised
    // value drops the flag instead of failing the run — a session that would have worked must not die
    // because a stale caller sent a level this build does not know.
    const effort = normalizeAgentEffort(opts.effort);
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // subscription auth, like every local CLI call

    const bin = process.env.CLAUDE_CLI_PATH || "claude";
    // `--effort` is appended ONLY when a level was chosen, so a `claude` build that has never heard of
    // the flag runs exactly the argv it always did.
    const args = ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--model", model];
    if (effort) args.push("--effort", effort);
    const child = spawn(bin, args, {
      shell: true,
      cwd: opts.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let out = "";
    let err = "";
    let settled = false;
    const settle = (r: AgentRunResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      settle({ ok: false, summary: `Agent session exceeded ${Math.round(agentTimeoutMs() / 60_000)} min and was stopped.` });
    }, agentTimeoutMs());

    child.stdout.on("data", (d: Buffer) => {
      if (out.length < MAX_STDOUT) out += d.toString("utf8").slice(0, MAX_STDOUT - out.length);
    });
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < MAX_STDERR) err += d.toString("utf8").slice(0, MAX_STDERR - err.length);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      settle({ ok: false, summary: `Could not start the claude CLI: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const envelope = JSON.parse(out) as { result?: string; is_error?: boolean; subtype?: string };
        if (envelope.is_error || typeof envelope.result !== "string") {
          settle({ ok: false, summary: `Agent error (${envelope.subtype ?? "unknown"}): ${(envelope.result ?? err).slice(0, 500)}` });
        } else {
          settle({ ok: true, summary: envelope.result.slice(0, 4_000) });
        }
      } catch {
        settle({ ok: false, summary: `Agent exited (${code}) without a JSON envelope: ${(out || err).slice(0, 300) || "(no output)"}` });
      }
    });

    child.stdin.write(opts.prompt);
    child.stdin.end();
  });
}
