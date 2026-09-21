// THE CLAUDE TRANSPORT — the argv and the environment of one headless `claude -p` session, as PURE
// DATA-IN/DATA-OUT functions, plus the dated capability row that says what this binary actually does.
//
// WHY THE BUILDERS ARE PURE AND LIVE HERE RATHER THAN INSIDE THE SPAWN. `agent.ts` composed its argv
// inline, so "what exactly do we run?" was a question only a subprocess could answer. The one
// regression that matters for this whole feature — that adding a second transport does not silently
// change what the FIRST one runs — is then untestable except by observation. Hoisted here, the argv
// is a value a table test can compare against a literal, and `agent.ts` keeps being a spawn wrapper.
//
// DEPENDENCY-FREE (no `process`, no `node:*`), deliberately and for the same reason `arm.ts` and
// `run-limits.ts` are: `profile.ts` re-exports this row to the cockpit's capability surface, and a
// module that reached for `process.env` here would drag the spawn side across the client boundary.
// The environment is taken as an argument (`base`) and a COPY is returned; nothing here writes
// `process.env`. That is not tidiness — the same server must be able to run a subscription Claude
// lane and a local-endpoint lane in the same minute, and a process-wide write makes "which endpoint
// did this lane use?" a question about scheduling order.

import type { TransportProfile, TransportTiming } from "@/lib/local/transport/profile";
import type { LocalEndpoint } from "@/lib/local/transport/run";
import { AGENT_TIMEOUT_DEFAULT_MS } from "@/lib/local/run-limits";

/** A CLI session id: a UUID, and nothing a shell could re-parse into a second argument. Verbatim the
 *  regex `agent.ts` has always applied at its own spawn door — one copy, now, rather than two. */
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The model token shape both the arm validator and this spawn door accept. Same regex as
 *  `arm.ts`'s `MODEL_TOKEN`, kept here because `shell: true` on Windows re-parses argv. */
export const CLAUDE_MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/**
 * THE HOSTED BAND — today's three constants, unchanged, written down as one transport's timing.
 *
 * `agentMs` is `AGENT_TIMEOUT_DEFAULT_MS` (20 min) and stays the DEFAULT rather than the answer:
 * `agentTimeoutMs()` still applies `ASCENT_AUTOPILOT_TIMEOUT_MS` and the min/cap band over it, so no
 * current deployment changes behaviour by this profile existing. `planMs` is the value
 * `runner-types.ts`'s `PLAN_TIMEOUT_MS` has always held, and `quietMs` its `PHASE_QUIET_MS`.
 */
export const claudeHostedTiming: TransportTiming = {
  agentMs: AGENT_TIMEOUT_DEFAULT_MS,
  planMs: 480_000,
  quietMs: 90_000,
};

/**
 * THE LOCAL-ENDPOINT BAND — the same client, a tenth of the tokens per second.
 *
 * MEASURED on this machine on 2026-09-21 (qwen3.8:27b Q4_K_M, Ollama 0.32.15, 22.4 GB of 27.1 GB
 * resident at 64k context): 545 tokens/s prefill and **11.5 tokens/s generation**. A hosted frontier
 * model answers an order of magnitude faster, which is the whole reason a shared ceiling forced a
 * choice between failing every local lane on the clock and deleting the tripwire that catches a
 * genuinely stuck Claude lane.
 *
 * WHAT IS MEASURED AND WHAT IS CHOSEN, stated separately on purpose:
 *
 *   • MEASURED: 11.5 gen tok/s vs a hosted model roughly 10× that. Nothing below is a measurement of
 *     how long a lane takes; no local lane has been run to completion on this machine yet.
 *   • CHOSEN: `agentMs` 90 min — 4.5× the hosted band, DELIBERATELY BELOW the ~10× the token rate
 *     implies. The rate argues for 200 minutes; an overnight drive that spends three and a half hours
 *     discovering one wedged session is a worse answer than a session cut at 90 minutes with the
 *     ceiling named on the row. 90 min is also `AGENT_TIMEOUT_CAP_MS`, so the profile band and the
 *     hard cap on a wire override agree rather than being two different opinions.
 *   • CHOSEN: `planMs` 30 min — 3.75× the hosted 8 min. A planning session reads and answers; it is
 *     prefill-dominated (545 tok/s), so it scales far better than generation does.
 *   • CHOSEN: `quietMs` 5 min — 3.3× the hosted 90 s. This is stream SILENCE, and the local failure
 *     it must not misreport is a long tool-call JSON block emitted at 11.5 tok/s: a 2k-token call
 *     takes ~3 minutes to appear, which reads as "quiet" under the hosted band and is in fact normal.
 *
 * When a local lane has actually been run to completion, these become measurements and this comment
 * should be rewritten to say so. Until then they are judgments with their basis attached.
 */
