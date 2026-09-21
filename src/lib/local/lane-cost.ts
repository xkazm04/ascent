// Records the lane's reported cost and mirrors it to the usage ledger.
// The report exclusion helper keeps its compatibility export below.

import { meter } from "@/lib/llm/meter";
import { appendLaneLog, updateLane } from "@/lib/db/loop-runs";
// Deep path, not the `@/lib/db` barrel: this module already imports its siblings that way.
import { defaultOwnerTeamForRepo } from "@/lib/db/usage-events";
import { LANE_COST_SOURCE } from "@/lib/db/loop-runs-types";
import type { AgentRunResult } from "@/lib/local/agent";
import type { TransportId } from "@/lib/local/arm";
import { transportProfile } from "@/lib/local/transport/profile";

export { excludeLaneReport } from "./lane-report-exclude";

/** A cost for the lane log. `null` prints "cost unknown" — never `$0.00`, which is a claim. */
function fmtCostMicros(micros: number | null): string {
  if (micros == null) return "cost unknown";
  const cents = micros / 1_000_000;
  return cents < 100 ? `${cents.toFixed(2)}¢` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * Stamp what the session cost onto the lane, then mirror it to the unified meter.
 *
 * THE ONE-SOURCE RULE lives here: `costSource` is stamped `"envelope"` and the figure is the CLI's
 * own `total_cost_usd` for THIS session. `agentSessionId` is recorded so the row can be JOINED to an
 * OTLP `AgentSession` for inspection, and that is all — an `AgentSession` is the export of sessions a
 * developer ran, a different population by a different path, and adding that row's own cost here would
 * double-count the same tokens under the guise of a better figure.
 *
 * The meter call is FIRE-AND-FORGET by construction (`meter()` returns void and swallows everything),
 * carries the caller-owned idempotency key `loop-lane:<laneId>` so a retried write cannot double
 * count, and hands over the cost rather than letting the meter re-price it: for a subscription-auth
 * CLI session the envelope is authoritative and a token-times-rate estimate is not.
 */
export async function recordAgentCost(
  laneId: string,
  orgSlug: string,
  repo: string,
  result: AgentRunResult,
  // A STRUCTURAL slice of `LaneRunInput` rather than the type itself: importing it would make this
  // module and loop-lane.ts a cycle, and the two fields below are all this function reads.
  input: { agent?: { model?: string | null }; abPairKey?: string | null },
): Promise<void> {
  const model = result.model ?? input.agent?.model ?? null;
  const costMicros = result.costMicros ?? null;
  await updateLane(laneId, {
    model,
    costSource: LANE_COST_SOURCE,
    costMicros,
    inputTokens: result.inputTokens ?? null,
    outputTokens: result.outputTokens ?? null,
    cacheReadTokens: result.cacheReadTokens ?? null,
    turns: result.turns ?? null,
    agentDurationMs: result.durationMs ?? null,
    agentSessionId: result.sessionId ?? null,
    ...(input.abPairKey ? { abPairKey: input.abPairKey } : {}),
  }).catch(() => null);
  await appendLaneLog(
    laneId,
    `Agent: ${model ?? "model unknown"} · ${result.turns ?? "?"} turns · ${fmtCostMicros(costMicros)}${
      result.durationMs != null ? ` · ${Math.round(result.durationMs / 1000)}s` : ""
    }`,
  );
  // `costMicros` on the lane is MICRO-CENTS; the meter's is USD micros. Divide by 100 rather than
  // handing over a figure a hundred times too large — the two units are deliberately different
  // because a lane needs sub-cent resolution and a usage ledger sums whole calls.
  // MC-B19: the lane knows its repo, so it can name the TEAM that owns it — the "Spend by team" panel
  // read 100 % "Org-wide" for every non-scan lane purely because nobody resolved it. Best-effort and
  // awaited before the meter call rather than inside it: `meter()` is synchronous by contract.
  const teamKey = await defaultOwnerTeamForRepo(orgSlug, repo).catch(() => null);
  try {
    meterLane(laneId, orgSlug, repo, model, costMicros, result, teamKey);
  } catch (err) {
    // `meter()` is documented as unable to throw, and this lane does not take that on trust: an
    // observability call must never be the reason a remediation lane failed. The lane log is where it
    // is said out loud, so a silently unmetered run is still visible to the operator.
    await appendLaneLog(laneId, `Usage meter declined this lane: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The meter half of the record, split out so the try/catch above wraps one thing. */
function meterLane(
  laneId: string,
  orgSlug: string,
  repo: string,
  model: string | null,
  costMicros: number | null,
  result: AgentRunResult,
  teamKey: string | null,
): void {
  meter({
    lane: "local",
    orgSlug,
    refId: laneId,
    idemKey: `loop-lane:${laneId}`,
    provider: "claude-cli",
    model: model ?? "unknown",
    repoFullName: repo,
    // `null` is the explicit ORG-WIDE bucket, not a missing value — see teamTotals.
    teamKey,
    status: result.ok ? "success" : "error",
    latencyMs: result.durationMs ?? undefined,
    costMicros: costMicros == null ? null : Math.round(costMicros / 100),
    // NULL-NEVER-ZERO, including inside this spread (MC-B31 / VICTOR-L1-08). The guard only says that
    // SOME token count was reported; a field the CLI did not report stays absent, so the meter records
    // it as `null` ("not reported") rather than as a measured 0 that downstream sums and averages.
    ...(result.inputTokens != null || result.outputTokens != null || result.cacheReadTokens != null
      ? {
          usage: {
            inputTokens: result.inputTokens ?? undefined,
            outputTokens: result.outputTokens ?? undefined,
            cacheReadTokens: result.cacheReadTokens ?? undefined,
          },
        }
      : {}),
  });
}


// ── HONEST COST FOR A TRANSPORT-ARMED LANE ───────────────────────────────────────────────────────
//
// TWO THINGS THE PAIR ABOVE CANNOT DO, both of which would silently corrupt the one metric this
// feature exists to move (Claude tokens per verified point):
//
//   1. A FABRICATED PRICE. Measured 2026-09-21: `claude -p` pointed at a local Ollama endpoint
//      returned `total_cost_usd: 0.084` with `costBasis: "unknown"` — a price computed from a rate
//      card for a model that was never called. `parseAgentEnvelope` faithfully turns that into
//      `costMicros`, and `recordAgentCost` would bank it in the same column as real Claude spend. A
//      step whose transport is zero-cost therefore has its dollar figure DISCARDED, and the lane
//      records `costSource: "none"` with `costMicros: null` — never 0, because a display that
//      divides would report an infinite lift-per-cent.
//   2. A POOLED TOKEN RECORD. A split arm spends CLAUDE tokens planning and LOCAL tokens executing.
//      A row that sums them cannot answer the question the comparison was run to answer, and no
//      later read can unpool them. The split is derived from the transport that ran each step.
//
// WHAT IS DELIBERATELY NOT HERE: a column. `LoopRunLane` has one set of token columns and this
// package may not add another (see the WP4 report) — so the split is computed, logged and RETURNED,
// and the two halves reach the usage ledger as two separate metered events, one per provider. When
// the row gains plan-side columns, `laneArmPatch` is the one place that has to learn about them.

/** One half of an arm's work: the planning session or the executing session, and what ran it. */
export interface ArmStep {
  step: "plan" | "execute";
  transport: TransportId;
  /** The model this step actually ran. */
  model: string | null;
  /** The local endpoint it ran against, when it was a local one. Absent = the transport's own auth. */
  endpoint?: { model: string } | null;
  result: AgentRunResult;
}

/** One side's token record. Every field is null when the tool reported nothing — never 0. */
export interface StepTokens {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  turns: number | null;
  durationMs: number | null;
  /** MICRO-CENTS, and `null` on the local side ALWAYS — see the discard above. */
  costMicros: number | null;
}

/** The lane's tokens, split by who spent them. A side that did not run is `null`, not a row of zeroes. */
export interface LaneTokenSplit {
  claude: StepTokens | null;
  local: StepTokens | null;
}

/** The value `costSource` takes when every step's price was fabricated and discarded. */
export const LANE_COST_SOURCE_NONE = "none";

/** The profile's `zeroCost`, or null when this build has no profile for the transport yet. */
function profileZeroCost(transport: TransportId): boolean | null {
  try {
    return transportProfile(transport).zeroCost;
  } catch {
    return null;
  }
}

/**
 * Is this step's spend LOCAL — that is, is its reported dollar figure meaningless?
 *
 * Two independent witnesses, either of which is sufficient. An explicit endpoint is the stronger one
 * and is checked first: the `claude` transport is NOT a zero-cost profile, but `claude -p` pointed at
 * a local server spends no Anthropic tokens at all while still printing a price. A transport with no
 * profile in this build falls back to "not local", which keeps a real Claude figure rather than
 * discarding one.
 */
export function stepIsLocal(step: ArmStep): boolean {
  if (step.endpoint) return true;
  return profileZeroCost(step.transport) === true;
}

function tokensOf(result: AgentRunResult, local: boolean): StepTokens {
  return {
    inputTokens: result.inputTokens ?? null,
    outputTokens: result.outputTokens ?? null,
    cacheReadTokens: result.cacheReadTokens ?? null,
    turns: result.turns ?? null,
    durationMs: result.durationMs ?? null,
    // THE DISCARD. Not `?? null` on a local step — the figure is PRESENT and wrong.
    costMicros: local ? null : (result.costMicros ?? null),
  };
}

/** Sum two nullable counts keeping null different from 0: two unknowns stay unknown, one known stands alone. */
function addNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a + b;
}

function mergeTokens(a: StepTokens | null, b: StepTokens): StepTokens {
  if (!a) return b;
  return {
    inputTokens: addNullable(a.inputTokens, b.inputTokens),
    outputTokens: addNullable(a.outputTokens, b.outputTokens),
    cacheReadTokens: addNullable(a.cacheReadTokens, b.cacheReadTokens),
    turns: addNullable(a.turns, b.turns),
    durationMs: addNullable(a.durationMs, b.durationMs),
    costMicros: addNullable(a.costMicros, b.costMicros),
  };
}

/** Split an arm's steps by who spent the tokens. Pure — the whole of it is a table test. */
export function splitLaneTokens(steps: ArmStep[]): LaneTokenSplit {
  const split: LaneTokenSplit = { claude: null, local: null };
  for (const step of steps) {
    const local = stepIsLocal(step);
    const tokens = tokensOf(step.result, local);
    if (local) split.local = mergeTokens(split.local, tokens);
    else split.claude = mergeTokens(split.claude, tokens);
  }
  return split;
}

/** What `laneArmPatch` hands the lane row — the existing columns, and nothing invented. */
export interface LaneArmPatch {
  model: string | null;
  costSource: string;
  costMicros: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  turns: number | null;
  agentDurationMs: number | null;
  agentSessionId: string | null;
}

/**
 * The lane patch for an arm's steps, and the split it was derived from.
 *
 * `costSource` is `"none"` when NOTHING real was spent — every step was local — and `"envelope"`
 * when a Claude-side step ran, in which case `costMicros` carries that side's figure ALONE. A split
 * arm therefore records what its plan actually cost, and never the local executor's invented price.
 *
 * The token columns carry the EXECUTING session, which is byte-identical to what every lane before
 * transports recorded (the planning session's envelope was read past and dropped). The plan half is
 * in the returned `split`, which is what a plan-side column would be written from.
 */
export function laneArmPatch(steps: ArmStep[]): { patch: LaneArmPatch; split: LaneTokenSplit } {
  const split = splitLaneTokens(steps);
  const exec = steps.find((s) => s.step === "execute") ?? steps[steps.length - 1] ?? null;
  const execTokens = exec ? tokensOf(exec.result, stepIsLocal(exec)) : null;
  return {
    split,
    patch: {
      model: exec?.result.model ?? exec?.model ?? null,
      costSource: split.claude ? LANE_COST_SOURCE : LANE_COST_SOURCE_NONE,
      costMicros: split.claude?.costMicros ?? null,
      inputTokens: execTokens?.inputTokens ?? null,
      outputTokens: execTokens?.outputTokens ?? null,
      cacheReadTokens: execTokens?.cacheReadTokens ?? null,
      turns: execTokens?.turns ?? null,
      agentDurationMs: execTokens?.durationMs ?? null,
      agentSessionId: exec?.result.sessionId ?? null,
    },
  };
}

/** The one line the lane log prints for a transport-armed lane — both sides, each with its own unit. */
export function laneSplitLine(split: LaneTokenSplit): string {
  const side = (label: string, t: StepTokens | null) => {
    if (!t) return null;
    const tok = addNullable(t.inputTokens, t.outputTokens);
    return `${label}: ${tok == null ? "tokens unknown" : `${tok} tokens`} · ${fmtCostMicros(t.costMicros)}`;
  };
  const parts = [side("Claude", split.claude), side("Local", split.local)].filter((s): s is string => s !== null);
  return parts.length ? parts.join(" · ") : "No session reported any tokens.";
}

/**
 * Stamp a transport-armed lane's cost and token split, then mirror BOTH halves to the usage ledger.
 *
 * Two metered events rather than one, because they are two providers: the local half posts under
 * `local` (a zero-cost provider the meter already knows) with an EXPLICIT `costMicros: null`, which
 * the meter honours as "unknowable" instead of re-pricing the tokens from a rate card. The execute
 * step keeps the existing `loop-lane:<laneId>` idempotency key so a row written by the older path is
 * not double-counted; the plan step gets its own suffixed key.
 */
export async function recordArmCost(
  laneId: string,
  orgSlug: string,
  repo: string,
  steps: ArmStep[],
  input: { abPairKey?: string | null } = {},
): Promise<LaneTokenSplit> {
  const { patch, split } = laneArmPatch(steps);
  await updateLane(laneId, {
    ...patch,
    ...(input.abPairKey ? { abPairKey: input.abPairKey } : {}),
  }).catch(() => null);
  await appendLaneLog(laneId, `Arm: ${laneSplitLine(split)}`);
  const teamKey = await defaultOwnerTeamForRepo(orgSlug, repo).catch(() => null);
  for (const step of steps) {
    try {
      meterArmStep(laneId, orgSlug, repo, step, teamKey);
    } catch (err) {
      await appendLaneLog(laneId, `Usage meter declined this lane: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return split;
}

/** The meter half of one step's record, split out so the try/catch above wraps one thing. */
function meterArmStep(laneId: string, orgSlug: string, repo: string, step: ArmStep, teamKey: string | null): void {
  const local = stepIsLocal(step);
  const usd = local ? null : step.result.costMicros;
  meter({
    lane: "local",
    orgSlug,
    refId: laneId,
    idemKey: step.step === "execute" ? `loop-lane:${laneId}` : `loop-lane:${laneId}:${step.step}`,
    provider: local ? "local" : "claude-cli",
    model: step.result.model ?? step.model ?? "unknown",
    repoFullName: repo,
    teamKey,
    status: step.result.ok ? "success" : "error",
    latencyMs: step.result.durationMs ?? undefined,
    // EXPLICIT NULL on the local side — an ABSENT key would mean "price it from the tokens", which
    // is the fabrication this whole section exists to refuse.
    costMicros: usd == null ? null : Math.round(usd / 100),
    ...(step.result.inputTokens != null || step.result.outputTokens != null || step.result.cacheReadTokens != null
      ? {
          usage: {
            inputTokens: step.result.inputTokens ?? undefined,
            outputTokens: step.result.outputTokens ?? undefined,
            cacheReadTokens: step.result.cacheReadTokens ?? undefined,
          },
        }
      : {}),
  });
}
