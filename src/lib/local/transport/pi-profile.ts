// THE PURE HALF OF THE PI TRANSPORT — its capability row, its timing band and the two tokens the
// adapter and the cockpit both need to name it.
//
// SPLIT OUT OF `pi.ts` FOR ONE REASON: a browser component renders this matrix. `pi.ts` imports
// `node:child_process`, `node:fs`, `node:os`, `node:path` and `node:string_decoder` at module scope
// because it SPAWNS things, and `profile.ts` imports `pi.ts` for this constant — so the registry
// could not be read from the client without dragging the spawn side into the bundle. The cockpit's
// answer was a second, hand-maintained label map, which is the "two lists" failure `arm.ts` exists to
// refuse; this file is the fix, and the duplicate map is gone.
//
// DEPENDENCY-FREE, and it has to stay that way: no `process`, no `node:*`, no import of a module that
// has them. `npm run build` is the gate that catches a regression here, not `tsc`.

import type { TransportProfile, TransportTiming } from "@/lib/local/transport/profile";

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