/**
 * THE CEILING FOR ONE REQUEST against a local endpoint — deliberately NOT the session ceiling.
 *
 * A session may legitimately run for the whole local band; a single HTTP request to an inference
 * server may not. Ten minutes is far more than one slow turn costs (a closing turn against a 27B at
 * 4-bit with ~15k tokens of context measured at 6 seconds on 2026-09-21, and the slowest observed
 * generation rate here was 8.4 tok/s), and far less than the 90-minute session band that let a dead
 * request keep a lane silent until the harness killed it.
 */
export const LOCAL_REQUEST_TIMEOUT_MS = 600_000;

export const claudeLocalTiming: TransportTiming = {
  agentMs: 5_400_000,
  planMs: 1_800_000,
  quietMs: 300_000,
};

/** The date, tool version and method every cell below shares — one place, so a re-verification pass
 *  is one edit rather than five that can disagree. */
const VERIFIED_AT = "2026-09-21";
const VERIFIED_VERSION = "2.1.278";

/**
 * THE CLAUDE CAPABILITY ROW — every cell smoked as a WHOLE INVOCATION on this machine on 2026-09-21
 * against `claude --version` = 2.1.278, with the exact argv recorded in `invocation`.
 *
 * The prompt was fed on stdin in every case and the stripped env (`ANTHROPIC_API_KEY`, `CLAUDECODE`,
 * `CLAUDE_CODE_ENTRYPOINT` removed — see `agentSpawnEnv`) was used, because a nested `claude` that
 * inherits those markers produces nothing, silently. A smoke run under the ambient env would have
 * verified a process nobody will ever launch.
 */
export const claudeProfile: TransportProfile = {
  id: "claude",
  label: "Claude Code",
  bin: "claude",
  timing: claudeHostedTiming,
  // Claude on a subscription seat reports a REAL `total_cost_usd` for a real model, so its figures
  // are banked. (Pointed at a local endpoint the same binary reports a price computed from a rate
  // card for a model it never called — that is what `zeroCost` means on the local arms, and it is
  // handled by the arm's endpoint, not by flipping this row.)
  zeroCost: false,
  caps: {
    streamJson: {
      // Confirmed by RECEIVING the stream, not by the flag being accepted: the run emitted
      // `{"type":"system","subtype":"init",…}`, an `assistant` line and a final result line, one JSON
      // object per line. `--verbose` is required alongside it under `-p`.
      value: true,
      verifiedAt: VERIFIED_AT,
      version: VERIFIED_VERSION,
      method: "live-run",
      invocation: "claude -p --output-format stream-json --verbose --permission-mode acceptEdits --model sonnet",
    },
    editStance: {
      // The init line reported `"permissionMode":"acceptEdits"` — the stance was ADOPTED, which is a
      // stronger claim than "the flag parsed".
      value: "--permission-mode acceptEdits",
      verifiedAt: VERIFIED_AT,
      version: VERIFIED_VERSION,
      method: "live-run",
      invocation: "claude -p --output-format stream-json --verbose --permission-mode acceptEdits --model sonnet",
    },
    planStance: {
      // Same proof, the other stance: the init line reported `"permissionMode":"plan"` with the
      // allowlist token present. The allowlist is ONE argv token with no spaces because `shell: true`
      // re-parses argv on Windows.
      value: "--permission-mode plan --allowedTools Read,Grep,Glob",
      verifiedAt: VERIFIED_AT,
      version: VERIFIED_VERSION,
      method: "live-run",
      invocation:
        "claude -p --output-format stream-json --verbose --permission-mode plan --allowedTools Read,Grep,Glob --model sonnet --session-id <uuid>",
    },
    resume: {
      // Verified as CONTINUITY, not as flag acceptance. A first session (`--session-id <uuid>`) was
      // asked to reply "OK"; a second run with `--resume <that uuid>` was asked what word it had just
      // replied with and answered "OK" under the same `session_id`. A run that merely accepted the
      // flag and started fresh would have failed that question.
      value: true,
      verifiedAt: VERIFIED_AT,
      version: VERIFIED_VERSION,
      method: "live-run",
      invocation:
        "claude -p --output-format stream-json --verbose --permission-mode acceptEdits --model sonnet --resume <uuid>",
    },
    promptOnStdin: {
      // Every invocation above wrote the prompt to stdin and closed it; the model answered it. The
      // prompt never enters the argument vector, because a lane brief contains flag-shaped text.
      value: true,
      verifiedAt: VERIFIED_AT,
      version: VERIFIED_VERSION,
      method: "live-run",
      invocation: "claude -p --output-format stream-json --verbose --permission-mode acceptEdits --model sonnet",
    },
  },
};

