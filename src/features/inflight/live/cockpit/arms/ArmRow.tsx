"use client";

// ONE ARM — a transport, a model, and the disclosure that splits the planning half off from the
// executing one.
//
// The row prints the label `arm.ts` would give it, live, above the controls. That label is what the
// ledger and the theater will print beside every outcome, so the operator reads the name of the thing
// they are building while they build it rather than meeting it for the first time in a report.
//
// THE BELOW-FLOOR OPT-IN IS PART OF THE ROW, not a dialog. It appears only when the PLANNING half is
// below the floor, it states the consequence in one line, and until it is ticked the whole set is
// unarmable — an opt-in that can be missed is a default.

import { CheckCard } from "@/components/ui";
import { armLabel, normalizeArm, type TransportId } from "@/lib/local/arm";
import { SetupRow } from "../RunSetupControls";
import { ArmHalfFields } from "./ArmHalfFields";
import { draftToWire, isBelowFloor, planHalf, type ArmDraft } from "./armDraft";

const SPLIT_INFO =
  "Claude reads the repository and writes the plan; the model you pick below carries it out. The split is the configuration this whole comparison exists to measure — a frontier model's reading with a local model's hands.";

export interface ArmRowProps {
  draft: ArmDraft;
  index: number;
  onChange: (next: ArmDraft) => void;
  onRemove: (() => void) | null;
}

export function ArmRow({ draft, index, onChange, onRemove }: ArmRowProps) {
  const wire = draftToWire(draft, index);
  const label = armLabel(normalizeArm(wire));
  const below = isBelowFloor(draft);
  const plan = planHalf(draft);

  const setPlan = (half: { transport: TransportId; model: string }) => onChange({ ...draft, plan: half });

  return (
    <div className="rounded-lg border border-divider bg-surface/40 p-3" data-testid={`arm-row-${index}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="type-label tracking-[0.18em] text-slate-500">Arm {index + 1}</span>
          <span className="mt-0.5 block truncate type-mono-sm text-slate-300" data-testid={`arm-label-${index}`}>
            {label ?? "incomplete"}
          </span>
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            data-testid={`arm-remove-${index}`}
            className="focus-ring shrink-0 rounded px-1.5 py-0.5 type-caption text-slate-500 hover:text-danger"
          >
            Remove
          </button>
        )}
      </div>

      <div className="mt-3 space-y-3">
        <SetupRow label={draft.plan ? "Executes" : "Transport and model"}>
          <ArmHalfFields
            what={`Arm ${index + 1} executing`}
            transport={draft.transport}
            model={draft.model}
            onChange={(h) => onChange({ ...draft, transport: h.transport, model: h.model })}
            testId={`arm-${index}-exec`}
          />
        </SetupRow>

        <CheckCard
          checked={draft.plan != null}
          onChange={() =>
            onChange({ ...draft, plan: draft.plan ? null : { transport: "claude", model: "sonnet" }, floorAck: false })
          }
          label="Plan with a different model"
          hint={SPLIT_INFO}
        />

        {draft.plan && (
          <SetupRow label="Plans">
            <ArmHalfFields
              what={`Arm ${index + 1} planning`}
              transport={draft.plan.transport}
              model={draft.plan.model}
              onChange={setPlan}
              testId={`arm-${index}-plan`}
            />
          </SetupRow>
        )}

        {below && (
          <div className="rounded-lg border border-warn/40 bg-warn/5 p-3" data-testid={`arm-below-floor-${index}`}>
            <p className="type-caption text-warn">Below the capability floor</p>
            <p className="mt-1 type-note leading-relaxed text-slate-400">
              This arm plans with <span className="text-slate-300">{plan.transport}</span>, and the plan step fails
              closed: a plan the loop cannot read parks the whole batch rather than doing bad work. Run it anyway and
              those parked batches are counted as failures — which is what can one day retire the floor.
            </p>
            <div className="mt-2">
              <CheckCard
                checked={draft.floorAck}
                onChange={() => onChange({ ...draft, floorAck: !draft.floorAck })}
                label="Arm it below the floor anyway"
                name={`arm-floor-ack-${index}`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
