"use client";

// WHAT THE RUN IS ARMED WITH, in four groups — the dials that decide WHICH work a lane takes and HOW
// MUCH of it. (The two that decide what happens to somebody else's code live in RunSetupSafety.tsx,
// because those two carry consequences that stay on the page rather than moving into a tooltip.)
//
// Every paragraph here was previously printed under its control in an 18rem rail. The words are kept
// verbatim wherever they were load-bearing — the reasoning behind a dial does not get worse for being
// one click away — and each one now hangs off the label it explains.

import { LOOP_CONCURRENCY_CAP, LOOP_DEFAULT_CONCURRENCY, LOOP_MAX_CYCLES_CAP } from "@/lib/db/loop-runs-types";
import { AGENT_EFFORTS, AGENT_MODELS } from "@/lib/local/agent-options";
import { AGENT_TIMEOUT_CAP_MS, AGENT_TIMEOUT_DEFAULT_MS, BATCH_SIZE_CAP, BATCH_SIZE_DEFAULT } from "@/lib/local/run-limits";
import { ChoiceList, NumberRow, Segmented, SetupRow, type SegmentedOption } from "./RunSetupControls";
import { DRIVE_DEFAULT_MAX_RUNS, DRIVE_MAX_RUNS_CAP } from "./driveTypes";
import type { RunDials } from "./useRunDials";

export interface SetupSectionProps {
  dials: RunDials;
  onChange: <K extends keyof RunDials>(key: K, value: RunDials[K]) => void;
}

/** Minute options for a millisecond band, coarse enough to pick from: 5-minute steps. */
export const minuteSteps = (capMs: number, step = 5): number[] =>
  Array.from({ length: Math.floor(capMs / 60_000 / step) }, (_, i) => (i + 1) * step);

const minuteOptions = (capMs: number, defaultMs?: number): SegmentedOption<number>[] =>
  minuteSteps(capMs).map((m) => ({ value: m, label: `${m} min${defaultMs != null && m === defaultMs / 60_000 ? " — default" : ""}` }));

/** The eyebrow + hairline every group in the dialog opens with. */
export function SetupGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-divider pt-4 first:border-t-0 first:pt-0">
      <h3 className="type-label tracking-[0.22em] text-slate-400">{title}</h3>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

export function WorkSection({ dials, onChange, dims }: SetupSectionProps & { dims: { id: string; label: string }[] }) {
  return (
    <SetupGroup title="The work">
      <SetupRow
        label="Focus"
        info="Narrows every lane in this run to follow-ups on ONE dimension. The batch ledger under the sky filters with it, so what you see is what will be dispatched. A drive ignores it: a drive re-picks its own batch before every run."
      >
        <ChoiceList
          ariaLabel="Dimension focus"
          testId="setup-focus"
          value={dials.dimFocus ?? ""}
          onChange={(raw) => onChange("dimFocus", raw || null)}
          options={[{ value: "", label: "All dimensions" }, ...dims.map((d) => ({ value: d.id, label: `${d.id} · ${d.label}` }))]}
        />
      </SetupRow>
      <SetupRow
        label="Items per lane"
        info="A bigger batch is what lets one lane see two copies of the same logic at once — de-duplication is not reachable from a batch of one. Every item is claimed before dispatch and released after, so a batch is also a lock held over other workers' queue."
      >
        <NumberRow
          ariaLabel="Items per lane"
          testId="setup-batch-size"
          value={dials.batchSize}
          cap={BATCH_SIZE_CAP}
          defaultValue={BATCH_SIZE_DEFAULT}
          onChange={(n) => onChange("batchSize", n)}
        />
      </SetupRow>
      <SetupRow label="Lanes at once" info="How many repositories this run works in parallel. Each lane is its own throwaway worktree and its own agent session.">
        <NumberRow
          ariaLabel="Lanes at once"
          testId="setup-concurrency"
          value={dials.concurrency}
          cap={LOOP_CONCURRENCY_CAP}
          defaultValue={LOOP_DEFAULT_CONCURRENCY}
          onChange={(n) => onChange("concurrency", n)}
        />
      </SetupRow>
    </SetupGroup>
  );
}

export function SessionSection({ dials, onChange }: SetupSectionProps) {
  return (
    <SetupGroup title="How long">
      <SetupRow label="Cycles" info="How many times each lane repeats the take-a-batch → work → rescan loop before the run settles.">
        <NumberRow
          ariaLabel="Cycles"
          testId="setup-cycles"
          value={dials.cycles}
          cap={LOOP_MAX_CYCLES_CAP}
          onChange={(n) => onChange("cycles", n)}
        />
      </SetupRow>
      <SetupRow
        label="Session limit"
        info="The ceiling on ONE agent session. A campaign lane committed “Agent session exceeded 20 min and was stopped” — a structural change that was underway when the clock ran out and was then discarded with the worktree. A longer session is what lets a lane finish the change it started; the ceiling stays because a wedged session holds a lane, a worktree and a claim until it fires."
      >
        <ChoiceList
          ariaLabel="Session limit"
          testId="setup-session-minutes"
          value={dials.sessionMinutes}
          onChange={(raw) => onChange("sessionMinutes", Number(raw))}
          options={minuteOptions(AGENT_TIMEOUT_CAP_MS, AGENT_TIMEOUT_DEFAULT_MS)}
        />
      </SetupRow>
      <SetupRow
        label="Drive runs"
        info="The drive's rope: how many runs “Drive to green” may spend before it stops on its own. Inert for a single run — one run is one run."
      >
        <NumberRow
          ariaLabel="Drive runs"
          testId="setup-max-runs"
          value={dials.maxRuns}
          cap={DRIVE_MAX_RUNS_CAP}
          defaultValue={DRIVE_DEFAULT_MAX_RUNS}
          onChange={(n) => onChange("maxRuns", n)}
        />
      </SetupRow>
    </SetupGroup>
  );
}

export function AgentSection({ dials, onChange }: SetupSectionProps) {
  return (
    <SetupGroup title="The agent">
      <SetupRow
        label="Model"
        info="“Deployment default” resolves on the server (CLAUDE_MODEL), and what it resolved is recorded on the run and printed on the outcome — so the real default is learned from the ledger, which cannot go stale, rather than from a label in a browser that can."
      >
        <Segmented
          ariaLabel="Agent model"
          testId="setup-model"
          value={dials.model ?? ""}
          onChange={(v) => onChange("model", v || null)}
          options={[{ value: "", label: "Deployment default" }, ...AGENT_MODELS.map((m) => ({ value: m as string, label: m }))]}
        />
      </SetupRow>
      <SetupRow
        label="Effort"
        info="Passed to the CLI as --effort. “Deployment default” sends no flag at all, which is not the same as a default level."
      >
        <Segmented
          ariaLabel="Reasoning effort"
          testId="setup-effort"
          value={dials.effort ?? ""}
          onChange={(v) => onChange("effort", v || null)}
          options={[{ value: "", label: "Deployment default" }, ...AGENT_EFFORTS.map((e) => ({ value: e as string, label: e }))]}
        />
      </SetupRow>
    </SetupGroup>
  );
}
