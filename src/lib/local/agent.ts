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
import { StringDecoder } from "node:string_decoder";
import { cliProviderAllowed } from "@/lib/llm/config";
import { envBool } from "@/lib/env";
import { normalizeAgentEffort, normalizeAgentModel, type AgentConfig } from "@/lib/local/agent-options";
import type { TransportId } from "@/lib/local/arm";
import {
  CLAUDE_MODEL_TOKEN,
  claudeArgs,
  claudeProfile,
  claudeSpawnEnv,
} from "@/lib/local/transport/claude";
import type { LocalEndpoint } from "@/lib/local/transport/run";
// THE SESSION CEILING NOW LIVES BESIDE THE LANE CEILING IT FEEDS (`laneDeadlineMs`). Re-exported
// unchanged so every existing caller — the route's stop horizon, this module's own spawn — keeps
// importing it from here, and so the two numbers can never drift apart into two answers.
import { agentTimeoutMs } from "@/lib/local/lane-watchdog";
import { agentErrorText, parseAgentEnvelope, type AgentEnvelope } from "@/lib/local/agent-envelope";
import { createStreamParser } from "@/lib/local/agent-stream";
import { detachForKillTree, killProcessTree } from "@/lib/local/kill-tree";
import { sanitizeAgentStderr } from "@/lib/local/agent-stderr";
import type { AgentStreamEvent } from "@/lib/local/runner-types";

export { agentTimeoutMs };

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

/**
 * The environment a spawned agent session gets: the server's own, minus what must never reach it.
 *
 *   • `ANTHROPIC_API_KEY` — subscription auth, like every local CLI call.
 *   • `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` — the markers a Claude Code session sets in the
 *     environment of everything it starts. A self-hosted Ascent launched from inside a Claude Code
 *     session hands them to every agent it spawns, and a nested `claude` that inherits them produces
 *     NOTHING, silently (live.md L2-F-02). Stripped here, at the one spawn site, so no launch path can
 *     reintroduce it.
 *
 * Pure (a copy is returned; the input is not touched), so the strip is a table test, not a spawn.
 */
export function agentSpawnEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // ONE IMPLEMENTATION, in the transport that owns the spawn door. Kept exported here, with its exact
  // signature and behaviour, because the strip is a property of THIS module's contract and every
  // existing caller and table test imports it from here.
  return claudeSpawnEnv(base);
}

// mirror claude-cli.ts's runaway-subprocess caps. Since streaming it bounds ONE stdout line (and the
// verbatim copy kept for a non-stream output), not the whole session: a long session's stream is parsed
// and let go line by line, and only the final `result` line is retained.
const MAX_STDOUT = 4 * 1024 * 1024;
const MAX_STDERR = 16 * 1024;

/**
 * What one session did AND what it cost.
 *
 * `{ ok, summary }` keep their exact meaning, so every existing caller compiles and behaves
 * unchanged; everything else is an optional MEASUREMENT that is `null` when the CLI reported nothing
 * (never 0 — see agent-envelope.ts). The lane records these on its row, and they are the only source
 * of a lane's cost: an OTLP `AgentSession` figure is a different population by a different path and
 * is never added to them.
 */
export interface AgentRunResult extends Partial<Omit<AgentEnvelope, "ok" | "summary">> {
  ok: boolean;
  /** The session's final text (claude -p json envelope `.result`), or the failure reason. */
  summary: string;
  /**
   * WHICH CEILING ENDED THIS SESSION, AND ON WHICH ARM. Absent on every session that ended on its
   * own — success or failure alike.
   *
   * EXACTLY ONE FIELD WAS ADDED, and this is the argument for it. Before transports, "a lane timed
   * out" was a complete statement: there was one clock, so the sentence in `summary` carried
   * everything a reader could want. With two arms racing the same batch under DIFFERENT bands, the
   * only finding that matters is comparative — "the local arm ran out of ITS 90 minutes while the
   * Claude arm finished inside its 20" — and that cannot be recovered from a string later: the ceiling
   * that fired is not stored anywhere else on the row, and the transport is on the ARM, which a
   * timing comparison would have to join back through the run. A parser over `summary` would be the
   * alternative, and a comparison whose denominator comes from a regex over prose is a comparison
   * nobody should trust. `null`/absent rather than a zeroed record, per the absent-value convention.
   */
  ceiling?: CeilingHit | null;
  /** THE CLI'S OWN ERROR TEXT on a failed session, verbatim and bounded — what the runner's
   *  session-limit breaker classifies ("You've hit your session limit · resets 3pm"). Absent on
   *  success, and absent on a runner that has not been taught to carry it. */
  errorText?: string | null;
}

