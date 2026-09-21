"use client";

// WHAT THE RUN IS ARMED WITH — the panel that replaced the Model segmented control.
//
// The control it replaced could express "sonnet at high effort" and nothing else. This feature's whole
// question — does a frontier model's plan carried out by a local model do the work, and how does it
// compare with three other configurations — is a shape that control cannot hold at all. So the panel
// owns the whole question: POLICY first (one arm, or a comparison of two to four), then the arms.
//
// Policy before arms, because the policy is what the numbers downstream mean. A `single` run produces
// a result; a `compare` run produces a comparison, and the ledger joins every lane back to the arm id
// that produced it. Choosing the shape first is choosing what question is being asked.
//
// Validation is `arm.ts`'s and the probe's — never this file's. See `armDraft.ts` for why.

import { ARM_POLICIES, MAX_COMPARE_ARMS, type ArmPolicy } from "@/lib/local/arm";
import { Segmented, SetupRow } from "../RunSetupControls";
import { ArmProbeBar } from "./ArmProbeBar";
import { ArmRow } from "./ArmRow";
import {
  armsSignature,
  canAddArm,
  canRemoveArm,
  draftsForPolicy,
  draftsToArms,
  newArmDraft,
  transportsOf,
  type ArmDraft,
} from "./armDraft";
import { useArmProbe, type ArmProbePhase } from "./useArmProbe";

const POLICY_INFO =
  "“One arm” runs the batch once, the way every run before arms existed did. “Compare” races the same curated batch across two to four arms and records which arm produced each lane — above four, a serial local arm makes a run that never finishes, which is a worse answer than no answer.";

const POLICY_LABEL: Record<ArmPolicy, string> = { single: "One arm", compare: `Compare (2–${MAX_COMPARE_ARMS})` };

export interface ArmsPanelProps {
  policy: ArmPolicy;
  arms: ArmDraft[];
  onPolicy: (policy: ArmPolicy, arms: ArmDraft[]) => void;
  onArms: (arms: ArmDraft[]) => void;
  /** The coarse probe phase, mirrored out so the CTA that actually arms the run can gate on it. */
  onPhase: (phase: ArmProbePhase) => void;
}

export function ArmsPanel({ policy, arms, onPolicy, onArms, onPhase }: ArmsPanelProps) {
  const probe = useArmProbe();
  const transports = transportsOf(arms);
  const signature = armsSignature(arms);
  const armable = draftsToArms(arms, policy) != null;

  const runProbe = async () => {
    onPhase("probing");
    onPhase(await probe.run(transports, signature));
  };

  const patch = (index: number, next: ArmDraft) => {
    onArms(arms.map((a, i) => (i === index ? next : a)));
    onPhase("idle");
  };

  // No SetupGroup wrapper on purpose: `AgentSection` owns the group, and importing it from
  // RunSetupSections — which imports this panel — would be an import cycle.
  return (
    <div className="space-y-4">
      <SetupRow label="Policy" info={POLICY_INFO}>
        <Segmented
          ariaLabel="Arm policy"
          testId="setup-arm-policy"
          value={policy}
          onChange={(p) => onPolicy(p, draftsForPolicy(arms, p))}
          options={ARM_POLICIES.map((p) => ({ value: p, label: POLICY_LABEL[p] }))}
        />
      </SetupRow>

      <div className="space-y-2.5" data-testid="arm-rows">
        {arms.map((draft, i) => (
          <ArmRow
            key={draft.key}
            draft={draft}
            index={i}
            onChange={(next) => patch(i, next)}
            onRemove={canRemoveArm(policy, arms.length) ? () => onArms(arms.filter((_, j) => j !== i)) : null}
          />
        ))}
      </div>

      {canAddArm(policy, arms.length) && (
        <button
          type="button"
          data-testid="arm-add"
          onClick={() => onArms([...arms, newArmDraft()])}
          className="focus-ring w-full rounded-lg border border-dashed border-divider px-3 py-2 type-body-sm text-slate-400 transition hover:border-accent hover:text-slate-200"
        >
          Add an arm
        </button>
      )}

      {!armable && (
        <p className="type-note leading-relaxed text-warn" data-testid="arm-unarmable">
          Every arm needs a transport and a model this build accepts, and a below-floor arm needs its opt-in ticked,
          before the run can be armed.
        </p>
      )}

      <ArmProbeBar
        phase={probe.phase}
        results={probe.results}
        error={probe.error}
        stale={probe.signature !== signature}
        disabled={!armable}
        onProbe={() => void runProbe()}
      />
    </div>
  );
}