/** What `claudeArgs` needs to know. A subset of `ClaudeAgentOptions`, restated so this module owes
 *  nothing to the spawn wrapper and can be table-tested on its own. */
export interface ClaudeArgvInput {
  model: string;
  effort?: string | null;
  permission?: "edit" | "plan";
  sessionId?: string | null;
  resumeSessionId?: string | null;
}

/**
 * THE ARGUMENT VECTOR, byte-for-byte what `agent.ts` has always built.
 *
 * This function is the regression that matters most in the whole transport change: every lane that
 * exists today goes through it, and a reordered or dropped token would be a behaviour change nobody
 * asked for. It is pinned against a LITERAL array in `claude.test.ts` rather than against a
 * re-derivation of itself, which would pass no matter what either side did.
 *
 * The endpoint does NOT appear here. A local arm differs only in its ENVIRONMENT — same binary, same
 * flags — which is the property that makes "does the local model do this lane worse?" a question
 * about the model rather than about two different invocations.
 */
export function claudeArgs(input: ClaudeArgvInput): string[] {
  // STREAMED: `stream-json` needs `--verbose` under `-p`. The final `result` line carries the same
  // fields the one-shot `json` object did, so the envelope reads identically.
  const output = ["--output-format", "stream-json", "--verbose"];
  // THE PLANNING SESSION is read-only by tool policy: plan mode plus an explicit allowlist. The list
  // is ONE argv token with no spaces, because `shell: true` re-parses argv on Windows.
  const args =
    input.permission === "plan"
      ? ["-p", ...output, "--permission-mode", "plan", "--allowedTools", "Read,Grep,Glob", "--model", input.model]
      : ["-p", ...output, "--permission-mode", "acceptEdits", "--model", input.model];
  // `--effort` is appended ONLY when a level was chosen, so a `claude` build that has never heard of
  // the flag runs exactly the argv it always did.
  if (input.effort) args.push("--effort", input.effort);
  // Session ids reach the same re-parsing shell as the model, so they get the same treatment: a UUID
  // or nothing. An invalid id DROPS the flag rather than failing the session — a resume that cannot
  // be honoured degrades to a fresh session, which is what every lane before resuming existed ran.
  if (input.resumeSessionId && SESSION_ID.test(input.resumeSessionId)) args.push("--resume", input.resumeSessionId);
  else if (input.sessionId && SESSION_ID.test(input.sessionId)) args.push("--session-id", input.sessionId);
  return args;
}