/** Which ceiling cut a session short, and which arm it belonged to. */
export interface CeilingHit {
  /** `session` — this session's own timer fired. `lane` — something OUTSIDE cut it: the lane
   *  watchdog's deadline, or an operator's stop. The two are different findings: the first says this
   *  arm is slow, the second says the cycle around it ran out. */
  kind: "session" | "lane";
  /** The transport that was running. */
  transport: TransportId;
  /** True when the arm was pointed at a local inference endpoint — the fact that explains the band. */
  local: boolean;
  /** The ceiling's own value in ms, when this side knows it. `null` on a `lane` cut: the number that
   *  fired belongs to the watchdog, and restating a figure this module did not hold would be an
   *  invention in a column meant for measurements. */
  limitMs: number | null;
}

/**
 * How one session is armed. Everything past `prompt` is optional and ABSENT means exactly what every
 * session before the field existed did — the argv below only grows when a caller asks.
 */
export interface ClaudeAgentOptions {
  cwd: string;
  prompt: string;
  model?: string;
  effort?: string | null;
  /** Per-run session ceiling, already normalized by the route. Omitted/null keeps the deployment's
   *  own `ASCENT_AUTOPILOT_TIMEOUT_MS`, which is what every session before this parameter used. */
  timeoutMs?: number | null;
  /** THE STOP'S REACH INTO THE PROCESS. When this aborts — the lane's watchdog fires it on a run stop
   *  and on the lane deadline alike (`LaneWatchdog.signal`) — the spawned process TREE is killed and
   *  this call settles. Absent means nobody outside is watching, which is what every caller before
   *  the parameter existed did: the session then ends only on its own timer. */
  signal?: AbortSignal;
  /** `edit` (the default — `--permission-mode acceptEdits`, the editing session every lane has always
   *  run) or `plan`: `--permission-mode plan` plus a Read/Grep/Glob allowlist, for the read-only
   *  planning session. BOTH ARE TOOL POLICY, NOT A SANDBOX — the caller proves the worktree is
   *  untouched afterwards (see lane-plan.ts). */
  permission?: "edit" | "plan";
  /** A session id the ENGINE mints (`--session-id <uuid>`), so it can resume the session later. */
  sessionId?: string | null;
  /** Continue an earlier session (`--resume <uuid>`) — the minor execution resumes its planning
   *  session, whose context already holds the files it read. */
  resumeSessionId?: string | null;
  /** Each parsed stream event, as it happens — the lane's live activity tail. Called synchronously
   *  from the stdout handler; a sink that throws is the sink's problem and never ends the session. */
  onEvent?: (e: AgentStreamEvent) => void;
}

/**
 * The sentence a stopped session ends with. The abort's own reason wins when it carries one — the
 * lane's watchdog aborts with a `LaneDeadlineError` whose message already names the stage that was
 * in flight, and repeating that verbatim is more useful than a generic line. A bare `AbortController`
 * (a test, a future caller) gets the plain sentence. Returned WITHOUT a final stop, so the kill's
 * own note can be appended to the same sentence.
 */
function abortSummary(signal: AbortSignal | undefined): string {
  const reason: unknown = signal?.reason;
  // A bare `controller.abort()` fills `reason` with the platform's own AbortError ("This operation
  // was aborted"), which says nothing an operator wants to read. Only a reason someone CHOSE counts.
  const chosen = reason instanceof Error && reason.name !== "AbortError" ? reason.message : null;
  const detail = chosen ?? (typeof reason === "string" ? reason.trim() : "");
  return detail ? `Agent session stopped: ${detail}` : "Agent session stopped by the operator";
}

