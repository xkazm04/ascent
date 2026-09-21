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
import type { TransportProfile, TransportTiming } from "@/lib/local/transport/profile";
import type { LocalEndpoint, TransportRunOptions } from "@/lib/local/transport/run";

/** Mirrors the Claude runner's caps, so one stdout line and the stderr copy are bounded identically. */
const MAX_STDOUT = 4 * 1024 * 1024;
const MAX_STDERR = 16 * 1024;

/** The provider name Pi is handed for an Ascent-armed local endpoint. A fixed, shell-safe token: it
 *  is written into a generated models.json and then referenced on argv as `<provider>/<model>`. */
export const PI_LOCAL_PROVIDER = "ascent-local";

/**
 * THE PI BAND — chosen against the same local token rate the Claude local band was chosen against,
 * then adjusted by what a Pi session MEASURABLY costs in overhead.
 *
 * MEASURED on 2026-09-21 (pi 0.86.1, provider `ascent-local` → Ollama 0.32.15, qwen3.8:27b Q4_K_M,
 * 64k declared context), four real sessions in a scratch git repo:
 *
 *   | session                                   | turns | in tok | out tok | model span | wall  |
 *   | write one file (cold model load)          |   2   |  3 522 |     132 |   23.2 s   |   —   |
 *   | read + bash + edit                        |   4   |  7 620 |     351 |    4.0 s   |   —   |
 *   | write one file (warm, generated config)    |   1   |    —   |     —   |     —      | 3.7 s |
 *   | read + edit + write + bash (the fixture)  |   4   |  7 815 |     388 |    8.0 s   | 13.9 s |
 *
 * TWO THINGS THAT ARE MEASUREMENTS and belong on the record:
 *   • PI'S OWN STARTUP IS ~5.9 s (13.9 s wall minus 8.0 s of model time on the fixture run). That is
 *     Node plus Pi's boot, per session, before a token is generated — a fixed tax the quiet band has
 *     to sit above or the theater reports every session as quiet while it is starting.
 *   • A COLD MODEL LOAD COST 23 s on the first session and 4–8 s on every warm one. The first lane of
 *     a drive is therefore not representative of the rest, which is a thing the bake-off's own
 *     comparison must not read as a transport difference.
 *
 * WHAT IS CHOSEN, and why not simply Claude's local band:
 *   • `agentMs` 90 min — deliberately IDENTICAL to `claudeLocalTiming.agentMs`. The two arms share a
 *     GPU and a model; giving Pi a different ceiling would make "which arm finished?" partly a
 *     question about which clock it was judged on. A bake-off with two ceilings measures the
 *     ceilings.
 *   • `planMs` 30 min — same reasoning, same number as the local Claude band.
 *   • `quietMs` 5 min — same number, and the local reason still holds here plus Pi's own: a 5.9 s
 *     startup and a 2 000-token tool-call block emitted at ~11.5 tok/s are both silence that is not
 *     trouble.
 *
 * No Pi lane has been run to completion. When one has, these become measurements and this comment is
 * rewritten to say so.
 */
export const piLocalTiming: TransportTiming = {
  agentMs: 5_400_000,
  planMs: 1_800_000,
  quietMs: 300_000,
};

/** The date, tool version and method every cell below shares — one place, so a re-verification pass
 *  is one edit rather than five that can disagree. */
const VERIFIED_AT = "2026-09-21";
const VERIFIED_VERSION = "0.86.1";

/**
 * PI'S CAPABILITY ROW — every cell smoked as a WHOLE INVOCATION on this machine on 2026-09-21 against
 * `pi --version` = 0.86.1, with the exact argv recorded in `invocation`.
 *
 * Every run fed the prompt on stdin, pointed `PI_CODING_AGENT_DIR` at a generated config directory,
 * and ran inside a scratch git repo that is not this one. Not one cell here is read from Pi's `--help`
 * output: the flags exist, but a flag that exists is not a behaviour, and this matrix's whole purpose
 * is to stop that substitution from being made silently.
 */
