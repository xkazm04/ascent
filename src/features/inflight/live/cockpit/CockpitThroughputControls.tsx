"use client";

// HOW BIG A BITE, HOW LONG TO CHEW, AND WHAT CATCHES IT — the three dials a 21-run campaign said were
// missing, extracted from CockpitRunControls so that file stays a list of fields under the 200-LOC cap.
//
// WHY THEY ARE HERE AT ALL. Twenty-one runs on two real repositories produced 34 commits and moved one
// repo's overall score down a point. The loop was not failing; it was being timid, and three of the
// reasons were numbers nobody could reach: a batch hard-coded to five, a session ceiling hard-coded to
// twenty minutes (a campaign lane committed "Agent session exceeded 20 min and was stopped"), and no
// verification, so no reason for an agent to attempt anything it might not land.
//
// EVERY DEFAULT IS TODAY'S VALUE, so an operator who ignores this block arms exactly the run they would
// have armed before it existed. Each cap is the SERVER's own constant, never a number typed here: the
// route refuses anything outside the band, and a picker that can express a refused value is a bug.
//
// THE VERIFICATION DIAL IS THE ONE THAT EXECUTES SOMEBODY ELSE'S CODE, so it says so in words under the
// control rather than in a tooltip nobody opens. It is on by default because a loop invited to make
// larger changes needs the net; it is switchable because running a repository's own command is a real
// thing to consent to, even on a box you own.

import { Field, SelectInput } from "@/components/ui";
import {
  AGENT_TIMEOUT_CAP_MS,
  AGENT_TIMEOUT_DEFAULT_MS,
  BATCH_SIZE_CAP,
  BATCH_SIZE_DEFAULT,
  VERIFY_MODES,
  VERIFY_TIMEOUT_CAP_MS,
  type VerifyMode,
} from "@/lib/local/run-limits";
import type { RunDials } from "./useRunDials";

export interface CockpitThroughputControlsProps {
  dials: RunDials;
  onChange: <K extends keyof RunDials>(key: K, value: RunDials[K]) => void;
}

const upTo = (cap: number) => Array.from({ length: cap }, (_, i) => i + 1);

/** Minute options for a millisecond band, coarse enough to pick from: 5-minute steps. */
const minuteSteps = (capMs: number, step = 5): number[] =>
  Array.from({ length: Math.floor(capMs / 60_000 / step) }, (_, i) => (i + 1) * step);

const VERIFY_LABELS: Record<VerifyMode, string> = {
  on: "Verify each lane and reverse a regression",
  off: "Do not run this repository's checks",
};

export function CockpitThroughputControls({ dials, onChange }: CockpitThroughputControlsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Items per lane">
          <SelectInput
            data-testid="cockpit-batch-size"
            value={dials.batchSize}
            onChange={(e) => onChange("batchSize", Number(e.target.value))}
          >
            {upTo(BATCH_SIZE_CAP).map((n) => (
              <option key={n} value={n}>
                {n}
                {n === BATCH_SIZE_DEFAULT ? " — default" : ""}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Session limit">
          <SelectInput
            data-testid="cockpit-session-minutes"
            value={dials.sessionMinutes}
            onChange={(e) => onChange("sessionMinutes", Number(e.target.value))}
          >
            {minuteSteps(AGENT_TIMEOUT_CAP_MS).map((m) => (
              <option key={m} value={m}>
                {m} min{m === AGENT_TIMEOUT_DEFAULT_MS / 60_000 ? " — default" : ""}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <p className="type-note leading-relaxed text-slate-500">
        A bigger batch is what lets one lane see two copies of the same logic at once — de-duplication is not reachable from a
        batch of one. A longer session is what lets it finish the change it started.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Before each commit">
          <SelectInput
            data-testid="cockpit-verify-mode"
            value={dials.verifyMode}
            onChange={(e) => onChange("verifyMode", e.target.value as VerifyMode)}
          >
            {VERIFY_MODES.map((m) => (
              <option key={m} value={m}>
                {VERIFY_LABELS[m]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Check budget">
          <SelectInput
            data-testid="cockpit-verify-minutes"
            value={dials.verifyMinutes}
            onChange={(e) => onChange("verifyMinutes", Number(e.target.value))}
            disabled={dials.verifyMode === "off"}
          >
            {minuteSteps(VERIFY_TIMEOUT_CAP_MS).map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <p className="type-note leading-relaxed text-slate-500">
        {dials.verifyMode === "on"
          ? "Ascent resolves this repository's own check (from .ai/manifest.yaml, its guidance files, or a package.json script), runs it on the untouched worktree, and runs it again after the agent. A pass that becomes a failure is discarded in the worktree — nothing is committed, landed or opened as a PR. Running that command executes code the repository authored, in the throwaway checkout the agent already works in. A repo that declares no check is reported as unverified, never as verified."
          : "Nothing will check the agent's work before it is committed. Lanes will be recorded as UNVERIFIED, and a regression can reach whatever delivery mode you chose."}
      </p>
    </>
  );
}