/**
 * THE ENVIRONMENT ONE SESSION IS SPAWNED WITH: the server's own, minus what must never reach it, plus
 * the local endpoint block when this arm has one.
 *
 * THE STRIP IS UNCONDITIONAL AND COMES FIRST, and it is only ever extended:
 *
 *   • `ANTHROPIC_API_KEY` — subscription auth, like every local CLI call. On a LOCAL arm it is worse
 *     than unnecessary: a stray key alongside `ANTHROPIC_AUTH_TOKEN` is how a run that was supposed
 *     to prove a local model quietly bills a hosted one.
 *   • `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` — the markers a Claude Code session sets in the
 *     environment of everything it starts. A nested `claude` that inherits them produces NOTHING,
 *     silently (live.md L2-F-02).
 *
 * THE LOCAL BLOCK, and why each line is load-bearing rather than a preference:
 *
 *   • `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` — where to talk and what to send as auth. Local
 *     servers ignore the token's VALUE but reject its absence, so an absent one is a connection
 *     failure that reads like a model failure. Default `"ollama"`.
 *   • `ANTHROPIC_DEFAULT_SONNET_MODEL` / `_HAIKU_MODEL` / `_OPUS_MODEL` — ALL THREE, pinned to the one
 *     model the server actually has. Claude Code routes some background work (titles, summaries,
 *     cheap classification) to a Haiku id regardless of `--model`, and an unpinned one asks the local
 *     server for a model it has never heard of. The failure surfaces mid-session as an error from a
 *     call the operator never made.
 *   • `CLAUDE_CODE_MAX_CONTEXT_TOKENS` — a client that does not recognise a model id assumes the
 *     largest profile it knows and sends the maximal request. Declaring the real window is how the
 *     substitute stops being blamed for the client's assumption. See `LocalEndpoint.contextTokens`.
 *   • `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` — beta headers a local server does not implement are
 *     answered with an error, not ignored.
 *   • `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` — no background calls to an endpoint that is not
 *     Anthropic's, which is both a privacy property and one less way for a local arm to stall.
 *   • `API_TIMEOUT_MS` — the CLIENT's own ceiling for ONE REQUEST, which is not the session's.
 *     Left at its hosted default, the client gives up on a local response that is merely slow. Set
 *     to the SESSION ceiling — which is what this did until it was measured — a single failing
 *     request waits the whole session budget before it is allowed to fail, and the session looks
 *     hung when it is in fact retrying something that will never answer.
 *
 *     Measured 2026-09-21: an agent session completed its work (the file was written, correctly),
 *     then its follow-up request errored twice (`api_retry` in the stream) and the session sat
 *     silent until the harness killed it 25 minutes later, having emitted nothing further. The
 *     ceiling was 90 minutes because that is the local session band. A request ceiling has to be
 *     generous enough for one slow local turn and small enough that a dead request dies while
 *     someone is still watching — {@link LOCAL_REQUEST_TIMEOUT_MS}.
 *
 * Pure: a copy is returned and the input is never touched, so the whole block is a table test rather
 * than a spawn.
 */
export function claudeSpawnEnv(
  base: NodeJS.ProcessEnv,
  arm?: { endpoint?: LocalEndpoint | null; agentMs?: number } | null,
): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const endpoint = arm?.endpoint;
  if (!endpoint) return env;
  env.ANTHROPIC_BASE_URL = endpoint.baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = endpoint.token ?? "ollama";
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = endpoint.model;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = endpoint.model;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = endpoint.model;
  env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(endpoint.contextTokens);
  env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  env.API_TIMEOUT_MS = String(LOCAL_REQUEST_TIMEOUT_MS);
  return env;
}

/** The env keys the local block writes — exported so a test can assert the block is EXACTLY this set
 *  and no adapter can quietly grow a sixth environment variable nobody researched. */
export const CLAUDE_LOCAL_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
  "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "API_TIMEOUT_MS",
] as const;

/** The env keys that are stripped on EVERY spawn, local or not. Exported for the same reason: the
 *  strip is only ever extended, and a test is what makes "only ever" true. */
export const CLAUDE_STRIPPED_ENV_KEYS = ["ANTHROPIC_API_KEY", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"] as const;
