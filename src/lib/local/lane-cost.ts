// THE LANE'S SIDE LEDGERS — the two write-backs that are not the work itself: what the session COST
// (moonshot #27) and where its report is kept out of the deliverable (moonshot #25).
//
// Extracted from loop-lane.ts so that module stays the cycle orchestrator it reads as. Pure
// relocation: every function, comment and call is what it was, and loop-lane.ts imports them back.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { runGit } from "@/lib/local/git";
import { meter } from "@/lib/llm/meter";
import { appendLaneLog, updateLane } from "@/lib/db/loop-runs";
import { LANE_COST_SOURCE } from "@/lib/db/loop-runs-types";
import { LANE_REPORT_PATH } from "@/lib/local/lane-report";
import type { AgentRunResult } from "@/lib/local/agent";

/**
 * Keep `.ascent/lane-report.json` out of the deliverable.
 *
 * The report is a channel between the session and Ascent, not an artifact of the work, and the branch
 * IS the deliverable a human reviews. `.git/info/exclude` rather than `.gitignore`: a `.gitignore`
 * edit is itself a change to the repository, and the lane would then be committing a file the
 * operator never asked for into every branch it produces. `info/exclude` is local to the checkout and
 * dies with the worktree.
 *
 * Best-effort: a failure here means the file might be committed if the agent runs `git add -A`, which
 * `--permission-mode acceptEdits` does not let it do anyway. It is the belt, not the braces.
 */
export async function excludeLaneReport(dir: string): Promise<void> {
  try {
    const res = await runGit(dir, ["rev-parse", "--absolute-git-dir"]);
    const gitDir = res.stdout.trim();
    if (!res.ok || !gitDir) return;
    const info = pathJoin(gitDir, "info");
    await mkdir(info, { recursive: true });
    const file = pathJoin(info, "exclude");
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch {
      existing = "";
    }
    if (existing.includes(LANE_REPORT_PATH)) return;
    await writeFile(file, `${existing}${existing.endsWith("\n") || existing === "" ? "" : "\n"}${LANE_REPORT_PATH}\n`, "utf8");
  } catch {
    /* the report contract also tells the agent not to commit it; this is the second belt */
  }
}

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
  try {
    meterLane(laneId, orgSlug, repo, model, costMicros, result);
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
): void {
  meter({
    lane: "local",
    orgSlug,
    refId: laneId,
    idemKey: `loop-lane:${laneId}`,
    provider: "claude-cli",
    model: model ?? "unknown",
    repoFullName: repo,
    status: result.ok ? "success" : "error",
    latencyMs: result.durationMs ?? undefined,
    costMicros: costMicros == null ? null : Math.round(costMicros / 100),
    ...(result.inputTokens != null || result.outputTokens != null || result.cacheReadTokens != null
      ? {
          usage: {
            inputTokens: result.inputTokens ?? 0,
            outputTokens: result.outputTokens ?? 0,
            cacheReadTokens: result.cacheReadTokens ?? undefined,
          },
        }
      : {}),
  });
}

