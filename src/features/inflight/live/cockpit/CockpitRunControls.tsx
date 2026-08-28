"use client";

// The four dials the inspector hands the engine, extracted from CockpitInspector so that file stays
// an orchestrator. Each one is capped by the SERVER's own constant rather than a number typed here —
// the route rejects anything above them, and a picker that can express a rejected value is a bug.
//
// `Runs` is the drive's rope and is inert for a single run (one run is one run), so it is captioned
// as the drive's and sits last.

import { Field, SelectInput } from "@/components/ui";
import { LOOP_CONCURRENCY_CAP, LOOP_MAX_CYCLES_CAP } from "@/lib/db/loop-runs-types";
import { DRIVE_MAX_RUNS_CAP } from "./driveTypes";

export interface CockpitRunControlsProps {
  dims: { id: string; label: string }[];
  dimFocus: string | null;
  onDimFocus: (id: string | null) => void;
  concurrency: number;
  onConcurrency: (n: number) => void;
  cycles: number;
  onCycles: (n: number) => void;
  maxRuns: number;
  onMaxRuns: (n: number) => void;
}

const upTo = (cap: number) => Array.from({ length: cap }, (_, i) => i + 1);

export function CockpitRunControls(props: CockpitRunControlsProps) {
  const { dims, dimFocus, onDimFocus, concurrency, onConcurrency, cycles, onCycles, maxRuns, onMaxRuns } = props;
  return (
    <div className="mt-4 space-y-3">
      <Field label="Focus">
        <SelectInput value={dimFocus ?? ""} onChange={(e) => onDimFocus(e.target.value || null)}>
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
          <SelectInput value={concurrency} onChange={(e) => onConcurrency(Number(e.target.value))}>
            {upTo(LOOP_CONCURRENCY_CAP).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Cycles">
          <SelectInput value={cycles} onChange={(e) => onCycles(Number(e.target.value))}>
            {upTo(LOOP_MAX_CYCLES_CAP).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Drive runs">
          <SelectInput value={maxRuns} onChange={(e) => onMaxRuns(Number(e.target.value))}>
            {upTo(DRIVE_MAX_RUNS_CAP).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
    </div>
  );
}
