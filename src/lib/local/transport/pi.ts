// THE PI TRANSPORT — the second agent CLI behind the lane's spawn seam, and the reason the bake-off
// is a bake-off rather than a demonstration.
//
// Claude Code's headless mode is the proven path (it drove a local 27B through a real file edit on
// 2026-09-21), but it sends ~16k tokens of its own system prompt before the lane's brief is read, and
// every field report of a local model failing inside an agent harness — parameters silently dropped,
// tool-call JSON corrupted mid-call, drift past twenty steps — is prompt-size-shaped. Pi carries a
// much smaller prompt. Whether that makes a 27B at 4-bit MORE COMPETENT at the same lane is exactly
// the question the operator asked, and only two adapters can answer it.
//
// MEASURED, 2026-09-21, pi 0.86.1 on this machine: Pi's whole system message — preamble, tool list,
// rules, docs and cwd — is **2 879 characters, roughly 720 tokens**, read out of the `message_end`
// event of a real session. That is the size of the claim this transport exists to test, and it is a
// measurement of the prompt, NOT yet a measurement of competence: no lane has been run on both arms.
//
// WHAT PI IS NOT. It is not a Claude CLI with different flags, and four of its differences would each
// have been a silent wrong number if assumed instead of read. They live in `pi-normalize.ts` next to
// the code that handles them; the two that shape THIS file are:
//
//   • PI EXITS 0 ON A TOTAL FAILURE (three connection retries, then `auto_retry_end {success:false}`,
//     status 0). So `ok` is read from the stream. The opposite shape exists too — an unknown provider
//     exits 1 with an EMPTY stdout and one line on stderr — which is why stderr is still parsed.
//   • PI HAS NO PERMISSION MODES. Its editing/planning stance is a TOOL ALLOWLIST (`-t`), and the
//     allowlist is verified by reading back the tool list Pi puts in the model's own system prompt —
//     a stance that was ADOPTED, not a flag that merely parsed.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { agentSpawnEnv, autopilotEnabled, type AgentRunResult } from "@/lib/local/agent";
import { agentTimeoutMs } from "@/lib/local/lane-watchdog";
import { MODEL_TOKEN } from "@/lib/local/arm";
import { detachForKillTree, killProcessTree } from "@/lib/local/kill-tree";
import { sanitizeAgentStderr } from "@/lib/local/agent-stderr";
import { SESSION_ID } from "@/lib/local/transport/claude";
import { createPiParser } from "@/lib/local/transport/pi-normalize";

import type { LocalEndpoint, TransportRunOptions } from "@/lib/local/transport/run";
import { PI_LOCAL_PROVIDER, piLocalTiming, piProfile } from "@/lib/local/transport/pi-profile";

// Re-exported so every existing importer of these names keeps working unchanged; they LIVE in
// pi-profile.ts, which is dependency-free so the cockpit can read the registry (see that file).
export { PI_LOCAL_PROVIDER, piLocalTiming, piProfile };

/** Mirrors the Claude runner's caps, so one stdout line and the stderr copy are bounded identically. */
const MAX_STDOUT = 4 * 1024 * 1024;
const MAX_STDERR = 16 * 1024;


/** What `piArgs` needs to know — a subset of the run options, restated so the argv is a value a table
 *  test can compare against a literal rather than something only a subprocess can answer. */
export interface PiArgvInput {
  /** The model as Pi must be told it: `<provider>/<id>` for a generated local provider, else the
   *  bare id the operator's own `~/.pi/agent/models.json` already names. */
  model: string;
  permission?: "edit" | "plan";
  sessionId?: string | null;
  resumeSessionId?: string | null;
  /** Where Pi stores and looks up sessions. Passed ONLY alongside a session id, and it must be a
   *  STABLE path — a resume looks the id up in this directory, so a per-run temp directory would
   *  make every `--session <uuid>` a silent fresh start. */
  sessionDir?: string | null;
}

/** The read-only planning allowlist and the editing one, as smoked. One token each, no spaces,
 *  because `shell: true` re-parses argv on Windows. */
export const PI_PLAN_TOOLS = "read";
export const PI_EDIT_TOOLS = "read,bash,edit,write";

/**
 * THE ARGUMENT VECTOR. Pure, so it is pinned against a literal in the test rather than against a
 * re-derivation of itself.
 *
 * `--thinking off` is deliberate and is NOT a quality choice made for Pi: the repo pins LLM
 * temperature to 0 globally for reproducibility, and a reasoning level the caller never chose is the
 * same class of ambient input. A qwen3.8 run still emits `thinking` blocks (the model's own), which
 * the normalizer ignores exactly as the Claude parser ignores Claude's.
 */
