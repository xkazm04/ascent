// IS THIS HALF OF AN ARM LOCAL, AND IF SO WHAT DOES IT TALK TO? — the ONE answer in the codebase.
//
// Everything downstream of this file already honoured a `LocalEndpoint`: `claudeSpawnEnv` writes the
// nine-key env block for it, `piModelsJson` writes the provider file for it, `agentTimeoutMs` widens
// the band for it, and the probe checks the server behind it. Nothing RESOLVED one, so every lane the
// loop spawned talked to the subscription seat no matter what it was armed with. This module is that
// missing step, and it is deliberately ONE function: "is this lane local?" answered in two places is
// a question that will be answered two ways.
//
// ── THE RULE, AND WHY IT IS THIS RULE ────────────────────────────────────────────────────────────
//
//   • A `pi` arm is ALWAYS local. Pi has no hosted mode in this deployment — there is no seat behind
//     it to fall back to, so an endpoint is not an option it has.
//   • A `claude` arm is local when its model is NOT one of `AGENT_MODELS` (`agent-options.ts`, the
//     closed Claude alias list). `claude` + `sonnet` is the operator's subscription seat;
//     `claude` + `qwen3.8:27b` is the local endpoint.
//
// The second clause is not a new distinction: it is EXACTLY the one the cockpit's arm picker already
// makes — a Segmented control over the Claude aliases, a free-text model field otherwise. Deriving
// the endpoint from it means the UI and the runtime agree without a second question being asked of
// the operator, and without a third field on the wire that could disagree with the first two.
//
// ── WHY THE ENDPOINT COMES FROM THE SERVER'S ENVIRONMENT ─────────────────────────────────────────
//
// Never from the browser. The cockpit deliberately sends no base URL (`arms/armProbe.ts`): a URL
// typed in a browser would be a second answer to a question the deployment already answers, and the
// thing being measured is the environment the run will actually use. The MODEL, though, is the ARM's
// and never an env default — a run records what it was armed with, and an env-sourced model would
// turn that record into a claim about the day it ran rather than about the arm.

import { AGENT_MODELS } from "@/lib/local/agent-options";
import type { PlanArm, TransportId } from "@/lib/local/arm";
import type { LocalEndpoint } from "@/lib/local/transport/run";
import { MIN_CONTEXT_TOKENS } from "@/lib/local/transport/probe";

/** Anthropic-compatible root of the local inference server. */
export const LOCAL_AGENT_URL_ENV = "ASCENT_LOCAL_AGENT_URL";
/** The token the client insists on; a local server ignores its value and rejects its absence. */
export const LOCAL_AGENT_TOKEN_ENV = "ASCENT_LOCAL_AGENT_TOKEN";
/** The context window DECLARED to the client. Load-bearing — see `LocalEndpoint.contextTokens`. */
export const LOCAL_AGENT_CONTEXT_ENV = "ASCENT_LOCAL_AGENT_CONTEXT";

export const DEFAULT_LOCAL_AGENT_URL = "http://localhost:11434";
export const DEFAULT_LOCAL_AGENT_TOKEN = "ollama";
export const DEFAULT_LOCAL_AGENT_CONTEXT = 65_536;

let clampWarned = false;

/**
 * Is this half of an arm local? The transport/model pair alone decides it — no environment is read,
 * so the cockpit, a test and the spawn all get the same answer.
 *
 * Takes the structural `{ transport, model }` both halves of an `Arm` share, so an executing arm and
 * a `PlanArm` resolve through one predicate rather than through two that can drift.
 */
export function isLocalHalf(half: { transport: TransportId; model: string }): boolean {
  if (half.transport === "pi") return true;
  return !(AGENT_MODELS as readonly string[]).includes(half.model.trim());
}

/**
 * The declared context window, clamped UP to `MIN_CONTEXT_TOKENS`.
 *
 * CLAMPED, NOT REFUSED, and the choice matters. Refusing would resolve no endpoint, and a null
 * endpoint is not an error here — it is "this arm runs on the subscription seat", so a deployment
 * that typo'd one number would silently run its local comparison arm on Claude and record the result
 * under the local arm's name. Clamping declares the smallest window that does not truncate the tool
 * definitions; if the SERVER is genuinely serving less, the probe's `context` check is what refuses
 * the run, with the server's own loaded figure as its evidence. A misconfigured declaration is a
 * warning here and a blocked arm there, which is the right side to fail on.
 */
function contextTokens(): number {
  const raw = process.env[LOCAL_AGENT_CONTEXT_ENV]?.trim();
  if (!raw) return DEFAULT_LOCAL_AGENT_CONTEXT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LOCAL_AGENT_CONTEXT;
  const declared = Math.trunc(n);
  if (declared >= MIN_CONTEXT_TOKENS) return declared;
  if (!clampWarned && typeof window === "undefined") {
    clampWarned = true;
    console.warn(
      `[local] ${LOCAL_AGENT_CONTEXT_ENV}=${declared} is below the ${MIN_CONTEXT_TOKENS}-token floor, at which the ` +
        "tool definitions are truncated and the model appears unable to call tools at all. Declaring " +
        `${MIN_CONTEXT_TOKENS} instead; set the inference server's own window to at least that (OLLAMA_CONTEXT_LENGTH) ` +
        "or the preflight probe will refuse to arm.",
    );
  }
  return MIN_CONTEXT_TOKENS;
}

/**
 * THE ENDPOINT THIS HALF OF AN ARM SPAWNS AGAINST, or `null` for "the transport's own default auth",
 * which for `claude` is the operator's subscription seat.
 *
 * Call it once per SPAWN, not once per lane: a split arm ("Claude plans, a local model executes")
 * resolves its two halves independently, and the whole configuration is unreachable if one answer is
 * reused for both sessions.
 */
export function resolveLocalEndpoint(half: { transport: TransportId; model: string } | PlanArm | null | undefined): LocalEndpoint | null {
  if (!half || !isLocalHalf(half)) return null;
  const baseUrl = (process.env[LOCAL_AGENT_URL_ENV]?.trim() || DEFAULT_LOCAL_AGENT_URL).replace(/\/+$/, "");
  const token = process.env[LOCAL_AGENT_TOKEN_ENV]?.trim() || DEFAULT_LOCAL_AGENT_TOKEN;
  return { baseUrl, model: half.model.trim(), token, contextTokens: contextTokens() };
}

/** Test seam: reset the below-floor warn-once latch. Not used in production code. */
export function __resetLocalContextWarning(): void {
  clampWarned = false;
}
