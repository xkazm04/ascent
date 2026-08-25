// OpenAI Codex CLI adapter (`codex exec`). The second full citizen of the transport contract, and
// the only tool in the fleet whose readonly-scan promise is OS-ENFORCED rather than policy-based
// (`-s read-only`: macOS Seatbelt / Linux Landlock+seccomp / Windows restricted-token sandbox).
//
// Envelope dialect: there is NO single-result mode — `--json` emits JSONL events on stdout, and the
// answer is the text of the LAST `item.completed` event whose item.type is "agent_message"
// (output-normalization technique, "event stream" dialect). Usage arrives separately in
// `turn.completed`. stderr carries Rust log noise (models-cache errors, stdin notices) and is NEVER
// merged into the parse stream — the shared spawn door keeps the two captures separate.
//
// Billing: ChatGPT-plan seat auth (the default when logged in), protected by stripping
// OPENAI_API_KEY from the child env — codex prefers a visible metered key over the seat session.
//
// NOT wired into the autopilot: mode "edit" returns a typed not-supported error on purpose. The
// editing seam (src/lib/local/agent.ts) is claude-only today and carries its own consent gate.

import { tmpdir } from "node:os";
import { envNumber } from "@/lib/llm/config";
import { captureCli, CliRunError, SAFE_MODEL_RE } from "@/lib/llm/transport/spawn";
import type { AgentCliTransport, TransportProbe, TransportRunArgs, TransportRunResult } from "@/lib/llm/transport/types";

const MIN_CLI_TIMEOUT_MS = 1_000;

/** Same knob semantics as CLAUDE_CLI_TIMEOUT_MS (call-time read, blank/garbage → default, tiny
 *  values floored — a 0 timeout is misconfiguration, not "no timeout"). Codex answers a small
 *  prompt in seconds, but a repo-reading scan is a real session; share claude's 10-min default. */
export function codexCliTimeoutMs(): number {
  return Math.max(MIN_CLI_TIMEOUT_MS, envNumber("CODEX_CLI_TIMEOUT_MS", 600_000));
}

export interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface CodexEvent {
  type?: string;
  item?: { type?: string; text?: string };
  usage?: CodexUsage;
  error?: { message?: string } | string;
  message?: string;
}

export interface CodexParsed {
  /** The last completed agent_message's text — absent when the stream never produced one. */
  text?: string;
  usage?: CodexUsage;
  /** The stream's own error/turn.failed report, when one was emitted. */
  errorMessage?: string;
}

/**
 * Fold a `codex exec --json` JSONL stream. The answer is the LAST `item.completed` event with
 * `item.type === "agent_message"` → `item.text` (never the first parseable line); usage rides in
 * `turn.completed`. Unparseable lines are skipped defensively — stdout SHOULD be clean JSONL (logs
 * go to stderr), but an envelope dialect this young does not get the benefit of the doubt.
 */
export function parseCodexJsonl(raw: string): CodexParsed {
  const parsed: CodexParsed = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: CodexEvent;
    try {
      event = JSON.parse(trimmed) as CodexEvent;
    } catch {
      continue; // not an event line — noise, skipped (never merged into the answer)
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
      parsed.text = event.item.text; // last one wins
    } else if (event.type === "turn.completed" && event.usage) {
      parsed.usage = event.usage;
    } else if (event.type === "turn.failed" || event.type === "error") {
      const err = event.error;
      parsed.errorMessage =
        (typeof err === "string" ? err : err?.message) ?? event.message ?? `Codex CLI reported ${event.type}.`;
    }
  }
  return parsed;
}

function fail(started: number, error: TransportRunResult["error"], raw = ""): TransportRunResult {
  return { ok: false, raw, durationMs: Date.now() - started, error };
}