/**
 * The clause a ceiling sentence carries so a reader knows WHICH ARM hit it.
 *
 * `null` for a plain subscription Claude session, which is every lane that exists today — so the
 * sentence those lanes produce stays byte-identical, and `runner-breakers.ts` keeps classifying the
 * exact strings it was written against. A local arm is the case where the attribution is new
 * information, and it is the only case that adds words.
 */
function armClause(transport: TransportId, endpoint?: LocalEndpoint | null): string {
  if (transport === "claude" && !endpoint) return "";
  return endpoint ? ` (${transport} → ${endpoint.model})` : ` (${transport})`;
}

/** What one session is armed with BEYOND the caller's options: which transport, and the local
 *  endpoint it should talk to. `runAgentVia` is the public door onto it. */
export interface AgentArm {
  transport: TransportId;
  endpoint?: LocalEndpoint | null;
}

/** Run one editing session in `cwd`. Resolves (never rejects) — the autopilot treats every outcome
 *  as cycle data: a failed session ends the cycle with its reason in the log, not a stack.
 *
 *  UNCHANGED, deliberately: same signature, same argv, same environment, same sentences. It is now
 *  the `claude` transport's implementation — `runAgentVia("claude", opts)` with no endpoint lands
 *  exactly here — and the argv identity is pinned against a literal in `transport/claude.test.ts`. */
export function runClaudeAgent(opts: ClaudeAgentOptions): Promise<AgentRunResult> {
  return runAgentSession(opts, { transport: "claude" });
}

/**
 * THE SPAWN, PARAMETERIZED BY ARM. One body, because the whole point of a bake-off is that the two
 * arms differ in the model behind the socket and in NOTHING ELSE this module controls: same stream
 * parsing, same stderr sanitizing, same kill path, same settle discipline. A second copy of this
 * function for local arms would turn every difference it accumulated into a confound in the very
 * comparison it exists to make.
 */