export function piArgs(input: PiArgvInput): string[] {
  const tools = input.permission === "plan" ? PI_PLAN_TOOLS : PI_EDIT_TOOLS;
  const args = ["-p", "--mode", "json", "--model", input.model, "-t", tools, "--thinking", "off"];
  // Session ids reach a re-parsing shell, so they get the same treatment the Claude door gives them:
  // a UUID or nothing. An invalid id DROPS the flag rather than failing the session — a resume that
  // cannot be honoured degrades to a fresh session.
  //
  // TWO DIFFERENT FLAGS, and swapping them is a silent fresh session: `--session-id <uuid>` CREATES a
  // session with that id, `--session <uuid>` RESUMES one. Pi's own `--resume` is the interactive
  // picker and would hang a headless run on a TUI, so it is never passed.
  const resuming = input.resumeSessionId && SESSION_ID.test(input.resumeSessionId) ? input.resumeSessionId : null;
  const creating = !resuming && input.sessionId && SESSION_ID.test(input.sessionId) ? input.sessionId : null;
  if (resuming) args.push("--session", resuming);
  else if (creating) args.push("--session-id", creating);
  if (resuming || creating) {
    // The directory the id is looked up in. Omitting it would leave the session under whatever
    // `PI_CODING_AGENT_DIR` this run generated — i.e. gone by the time anything tried to resume it.
    if (input.sessionDir) args.push("--session-dir", input.sessionDir);
  } else {
    // A session nobody will resume must not accumulate transcript files anywhere.
    args.push("--no-session");
  }
  return args;
}

/**
 * THE GENERATED PROVIDER FILE for a local endpoint.
 *
 * Pi does not take a base URL on argv or in the environment — an endpoint is a PROVIDER ENTRY in
 * `~/.pi/agent/models.json`. Writing into the operator's own file would be a process-wide global by
 * another name: two lanes armed at two endpoints in the same minute would fight over one file, and
 * "which endpoint did this lane use?" would become a question about scheduling order. `PI_CODING_AGENT_DIR`
 * is Pi's documented override for that whole directory, so each local session gets a config directory
 * of its own and the endpoint stays an ENV BLOCK ON THE SPAWN — the same property `run.ts` demands.
 *
 * `contextWindow` is the load-bearing number: an Ollama server left at its own default serves 4 096
 * tokens under 24 GB of VRAM, which truncates the tool-definition block and produces a model that
 * appears unable to call tools. THIS SIDE IS THE CLIENT'S DECLARATION ONLY — the server's
 * `OLLAMA_CONTEXT_LENGTH` is the operator's to set, and the probe package enforces it.
 *
 * `compat.supportsDeveloperRole: false` / `supportsReasoningEffort: false` are Pi's documented switches
 * for OpenAI-compatible servers that do not understand the `developer` role or `reasoning_effort`;
 * Ollama is named in those docs and the measured runs all carried them.
 */
