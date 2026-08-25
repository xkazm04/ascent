// The ONE spawn door every agent-CLI adapter goes through (registry law: one-validation-door).
// Moved VERBATIM in behavior from src/lib/llm/claude-cli.ts's private runClaude() — the byte caps,
// the timeout SIGKILL, the abort wiring, the stdin broken-pipe guard and every error message are
// unchanged for the claude path; only the label and the argv are parameters now, so the codex
// adapter inherits the same hardening instead of re-growing it.
//
// Billing env strips (subscription-auth-selection) are applied by each ADAPTER when it constructs
// `env`, because the direction is per-tool data (claude/codex strip their metered keys; a Gemini-
// class tool would have to INJECT one). What this door guarantees is that the env an adapter built
// is handed to the child exactly as built — no call site can merge anything back in behind it.

import { spawn } from "node:child_process";

/** Cap the accumulated subprocess output. json.ts caps recovery at 256KB, but the subprocess layer
 *  that FEEDS it had no upstream byte cap — a runaway/looping CLI (compromised binary, a giant
 *  result, a never-ending progress stream) grows the heap during accumulation, before any parser
 *  runs, and OOMs the whole Node server (not just this call). A real envelope is KBs. */
const MAX_OUT_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_ERR_BYTES = 16 * 1024; //       16 KB — only a short prefix is ever surfaced

/** shell:true (needed for Windows .cmd resolution) re-parses argv as a shell command line, so a
 *  model value like "sonnet; rm -rf x" or "$(…)" would be executed. Every adapter validates the
 *  model as a simple token against THIS regex before it reaches the spawn — it is the value most
 *  likely to become per-request/org-configurable. */
export const SAFE_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type CliFailureKind = "timeout" | "aborted" | "spawn" | "exit" | "output-cap";

/** Typed spawn-layer failure. `cause` keeps the ORIGINAL thrown/abort value so a consumer that must
 *  rethrow (claude-cli.ts preserves its historical rejection objects) can surface the identical
 *  thing; the message text matches the pre-refactor strings byte for byte. */
export class CliRunError extends Error {
  constructor(
    readonly kind: CliFailureKind,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CliRunError";
  }
}

export interface CaptureArgs {
  bin: string;
  args: string[];
  cwd: string;
  /** Fully-constructed child environment — billing strips already applied (see module header). */
  env: NodeJS.ProcessEnv;
  /** Written to the child's stdin, then the stream is CLOSED — a tool left with an open, silent
   *  stdin may block waiting for "additional input" (codex announces the wait as a notice). */
  stdin: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Human label for error messages: "Claude CLI" | "Codex CLI". */
  label: string;
}

/** Spawn one CLI child, feed it stdin, capture stdout (data) and stderr (logs) SEPARATELY, and
 *  resolve the raw stdout. Rejects with a typed {@link CliRunError}. */
export function captureCli(a: CaptureArgs): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (a.signal?.aborted) {
      reject(new CliRunError("aborted", `${a.label} aborted.`, a.signal.reason ?? new Error(`${a.label} aborted.`)));
      return;
    }
    const child = spawn(a.bin, a.args, {
      shell: true, // needed on Windows to resolve claude.cmd / codex.cmd
      cwd: a.cwd,
      env: a.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new CliRunError("timeout", `${a.label} timed out.`));
    }, a.timeoutMs);

    // Client disconnected — kill the spawned process so an abandoned call doesn't keep a
    // (subscription-billed) CLI run going to completion.
    const onAbort = () => {
      child.kill("SIGKILL");
      reject(new CliRunError("aborted", `${a.label} aborted.`, a.signal?.reason ?? new Error(`${a.label} aborted.`)));
    };
    a.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      a.signal?.removeEventListener("abort", onAbort);
    };

    child.stdout.on("data", (d) => {
      if (out.length > MAX_OUT_BYTES) return; // already over cap and being killed — stop accumulating
      out += d;
      if (out.length > MAX_OUT_BYTES) {
        child.kill("SIGKILL");
        cleanup();
        reject(new CliRunError("output-cap", `${a.label} output exceeded ${MAX_OUT_BYTES} bytes (possible runaway output).`));
      }
    });
    child.stderr.on("data", (d) => {
      if (err.length < MAX_ERR_BYTES) err += d; // only a short prefix is ever surfaced
    });
    child.on("error", (e) => {
      cleanup();
      reject(new CliRunError("spawn", e.message, e));
    });
    child.on("close", (code) => {
      cleanup();
      if (code !== 0) reject(new CliRunError("exit", `${a.label} exited ${code}: ${err.slice(0, 200)}`));
      else resolve(out);
    });

    // A child that dies immediately (missing binary, bad --model, auth failure) can close its
    // stdin; writing to a broken pipe emits an 'error' on child.stdin which, unhandled, becomes an
    // uncaught exception that tears down the whole Node process — not just this call. Handle it.
    child.stdin.on("error", (e) => {
      cleanup();
      reject(new CliRunError("spawn", e.message, e));
    });
    if (!child.stdin.destroyed) {
      child.stdin.write(a.stdin);
      child.stdin.end();
    }
  });
}