export const piProfile: TransportProfile = {
  id: "pi",
  label: "Pi",
  bin: "pi",
  timing: piLocalTiming,
  // Pi reports no dollar cost for a local model, and an absent price is NULL, never 0. It does emit
  // `cost: {input: 0, output: 0, total: 0}` — but that zero is the price list in models.json, a
  // CONFIGURED CONSTANT rather than a measurement, so `pi-normalize.ts` discards it and the caller
  // writes `costSource: "none"`.
  zeroCost: true,
  caps: {
    streamJson: {
      // Confirmed by RECEIVING the stream, not by the flag being accepted: the run emitted a
      // `{"type":"session",…}` header, `turn_start` / `message_start` / `message_update` /
      // `tool_execution_start` / `tool_execution_end` / `message_end` / `turn_end` / `agent_end` /
      // `agent_settled` lines, one JSON object per line. Pi's flag is `--mode json`, not an
      // `--output-format`, and it needs no `--verbose` companion.
      value: true,
      verifiedAt: VERIFIED_AT,
      version: VERIFIED_VERSION,
      method: "live-run",
      invocation: "pi -p --mode json --model ascent-local/qwen3.8:27b -t read,bash,edit,write --thinking off",
    },
    editStance: {
      // THE STANCE WAS ADOPTED, not merely parsed, and it was checked on both sides of the seam: the
      // session's own system message listed exactly `read`, `bash`, `edit`, `write`, and the session
      // then really read README.md, edited it with the `edit` tool, wrote notes.txt and ran `ls -1`
      // — four `tool_execution_end`s with `isError: false` and the files changed on disk.
      //
      // PI HAS NO `--permission-mode`. There is no acceptEdits equivalent: in `-p` mode the tools it
      // is given are the tools it uses, with no approval step. The allowlist IS the stance, so it is
      // passed EXPLICITLY rather than relying on Pi's default of "all tools" — a default that a later
      // Pi could widen without this repo noticing.
      value: "-t read,bash,edit,write",
      verifiedAt: VERIFIED_AT,
      version: VERIFIED_VERSION,
      method: "live-run",
      invocation: "pi -p --mode json --model ascent-local/qwen3.8:27b -t read,bash,edit,write --thinking off",
    },
    planStance: {
      // Same proof, the other stance. With `-t read` the session's system message carried ONLY
      // `- read: Read file contents`; the session answered a question about README.md's first line
      // using the `read` tool, and `git status --porcelain` hashed identically before and after.
      //
      // A RECORDED DEVIATION FROM CLAUDE'S PLAN STANCE, not an equivalence. Claude plans with
      // `Read,Grep,Glob`; Pi has no grep or glob tool — searching is done through `bash`, which is not
      // read-only (`rm` is a bash command). So `-t read` is strictly read-only but a WEAKER planning
      // surface than Claude's, and `-t read,bash` would be a stronger surface that is no longer a
      // read-only stance. The narrow one is chosen because the lane proves the worktree is untouched
      // afterwards (lane-plan.ts) and a stance that can delete files makes that proof a tripwire
      // rather than a guarantee. If Pi plans measurably worse than Claude, THIS is the first
      // confound to check — it is a tool-surface difference, not a model difference.
      value: "-t read",
      verifiedAt: VERIFIED_AT,
      version: VERIFIED_VERSION,
      method: "live-run",
      invocation: "pi -p --mode json --model ascent-local/qwen3.8:27b -t read --thinking off",
    },
    resume: {
      // Verified as CONTINUITY, not as flag acceptance — the same bar the Claude row was held to. A
      // first session (`--session-id <uuid> --session-dir <dir>`) was told to write ALPHA into a file;
      // a second run with `--session <that uuid>` was asked what word it had written, told not to use
      // any tools, and answered "ALPHA" under the same session id. A run that merely accepted the flag
      // and started fresh could not have answered.
      //
      // NOTE THE TWO DIFFERENT FLAGS: `--session-id <uuid>` CREATES a session with that id (Pi warns
      // "creating a new session with that id" and proceeds), `--session <uuid>` RESUMES one. Pi's
      // `--resume` is the interactive picker, not Claude's `--resume <uuid>`, and passing it here
      // would hang a headless session on a TUI.
      value: true,
      verifiedAt: VERIFIED_AT,
      version: VERIFIED_VERSION,
      method: "live-run",
      invocation: "pi -p --mode json --model ascent-local/qwen3.8:27b --session <uuid> --session-dir <dir>",
    },
    promptOnStdin: {
      // Every invocation above piped the prompt to stdin and closed it; the model answered it, and the
      // prompt never entered the argument vector, because a lane brief contains flag-shaped text. Pi
      // documents this as "in print mode, pi also reads piped stdin and merges it into the initial
      // prompt" — and the merge is why the argv carries no positional message at all here: a session
      // given both would run the concatenation of the two.
      value: true,
      verifiedAt: VERIFIED_AT,
      version: VERIFIED_VERSION,
      method: "live-run",
      invocation: "pi -p --mode json --model ascent-local/qwen3.8:27b -t read,bash,edit,write --thinking off",
    },
  },
};

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
