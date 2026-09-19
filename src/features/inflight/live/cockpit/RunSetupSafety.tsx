"use client";

// THE TWO DIALS THAT TOUCH SOMEBODY ELSE'S CODE — the degradation guard (which EXECUTES commands the
// repository authored) and delivery (which can write into the operator's real working copy).
//
// THESE TWO KEEP A VISIBLE LINE. Everywhere else in this dialog the standing paragraph moved into an
// InfoTip, because an explanation nobody has asked for yet is what turned the old rail into an essay.
// A CONSEQUENCE is not an explanation: "nothing will check the agent's work before it is committed"
// and "this merges into the branch your checkout is on" are things the operator must read BEFORE they
// choose, not after they wonder. So the mechanism lives in the tooltip and the consequence of the
// CURRENT choice stays on the page, toned to what it is — `warn` when the net is off.
//
// `pr` is DISABLED, with its reason in the option itself, on a deployment with no GitHub App; the
// route refuses it there too, so this is a courtesy rather than the enforcement.

import { VERIFY_MODES, VERIFY_TIMEOUT_CAP_MS, type VerifyMode } from "@/lib/local/run-limits";
import { DELIVERY_HINTS, DELIVERY_LABELS, LOOP_DELIVERIES, type LoopDelivery } from "@/lib/local/delivery-options";
import { ChoiceList, Segmented, SetupRow } from "./RunSetupControls";
import { SetupGroup, minuteSteps, type SetupSectionProps } from "./RunSetupSections";

const VERIFY_LABELS: Record<VerifyMode, string> = { on: "Verify each lane", off: "Do not verify" };

const VERIFY_MECHANISM =
  "Ascent resolves this repository's own check (from .ai/manifest.yaml, its guidance files, or a package.json script), runs it on the untouched worktree, and runs it again after the agent. A pass that becomes a failure is discarded in the worktree — nothing is committed, landed or opened as a PR. A repo that declares no check is reported as unverified, never as verified.";

const VERIFY_CONSEQUENCE: Record<VerifyMode, string> = {
  on: "Running that command executes code the repository authored, in the throwaway checkout the agent already works in.",
  off: "Nothing will check the agent's work before it is committed. Lanes will be recorded as UNVERIFIED, and a regression can reach whatever delivery mode you chose.",
};

export function SafetySection({ dials, onChange }: SetupSectionProps) {
  const off = dials.verifyMode === "off";
  return (
    <SetupGroup title="Before each commit">
      <SetupRow label="Degradation guard" info={VERIFY_MECHANISM}>
        <Segmented
          ariaLabel="Degradation guard"
          testId="setup-verify-mode"
          value={dials.verifyMode}
          onChange={(v) => onChange("verifyMode", v)}
          options={VERIFY_MODES.map((m) => ({ value: m, label: VERIFY_LABELS[m] }))}
        />
      </SetupRow>
      <p className={`type-note leading-relaxed ${off ? "text-warn" : "text-slate-500"}`}>{VERIFY_CONSEQUENCE[dials.verifyMode]}</p>
      <SetupRow label="Check budget" info="The ceiling on ONE run of the repository's own check. Past half an hour the guard costs more than the cycle it protects.">
        <ChoiceList
          ariaLabel="Check budget"
          testId="setup-verify-minutes"
          value={dials.verifyMinutes}
          disabled={off}
          onChange={(raw) => onChange("verifyMinutes", Number(raw))}
          options={minuteSteps(VERIFY_TIMEOUT_CAP_MS).map((m) => ({ value: m, label: `${m} min` }))}
        />
      </SetupRow>
    </SetupGroup>
  );
}

export function DeliverySection({ dials, onChange, prAvailable = true }: SetupSectionProps & { prAvailable?: boolean }) {
  return (
    <SetupGroup title="When a lane finishes">
      <SetupRow
        label="Delivery"
        info="The loop commits each lane to its own throwaway ascent/loop-… branch. A 21-run campaign measured what leaving it there costs: every run's worktree is cut from the same unchanged HEAD, so the loop rediscovered and rewrote the same fix run after run."
      >
        <Segmented
          ariaLabel="When a lane finishes"
          testId="setup-delivery"
          value={dials.delivery}
          onChange={(v) => onChange("delivery", v as LoopDelivery)}
          options={LOOP_DELIVERIES.map((d) => ({
            value: d,
            label: DELIVERY_LABELS[d],
            disabled: d === "pr" && !prAvailable,
            title: d === "pr" && !prAvailable ? "Needs the GitHub App" : undefined,
          }))}
        />
      </SetupRow>
      <p className="type-note leading-relaxed text-slate-500">
        {DELIVERY_HINTS[dials.delivery]}
        {dials.delivery === "pr" && !prAvailable && <span className="ml-1 text-warn">This deployment has no GitHub App, so this mode is unavailable.</span>}
      </p>
    </SetupGroup>
  );
}
