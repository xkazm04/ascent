"use client";

// THE RUNNER'S TWO FORCED SETTINGS — delivery and the guard — shown as settings, not hidden (spark
// theater-upgrade, 2026-09-18).
//
// For a run or a drive these are the two dials that touch somebody else's code (RunSetupSafety.tsx).
// For the runner they are not dials: it delivers ONLY to its own branch (the route arms `runner` and
// refuses anything else) and it lands ONLY verified work (the route refuses `verifyMode: "off"`). A
// dialog that silently dropped the two pickers would leave the operator wondering whether their last
// run's "Land in my current branch" still applied — the one choice that writes into a real working
// copy. So each keeps its seat, reads as a fixed value, and says why.
//
// The check BUDGET stays a dial: the guard is on, and how long one check may take is still theirs.

import { DELIVERY_HINTS, DELIVERY_LABELS } from "@/lib/local/delivery-options";
import { SetupRow } from "./RunSetupControls";
import { CheckBudgetRow, VERIFY_LABELS } from "./RunSetupSafety";
import { SetupGroup, type SetupSectionProps } from "./RunSetupSections";

/** A setting drawn as a value, not a control: nothing in it is focusable or clickable. */
function ForcedValue({ value, testId }: { value: string; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="inline-flex items-center gap-2 rounded-lg border border-dashed border-divider px-2.5 py-1.5 type-body-sm text-slate-300"
    >
      {value}
      <span className="type-label tracking-[0.18em] text-slate-500">forced</span>
    </div>
  );
}

export function RunnerForcedSection({ dials, onChange }: SetupSectionProps) {
  return (
    <SetupGroup title="Forced for the runner">
      <SetupRow label="Delivery">
        <ForcedValue value={DELIVERY_LABELS.runner} testId="setup-forced-delivery" />
      </SetupRow>
      <p className="type-note leading-relaxed text-slate-500">
        {DELIVERY_HINTS.runner} Not pickable here: the runner delivers nowhere else.
      </p>
      <SetupRow label="Degradation guard">
        <ForcedValue value={VERIFY_LABELS.on} testId="setup-forced-verify" />
      </SetupRow>
      <p className="type-note leading-relaxed text-slate-500">The runner lands only verified work, so its guard cannot be switched off.</p>
      <CheckBudgetRow dials={dials} onChange={onChange} />
    </SetupGroup>
  );
}
