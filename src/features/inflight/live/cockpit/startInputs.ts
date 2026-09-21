// WHAT EACH START SENDS — the three request bodies the cockpit composes from one set of dials, as pure
// functions (spark theater-upgrade, 2026-09-18). They lived inline in CockpitInspector's handlers,
// which was fine for two and stopped being fine at three: the standing runner is started from the
// setup dialog rather than the rail, and one body composed in two components is two bodies.
//
// THE DIALS NOW REACH A DRIVE. Until 2026-09-18 "Drive to green" sent scope, cycles, lanes, model,
// effort and delivery — and nothing else, so batch size, the session ceiling, the guard and its budget
// were silently the deployment defaults on every drive run whatever the dialog said. `driveDialsOf`
// is sent by BOTH drive modes now; the route validates it with the loop route's own rules
// (`parseDriveDials`). Minutes here, milliseconds on the wire, exactly as the manual run.
//
// THE RUNNER'S TWO FORCED SETTINGS are forced here as well as refused by the route: no `delivery`
// (the route arms `runner` and 400s anything else), and `verifyMode: "on"` whatever the dial says —
// the runner lands only verified work.

import type { DriveDials } from "@/lib/local/runner-types";
import { armRequestFields } from "./arms/armDraft";
import type { StartDriveInput } from "./driveClient";
import type { StartLoopInput } from "./loopClient";
import type { ProposalBatch } from "./useProposalBatch";
import type { RunDials } from "./useRunDials";
import type { ArmPolicy } from "@/lib/local/arm";

/**
 * THE ARMS, as the three bodies carry them — or nothing at all.
 *
 * `armRequestFields` returns null when the builder's rows are not armable, and that null is NOT
 * turned into a partial body here: half a configuration on the wire is a run recorded under a
 * configuration nobody chose. `armStartBlock` below is what keeps a caller from reaching this case
 * with a press; this is the second line of the same refusal.
 */
function armFieldsOf(d: RunDials): { armPolicy: ArmPolicy; arms: Record<string, unknown>[] } | Record<string, never> {
  return armRequestFields(d.arms, d.armPolicy) ?? {};
}

/**
 * WHY THIS CONFIGURATION MAY NOT BE STARTED — one sentence, or null for "it may".
 *
 * Both cases are the same failure with different timing: a run that departs on a configuration
 * nothing has cleared spends HOURS of wall clock before it produces a wrong ANSWER rather than an
 * error (`transport/probe.ts`), and a wrong answer with a number on it is worse than no answer. So
 * the CTA refuses, and it says which of the two it is — a disabled button with no sentence is the
 * silently dead button this gate exists not to be.
 *
 * `idle` does NOT block: the probe fires from a deliberate press, and requiring one before every run
 * would make an unchanged, already-proven configuration un-runnable.
 */
export function armStartBlock(d: RunDials): string | null {
  if (armRequestFields(d.arms, d.armPolicy) == null) {
    return "This configuration is not armable yet — open the gear and give every arm a transport, a model, and its below-floor opt-in where one is needed.";
  }
  if (d.armProbe === "probing") return "The preflight probe is still running — it finishes in a few seconds.";
  if (d.armProbe === "blocked") {
    return "The preflight probe refused this configuration — open the gear to read what it found, fix it, and probe again.";
  }
  return null;
}

/** The run dials every run a drive dispatches is armed with. */
export function driveDialsOf(d: RunDials): DriveDials {
  return {
    batchSize: d.batchSize,
    agentTimeoutMs: d.sessionMinutes * 60_000,
    verifyMode: d.verifyMode,
    verifyTimeoutMs: d.verifyMinutes * 60_000,
    rescanCadence: d.rescanCadence,
  };
}

/** One run over the selection — the ledger's pruning and focus travel with it (`batches`). */
export function runStartInput(d: RunDials, batch: Pick<ProposalBatch, "runnable" | "batches">): StartLoopInput {
  const curated = Object.keys(batch.batches).length > 0;
  return {
    repos: batch.runnable,
    batches: curated ? batch.batches : undefined,
    concurrency: d.concurrency,
    maxCycles: d.cycles,
    model: d.model,
    effort: d.effort,
    delivery: d.delivery,
    // The throughput and guard dials travel with the run for the same reason the agent
    // configuration does: they are properties of how the work is done, and a run whose row does not
    // record them cannot be compared with one that does. Minutes here, milliseconds on the wire.
    batchSize: d.batchSize,
    agentTimeoutMs: d.sessionMinutes * 60_000,
    verifyMode: d.verifyMode,
    verifyTimeoutMs: d.verifyMinutes * 60_000,
    rescanCadence: d.rescanCadence,
    // WHAT THIS RUN IS ARMED WITH. The route validates it with `normalizeArmSet` — the same function
    // the builder validated against — and stores `armsJson`/`armPolicy` on the run, which is what
    // joins every lane back to the arm that produced it.
    ...armFieldsOf(d),
  };
}

/**
 * A BOUNDED drive over the selection. It picks its OWN batch before every run (the fleet is re-scored
 * between them), so the ledger's pruning and focus deliberately do not travel with it; the agent
 * configuration, delivery and the dials do — they are how the work is done, not which work.
 */
export function driveStartInput(d: RunDials, repos: string[]): StartDriveInput {
  return {
    repos,
    maxRuns: d.maxRuns,
    maxCycles: d.cycles,
    concurrency: d.concurrency,
    model: d.model,
    effort: d.effort,
    delivery: d.delivery,
    dials: driveDialsOf(d),
    ...armFieldsOf(d),
  };
}

export type CeilingParse = { ok: true; usd: number } | { ok: false; error: string };

/** The typed ceiling: a finite, non-negative number of US dollars. An EMPTY field is an error, not
 *  "0 = no ceiling" — clearing the box must never be how the brake comes off. */
export function parseCeilingUsd(text: string): CeilingParse {
  const t = text.trim();
  const n = t === "" ? Number.NaN : Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Enter a daily ceiling in US dollars — 0 means no ceiling." };
  return { ok: true, usd: n };
}

export type RunnerStart = { ok: true; input: StartDriveInput } | { ok: false; error: string };

/** The STANDING RUNNER. `selection` is the rail's runnable repos, used only when the scope says so. */
export function runnerStartInput(d: RunDials, selection: readonly string[]): RunnerStart {
  const ceiling = parseCeilingUsd(d.spendCeiling);
  if (!ceiling.ok) return ceiling;
  if (d.runnerScope === "selection" && selection.length === 0) {
    return { ok: false, error: "No paired repos are selected — choose every watched, paired repo, or select some." };
  }
  return {
    ok: true,
    input: {
      mode: "continuous",
      // Omitted = the server's default scope: every watched repo with a paired checkout.
      ...(d.runnerScope === "selection" ? { repos: [...selection] } : {}),
      maxCycles: d.cycles,
      concurrency: d.concurrency,
      model: d.model,
      effort: d.effort,
      spendCeilingUsd: ceiling.usd,
      dials: { ...driveDialsOf(d), verifyMode: "on" },
      ...armFieldsOf(d),
    },
  };
}
