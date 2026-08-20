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

/** Operator consent for the autopilot (spawning editing agents). Off by default, everywhere. */
export function autopilotEnabled(): boolean {
  return envBool("ASCENT_AUTOPILOT") && cliProviderAllowed();
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
export function runClaudeAgent(opts: { cwd: string; prompt: string; model?: string }): Promise<AgentRunResult> {
  return new Promise((resolve) => {
    if (!autopilotEnabled()) {
      resolve({ ok: false, summary: "Autopilot is not enabled — set ASCENT_AUTOPILOT=1 on this deployment." });
      return;
    }
    const model = opts.model || process.env.CLAUDE_MODEL || "sonnet";
    // shell:true is required on Windows (claude.cmd), which re-parses argv — so the model must stay
    // a plain token, same validation and reasoning as claude-cli.ts.
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model)) {
      resolve({ ok: false, summary: `Invalid model "${model}".` });
      return;
    }
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // subscription auth, like every local CLI call

    const bin = process.env.CLAUDE_CLI_PATH || "claude";
    const child = spawn(bin, ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--model", model], {
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
