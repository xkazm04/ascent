"use client";

// INSPECT mode — the right rail while nothing is running. It answers three questions about the
// current selection, in the order an operator asks them: what did I select, what do these repos have
// in COMMON, and what standard would each lane be handed? Then one CTA.
//
// WHAT LEFT THIS PANEL (2026-09-17), and why it is not a loss:
//   • the ten DIALS went to the run-setup dialog behind the masthead's gear — setup is a property of
//     the next run, not of this selection, and it never fitted an 18rem column;
//   • the PROPOSED BATCH went to the ledger under the sky (`CockpitBatchLedger`) — it is a table, and
//     a table needs the main column.
// Both still travel with the run this CTA starts: the dials and the batch live in `useCockpit`, and
// this panel composes the request from them exactly as it did when it owned them.
//
// PAIRING RULE. A loop lane edits a real working copy, so a selected repo with no local pairing
// cannot run. Rather than disabling the whole CTA (which would punish a lasso for catching one
// unpaired repo), the unpaired rows are flagged and EXCLUDED, and the CTA counts only what will
// actually run — dropping to disabled when that count is zero.

import { Kicker } from "@/components/ui";
import { BriefStrip, InspectorEmpty } from "./BriefStrip";
import { SharedDimensionBars } from "./CockpitBatch";
import { CockpitInspectorCta } from "./CockpitInspectorCta";
import type { StartDriveInput } from "./driveClient";
import type { StartLoopInput } from "./loopClient";
import type { ProposalBatch } from "./useProposalBatch";
import type { RunDials } from "./useRunDials";

export interface CockpitInspectorProps {
  /** The selection's proposals, pruning and arithmetic — owned by `useCockpit`, read here and by the
   *  batch ledger, so the CTA dispatches exactly what the ledger draws. */
  batch: ProposalBatch;
  /** The armed run configuration (the setup dialog writes it; this composes the request from it). */
  dials: RunDials;
  onRun: (input: StartLoopInput) => void;
  /** Start a DRIVE over the same scope: runs until green, dry, or the run budget is spent. */
  onDrive: (input: StartDriveInput) => void;
  canRun: boolean;
  /** Drive shares the loop's gate; false only when the deployment cannot start one at all. */
  canDrive?: boolean;
  /** A failed start (the server's own 409 copy) — shown next to the buttons that produced it. */
  error?: string | null;
  /** Why running is unavailable (hosted, not owner, autopilot off) — shown in place of the CTA. */
  blockedReason?: string | null;
  busy?: boolean;
}

export function CockpitInspector(props: CockpitInspectorProps) {
  const { batch, dials, onRun, onDrive, canRun, canDrive = true, blockedReason = null, busy = false, error = null } = props;
  const { repos, unpaired, runnable, proposals, shares, batches } = batch;

  const run = () => {
    const curated = Object.keys(batches).length > 0;
    onRun({
      repos: runnable,
      batches: curated ? batches : undefined,
      concurrency: dials.concurrency,
      maxCycles: dials.cycles,
      model: dials.model,
      effort: dials.effort,
      delivery: dials.delivery,
      // The throughput and guard dials travel with the run for the same reason the agent
      // configuration does: they are properties of how the work is done, and a run whose row does not
      // record them cannot be compared with one that does. Minutes here, milliseconds on the wire.
      batchSize: dials.batchSize,
      agentTimeoutMs: dials.sessionMinutes * 60_000,
      verifyMode: dials.verifyMode,
      verifyTimeoutMs: dials.verifyMinutes * 60_000,
    });
  };

  // A drive picks its OWN batch before every run (the fleet is re-scored between them), so the
  // ledger's pruning and dimension focus deliberately do not travel with it — only the scope and
  // the three bounds do.
  const drive = () =>
    onDrive({
      repos: runnable,
      maxRuns: dials.maxRuns,
      maxCycles: dials.cycles,
      concurrency: dials.concurrency,
      // The agent configuration DOES travel with a drive, unlike the pruning above: it is a property
      // of how the work is done, not of which work was picked, so it survives the re-batching.
      model: dials.model,
      effort: dials.effort,
      // Delivery travels with a drive too, and it is the dial that most needs to: a drive dispatching
      // run after run from an unchanged HEAD is exactly the shape the delivery choice exists to fix.
      delivery: dials.delivery,
    });

  if (repos.length === 0) return <InspectorEmpty />;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Inspector</Kicker>
        <span className="type-caption tabular-nums text-slate-500">{repos.length} selected</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1">
        {repos.slice(0, 12).map((r) => (
          <li
            key={r}
            className={`rounded border px-1.5 py-px type-caption ${
              unpaired.has(r) ? "border-warn/50 text-warn" : "border-divider text-slate-400"
            }`}
            title={unpaired.has(r) ? `${r} — no local pairing` : r}
          >
            {r.split("/")[1] ?? r}
          </li>
        ))}
        {repos.length > 12 && <li className="type-caption text-slate-600">+{repos.length - 12} more</li>}
      </ul>

      <SharedDimensionBars shares={shares} />

      <BriefStrip proposals={proposals} />

      <CockpitInspectorCta
        runnable={runnable.length}
        maxRuns={dials.maxRuns}
        onRun={run}
        onDrive={drive}
        canRun={canRun}
        canDrive={canDrive}
        blockedReason={blockedReason}
        busy={busy}
        error={error}
      />
    </div>
  );
}