export const codexCliTransport: AgentCliTransport = {
  name: "codex-cli",
  capabilities: {
    // Verified live on this machine against codex-cli 0.139.0 (agent-cli-transport research,
    // 2026-08-25). NOTE: the two-tier Windows sandbox ships ~0.142+; 0.139's Windows read-only
    // sandbox is the earlier tier — still OS-enforced, but re-verify the row on upgrade.
    verifiedOn: "2026-08-25",
    verifiedVersion: "0.139.0",
    modes: ["generate", "readonly-scan"], // edit deliberately absent — not wired into the autopilot
    answerChannel: "jsonl-events",
    schemaOutput: "schema-file", // --output-schema <FILE> exists in the tool…
    schemaWired: false, //           …but a temp-file path through a shell:true argv (Windows spaces)
    //                               is unwired until a consumer needs it (typed not-supported today).
    readonlyEnforcement: "os-sandbox", // `-s read-only`: Seatbelt / Landlock / Windows restricted tokens
    billing: { direction: "strip", envVars: ["OPENAI_API_KEY"] },
  },

  /** `codex --version` (install) + `codex login status` (zero-token login proof: exit 0 and prints
   *  the auth mode, e.g. "Logged in using ChatGPT"; nonzero when logged out). */
  async probe(): Promise<TransportProbe> {
    const bin = process.env.CODEX_CLI_PATH || "codex";
    const env = { ...process.env };
    let version: string | undefined;
    try {
      const raw = await captureCli({ bin, args: ["--version"], cwd: tmpdir(), env, stdin: "", timeoutMs: 15_000, label: "Codex CLI" });
      version = raw.trim().replace(/^codex-cli\s+/, ""); // "codex-cli 0.139.0" — strip the prefix
    } catch (e) {
      return { available: false, authed: false, detail: e instanceof Error ? e.message.slice(0, 300) : String(e) };
    }
    try {
      const raw = await captureCli({ bin, args: ["login", "status"], cwd: tmpdir(), env, stdin: "", timeoutMs: 15_000, label: "Codex CLI" });
      return { available: true, authed: true, version, detail: raw.trim().slice(0, 200) || undefined };
    } catch (e) {
      return { available: true, authed: false, version, detail: e instanceof Error ? e.message.slice(0, 300) : String(e) };
    }
  },

  async run(args: TransportRunArgs): Promise<TransportRunResult> {
    const started = Date.now();
    if (args.mode === "edit") {
      return fail(started, {
        kind: "not-supported",
        message: "codex-cli transport does not run edit sessions — codex is not wired into the autopilot (the editing seam stays claude-only; see src/lib/local/agent.ts).",
      });
    }
    if (args.schema) {
      return fail(started, {
        kind: "not-supported",
        message: "codex-cli transport has not wired --output-schema through the shell:true spawn door (schemaWired: false); parse the text answer instead.",
      });
    }
    if (args.mode === "readonly-scan" && !args.cwd) {
      return fail(started, { kind: "config", message: "codex-cli readonly-scan requires a cwd (the workspace to read)." });
    }
    const model = args.model || process.env.CODEX_MODEL || "";
    if (model && !SAFE_MODEL_RE.test(model)) {
      return fail(started, {
        kind: "config",
        message: `Invalid CODEX_MODEL "${model}" — expected a simple model id (no shell metacharacters).`,
      });
    }
    // Strip the metered key LAST, after all other env construction, so the run bills to the
    // operator's ChatGPT plan (seat auth), never silently per token.
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    try {
      const raw = await captureCli({
        bin: process.env.CODEX_CLI_PATH || "codex",
        // `-s read-only` in BOTH modes: readonly-scan's promise is the OS sandbox; generate has no
        // workspace to write (neutral tmpdir), so read-only is containment, not a restriction.
        // (No approval flag: `codex exec` is non-interactive by definition — `-a` is a top-level
        // `codex` flag and exec rejects it, verified live 2026-08-25 on 0.139.0.)
        // `--skip-git-repo-check`: the tmpdir/workspace is not necessarily a git repo.
        // Trailing "-": read the prompt from stdin (never the argv — prompts contain quotes,
        // newlines and flag-shaped text); the spawn door closes stdin so codex never blocks on
        // "Reading additional input from stdin...".
        args: ["exec", "--json", "--skip-git-repo-check", "-s", "read-only", ...(model ? ["-m", model] : []), "-"],
        cwd: args.mode === "readonly-scan" ? (args.cwd as string) : tmpdir(), // generate: neutral cwd, no ambient project instructions
        env,
        stdin: args.prompt,
        timeoutMs: Math.max(MIN_CLI_TIMEOUT_MS, args.timeoutMs ?? codexCliTimeoutMs()),
        signal: args.signal,
        label: "Codex CLI",
      });
      const parsed = parseCodexJsonl(raw);
      if (parsed.errorMessage && parsed.text === undefined) {
        return fail(started, { kind: "envelope", message: `Codex CLI reported an error: ${parsed.errorMessage.slice(0, 300)}` }, raw);
      }
      if (parsed.text === undefined) {
        // Never report an empty answer as success — preserve a bounded raw prefix as the diagnosis.
        return fail(
          started,
          { kind: "envelope", message: `Codex CLI produced no agent_message in its JSONL output: ${raw.slice(0, 300) || "(empty stdout)"}` },
          raw,
        );
      }
      return { ok: true, text: parsed.text, raw, durationMs: Date.now() - started };
    } catch (e) {
      if (e instanceof CliRunError) return fail(started, { kind: e.kind, message: e.message, cause: e.cause });
      return fail(started, { kind: "spawn", message: e instanceof Error ? e.message : String(e), cause: e });
    }
  },
};