export function piModelsJson(endpoint: LocalEndpoint): string {
  return `${JSON.stringify(
    {
      providers: {
        [PI_LOCAL_PROVIDER]: {
          baseUrl: endpoint.baseUrl,
          api: "openai-completions",
          // Local servers ignore the value but reject its absence, so an absent one is a connection
          // failure that reads like a model failure.
          apiKey: endpoint.token || "ollama",
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
          models: [
            {
              id: endpoint.model,
              contextWindow: endpoint.contextTokens,
              // NOT a measurement and not a guess either: Pi requires the field to bound one reply,
              // and a quarter of the declared window is the ratio the smoked config used.
              maxTokens: Math.max(1_024, Math.floor(endpoint.contextTokens / 4)),
              // Zeros here are a PRICE LIST, which is why the normalizer refuses to read them back as
              // a measurement. See `zeroCost`.
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * THE ONE STABLE SESSION STORE, deliberately OUTSIDE the per-run config directory.
 *
 * A session lives long enough to be resumed by a LATER process (the minor execution resumes its
 * planning session), so it cannot live in a directory this run deletes on settle. It is also not the
 * operator's `~/.pi/agent`: an Ascent lane's transcripts are the server's, not the human's.
 * `ASCENT_PI_SESSION_DIR` overrides it for a deployment that keeps state elsewhere.
 */
export function piSessionDir(): string {
  return process.env.ASCENT_PI_SESSION_DIR?.trim() || join(tmpdir(), "ascent-pi-sessions");
}

/** The per-session config directory, or null when no endpoint was armed (the operator's own
 *  `~/.pi/agent` is then used unchanged, which is what a Pi run outside a local arm should do). */
function armConfigDir(endpoint: LocalEndpoint | null): { dir: string; agentDir: string } | null {
  if (!endpoint) return null;
  const dir = mkdtempSync(join(tmpdir(), "ascent-pi-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "models.json"), piModelsJson(endpoint), "utf8");
  return { dir, agentDir };
}

/**
 * Run one Pi session in `cwd`. Resolves (never rejects) — every outcome is cycle data, exactly as
 * `runClaudeAgent` has always behaved, and the settle discipline below is deliberately the same
 * shape: killing is not the mechanism by which a lane is freed, settling is.
 */
export function runPiAgent(opts: TransportRunOptions): Promise<AgentRunResult> {
  return new Promise((resolve) => {
    const endpoint = opts.endpoint ?? null;
    const limitMs = agentTimeoutMs(opts.timeoutMs, { transport: "pi", local: endpoint != null });
    if (opts.signal?.aborted) {
      resolve({ ok: false, summary: "Agent session stopped by the operator — no session was started." });
      return;
    }
    if (!autopilotEnabled()) {
      resolve({ ok: false, summary: "Autopilot is not enabled — set ASCENT_AUTOPILOT=1 on this deployment." });
      return;
    }
    const bareModel = endpoint?.model || opts.model || "";
    if (!MODEL_TOKEN.test(bareModel)) {
      resolve({ ok: false, summary: `Invalid model "${bareModel}".` });
      return;
    }
    let cfg: { dir: string; agentDir: string } | null = null;
    try {
      cfg = armConfigDir(endpoint);
    } catch (e) {
      resolve({ ok: false, summary: `Could not write the Pi provider config: ${(e as Error).message}` });
      return;
    }
    const model = cfg ? `${PI_LOCAL_PROVIDER}/${bareModel}` : bareModel;
    const args = piArgs({
      model,
      permission: opts.permission,
      sessionId: opts.sessionId,
      resumeSessionId: opts.resumeSessionId,
      sessionDir: piSessionDir(),
    });

    const env = agentSpawnEnv(process.env);
    if (cfg) env.PI_CODING_AGENT_DIR = cfg.agentDir;
    // Pi phones home for a version check and package updates on startup. A lane is not the place for
    // it: it adds latency to every session and makes an offline box look like a broken transport.
    env.PI_OFFLINE = "1";
    env.PI_SKIP_VERSION_CHECK = "1";
    env.PI_TELEMETRY = "0";

    const bin = process.env.PI_CLI_PATH || piProfile.bin;
    const child = spawn(bin, args, {
      shell: true,
      cwd: opts.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // OFF on win32 (no console window, and `taskkill /T` walks the process table instead); ON
      // everywhere else, where it makes this shell its own process-group leader. See kill-tree.ts.
      detached: detachForKillTree(),
    });

    const decoder = new StringDecoder("utf8");
    const onEvent = opts.onEvent;
    const parser = createPiParser((e) => onEvent?.(e), { cwd: opts.cwd, maxFrameChars: MAX_STDOUT });
    const startedAt = Date.now();
    let err = "";
    let settled = false;
    const cleanup = (): void => {
      if (cfg) {
        try {
          rmSync(cfg.dir, { recursive: true, force: true });
        } catch {
          // A temp directory that outlives its session is litter, never a failed run.
        }
      }
    };
    const settle = (r: AgentRunResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(r);
    };

    // KILLING IS NOT THE MECHANISM; SETTLING IS — the same discipline as the Claude door, and for the
    // same reason: with `shell: true` a grandchild can hold the stdio pipes open so `close` never
    // arrives, and the caller's await must resolve on the timer whatever the process does afterwards.
    const timer = setTimeout(() => {
      child.kill();
      void killProcessTree(child.pid).catch(() => null);
      settle({ ok: false, summary: `Agent session exceeded ${Math.round(limitMs / 60_000)} min and was stopped.` });
    }, limitMs);

    const onAbort = (): void => {
      clearTimeout(timer);
      child.kill();
      void killProcessTree(child.pid).then(
        (k) => settle({ ok: false, summary: `Agent session stopped by the operator — ${k.note}.` }),
        () => settle({ ok: false, summary: "Agent session stopped by the operator — agent process termination unconfirmed." }),
      );
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const disarm = (): void => opts.signal?.removeEventListener("abort", onAbort);

    child.stdout.on("data", (d: Buffer | string) => {
      parser.push(typeof d === "string" ? d : decoder.write(d));
    });
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < MAX_STDERR) err += d.toString("utf8").slice(0, MAX_STDERR - err.length);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      disarm();
      settle({ ok: false, summary: `Could not start the pi CLI: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      disarm();
      parser.push(decoder.end());
      parser.end();
      // STDERR IS SANITIZED BEFORE IT CAN REACH A STORED TEXT (agent-stderr.ts): a failing hook's
      // echoed command line — token included — is exactly what the live check found in it.
      const stderr = sanitizeAgentStderr(err);
      // THE WALL CLOCK IS OURS TO MEASURE. Pi reports no session duration at all, and the span between
      // its message timestamps excludes the ~5.9 s of process startup that a lane's clock is spending.
      const envelope = parser.envelope({
        fallbackModel: bareModel,
        exitCode: code,
        stderr,
        durationMs: Date.now() - startedAt,
      });
      settle(envelope.ok ? envelope : { ...envelope, errorText: parser.errorText() ?? (stderr || null) });
    });

    child.stdin.write(opts.prompt);
    child.stdin.end();
  });
}