export function runAgentSession(opts: ClaudeAgentOptions, arm: AgentArm): Promise<AgentRunResult> {
  return new Promise((resolve) => {
    const endpoint = arm.endpoint ?? null;
    const local = endpoint != null;
    const transport = arm.transport;
    const limitMs = agentTimeoutMs(opts.timeoutMs, { transport, local });
    const clause = armClause(transport, endpoint);
    if (opts.signal?.aborted) {
      resolve({ ok: false, summary: `${abortSummary(opts.signal)} — no session was started.` });
      return;
    }
    if (!autopilotEnabled()) {
      resolve({ ok: false, summary: "Autopilot is not enabled — set ASCENT_AUTOPILOT=1 on this deployment." });
      return;
    }
    const model = opts.model || process.env.CLAUDE_MODEL || DEFAULT_AGENT_MODEL;
    // shell:true is required on Windows (claude.cmd), which re-parses argv — so the model must stay
    // a plain token, same validation and reasoning as claude-cli.ts.
    if (!CLAUDE_MODEL_TOKEN.test(model)) {
      resolve({ ok: false, summary: `Invalid model "${model}".` });
      return;
    }
    // Effort is normalized against the SAME closed list the picker offers (agent-options.ts) rather
    // than passed through: it reaches a re-parsing shell exactly as the model does. An unrecognised
    // value drops the flag instead of failing the run — a session that would have worked must not die
    // because a stale caller sent a level this build does not know.
    const effort = normalizeAgentEffort(opts.effort);
    // THE ENV BLOCK IS ON THE SPAWN, never on the process: `process.env` is READ here and a COPY is
    // handed to the child, so a Claude lane and a local lane on the same server in the same minute
    // cannot see each other's endpoint. `API_TIMEOUT_MS` inside the block is pinned to THIS session's
    // ceiling, so the client does not give up on a merely-slow local answer before the session timer
    // is allowed to be the thing that ends it — which would attribute the stop to the wrong ceiling.
    const env = claudeSpawnEnv(process.env, { endpoint, agentMs: limitMs });

    const bin = process.env.CLAUDE_CLI_PATH || claudeProfile.bin;
    // THE ARGUMENT VECTOR IS BUILT IN `transport/claude.ts` and is byte-identical to the one this
    // function composed inline before transports existed — flag order, the effort append, and the
    // resume/session-id precedence included. It is pinned there against a LITERAL array, because
    // "adding a second transport did not change what the first one runs" is the regression the whole
    // fleet would otherwise discover on our behalf.
    const args = claudeArgs({
      model,
      effort,
      ...(opts.permission ? { permission: opts.permission } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
    });
    const child = spawn(bin, args, {
      shell: true,
      cwd: opts.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // OFF on win32 (no console window, and `taskkill /T` walks the process table instead); ON
      // everywhere else, where it makes this shell its own process-group leader so a negative-pid
      // signal reaches the `claude` process it started. See kill-tree.ts.
      detached: detachForKillTree(),
    });

    // THE STREAM, parsed line by line as it arrives — each event into the lane's activity tail. The
    // decoder keeps a multi-byte character split across two chunks whole; the parser swallows a sink
    // that throws, so telemetry can never end the session it is watching.
    const decoder = new StringDecoder("utf8");
    const onEvent = opts.onEvent;
    const parser = createStreamParser((e) => onEvent?.(e), { cwd: opts.cwd, maxFrameChars: MAX_STDOUT });
    let err = "";
    let settled = false;
    const settle = (r: AgentRunResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    // KILLING IS NOT THE MECHANISM; SETTLING IS. `child.kill()` is best-effort — with `shell: true`
    // it signals the shell, and a grandchild that inherited the stdio pipes can keep them open, so
    // `close` may never arrive. The `settle` call is therefore unconditional and NOT inside a close
    // handler: the caller's await resolves on the timer whatever the process does afterwards. (The
    // lane's watchdog races this call as well, so even a broken timer cannot park a lane.)
    const timer = setTimeout(() => {
      child.kill();
      // The tree kill is fire-and-forget HERE on purpose: this path's summary and its timing are
      // exactly what they were before the helper existed, and the settle above the lane must not
      // wait on a `taskkill`. The abort path below is the one that reports what the kill confirmed.
      void killProcessTree(child.pid).catch(() => null);
      settle({
        ok: false,
        summary: `Agent session${clause} exceeded ${Math.round(limitMs / 60_000)} min and was stopped.`,
        ceiling: { kind: "session", transport, local, limitMs },
      });
    }, limitMs);

    // THE STOP REACHING THE PROCESS. The abort resolves the lane's race in the same tick — the lane
    // is already free by the time anything here runs — so this can afford to await the kill and put
    // its honest outcome in the summary the lane logs. It settles exactly once, like every other path.
    const onAbort = (): void => {
      clearTimeout(timer);
      child.kill();
      // A CUT FROM OUTSIDE is the LANE's ceiling, not this session's, so `limitMs` stays null: the
      // number that fired belongs to the watchdog and is already on the lane row.
      const cut: CeilingHit = { kind: "lane", transport, local, limitMs: null };
      void killProcessTree(child.pid).then(
        (k) => settle({ ok: false, summary: `${abortSummary(opts.signal)} — ${k.note}.`, ceiling: cut }),
        () =>
          settle({
            ok: false,
            summary: `${abortSummary(opts.signal)} — agent process termination unconfirmed.`,
            ceiling: cut,
          }),
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
      settle({ ok: false, summary: `Could not start the claude CLI: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      disarm();
      parser.push(decoder.end());
      // THE WHOLE ENVELOPE, not just `.result`. The parse is pure and lives in agent-envelope.ts so
      // it can be table-tested without a subprocess; `{ok, summary}` are byte-for-byte what they
      // were, and the measurements ride alongside them. The text parsed is the stream's final
      // `result` line, or — for output that never was a stream — the stdout verbatim, as before; a
      // stream that ended without a `result` parses "" into today's no-JSON failure sentence.
      const raw = parser.end() ?? parser.raw();
      const errorHint = parser.errorHint();
      // STDERR IS SANITIZED BEFORE IT CAN REACH A STORED TEXT (agent-stderr.ts): a failing user hook's
      // echoed command line — token included — is exactly what the live check found in it.
      const stderr = sanitizeAgentStderr(err);
      const envelope = parseAgentEnvelope(raw, { fallbackModel: model, exitCode: code, stderr, errorHint });
      settle(envelope.ok ? envelope : { ...envelope, errorText: agentErrorText(raw, { stderr, errorHint }) });
    });

    child.stdin.write(opts.prompt);
    child.stdin.end();
  });
}
