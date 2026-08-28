"use client";

// The dials the inspector hands the engine, extracted from CockpitInspector so that file stays an
// orchestrator. Each numeric one is capped by the SERVER's own constant rather than a number typed
// here — the route rejects anything above them, and a picker that can express a rejected value is a
// bug. The same argument governs the two agent dials: their options come from `AGENT_MODELS` /
// `AGENT_EFFORTS`, which is the identical list the route normalizes against.
//
// `Runs` is the drive's rope and is inert for a single run (one run is one run), so it is captioned
// as the drive's and sits last in its row.
//
// MODEL AND EFFORT DEFAULT TO THE DEPLOYMENT, and the empty option says so rather than naming a
// value: the resolution happens on the server (`resolveAgentConfig`), and what it resolved is
// recorded on the run and printed on the outcome — so the operator learns the real default from the
// ledger, which cannot go stale, instead of from a label in a browser that can.

import { Field, SelectInput } from "@/components/ui";
import { LOOP_CONCURRENCY_CAP, LOOP_MAX_CYCLES_CAP } from "@/lib/db/loop-runs-types";
import { AGENT_EFFORTS, AGENT_MODELS } from "@/lib/local/agent-options";
import { DRIVE_MAX_RUNS_CAP } from "./driveTypes";
import type { RunDials } from "./useRunDials";

export interface CockpitRunControlsProps {
  dims: { id: string; label: string }[];
  dials: RunDials;
  onChange: <K extends keyof RunDials>(key: K, value: RunDials[K]) => void;
}

const upTo = (cap: number) => Array.from({ length: cap }, (_, i) => i + 1);

export function CockpitRunControls({ dims, dials, onChange }: CockpitRunControlsProps) {
  return (
    <div className="mt-4 space-y-3">
      <Field label="Focus">
        <SelectInput value={dials.dimFocus ?? ""} onChange={(e) => onChange("dimFocus", e.target.value || null)}>
          <option value="">All dimensions</option>
          {dims.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id} · {d.label}
            </option>
          ))}
        </SelectInput>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Lanes at once">
          <SelectInput value={dials.concurrency} onChange={(e) => onChange("concurrency", Number(e.target.value))}>
            {upTo(LOOP_CONCURRENCY_CAP).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Cycles">
          <SelectInput value={dials.cycles} onChange={(e) => onChange("cycles", Number(e.target.value))}>
            {upTo(LOOP_MAX_CYCLES_CAP).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Drive runs">
          <SelectInput value={dials.maxRuns} onChange={(e) => onChange("maxRuns", Number(e.target.value))}>
            {upTo(DRIVE_MAX_RUNS_CAP).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Agent model">
          <SelectInput
            data-testid="cockpit-model"
            value={dials.model ?? ""}
            onChange={(e) => onChange("model", e.target.value || null)}
          >
            <option value="">Deployment default</option>
            {AGENT_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Effort">
          <SelectInput
            data-testid="cockpit-effort"
            value={dials.effort ?? ""}
            onChange={(e) => onChange("effort", e.target.value || null)}
          >
            <option value="">Deployment default</option>
            {AGENT_EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
    </div>
  );
}
