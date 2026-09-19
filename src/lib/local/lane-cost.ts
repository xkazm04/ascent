// Records the lane's reported cost and mirrors it to the usage ledger.
// The report exclusion helper keeps its compatibility export below.

import { meter } from "@/lib/llm/meter";
import { appendLaneLog, updateLane } from "@/lib/db/loop-runs";
// Deep path, not the `@/lib/db` barrel: this module already imports its siblings that way.
import { defaultOwnerTeamForRepo } from "@/lib/db/usage-events";
import { LANE_COST_SOURCE } from "@/lib/db/loop-runs-types";
import type { AgentRunResult } from "@/lib/local/agent";

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

