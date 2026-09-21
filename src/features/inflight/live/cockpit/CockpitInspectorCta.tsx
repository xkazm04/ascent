"use client";

// THE INSPECTOR'S CALL TO ACTION — Run, Drive, the standing runner, or the one sentence saying why
// none is offered.
//
// Extracted from CockpitInspector (pure relocation, no behaviour change) so that file stays what its
// header claims: selection → proposal → CTA, with the proposal machinery in between and none of the
// button markup. The ordering rule is unchanged and still deliberate: `blockedReason` (or a missing
// owner role) REPLACES every button rather than disabling it, because a control that 403s on click
// is worse than one that is not there.
//
// `armBlock` IS THE OTHER SHAPE, and it is disabled-with-a-reason rather than replaced, deliberately:
// a refused preflight probe or a half-typed arm is something the operator fixes in the gear dialog in
// seconds, and removing the button would hide the very thing they are trying to reach. The sentence
// is rendered beside the disabled buttons and referenced by them (`aria-describedby`), so the reason
// is reachable both by eye and by a screen reader — never a silently dead control.

import { RUNNER_BRANCH } from "@/lib/local/runner-types";

export interface CockpitInspectorCtaProps {
  /** Selected repos that actually have a local pairing — the only ones a lane can run in. */
  runnable: number;
  /** The drive's rope, echoed in its caption so the operator sees the bound they set. */
  maxRuns: number;
  onRun: () => void;
  onDrive: () => void;
  /** Open the setup dialog in runner mode. Absent = no runner CTA. */
  onRunner?: () => void;
  canRun: boolean;
  canDrive: boolean;
  blockedReason: string | null;
  /** Why this ARMED CONFIGURATION may not depart (`armStartBlock`), or null. Disables every start —
   *  including the runner's, which spends against a daily ceiling on the same unproven transport. */
  armBlock?: string | null;
  busy: boolean;
  error: string | null;
}

/** The third CTA. It opens the dialog (hence the ellipsis): the runner starts there, ceiling in view. */
export function RunnerCta({ onClick, busy, armBlock = null }: { onClick: () => void; busy: boolean; armBlock?: string | null }) {
  return (
    <>
      <button
        type="button"
        data-testid="runner-cta"
        onClick={onClick}
        aria-describedby={armBlock ? ARM_BLOCK_ID : undefined}
        disabled={busy || armBlock != null}
        className="focus-ring mt-2 w-full rounded-md border border-divider px-3 py-2 type-label tracking-[0.18em] text-slate-300 transition hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Start standing runner…
      </button>
      <p className="mt-1.5 type-note leading-relaxed text-slate-500">
        Runs until you stop it, landing verified work on each repo&apos;s {RUNNER_BRANCH} branch — never on yours.
      </p>
    </>
  );
}

/** The one place the refusal sentence lives, so every disabled button can point at it. */
const ARM_BLOCK_ID = "cockpit-arm-block";

export function ArmBlockNote({ reason }: { reason: string }) {
  return (
    <p id={ARM_BLOCK_ID} data-testid="arm-block" role="status" className="mt-3 type-caption leading-relaxed text-warn">
      {reason}
    </p>
  );
}

export function CockpitInspectorCta(p: CockpitInspectorCtaProps) {
  const armBlock = p.armBlock ?? null;
  if (p.blockedReason || !p.canRun) {
    return (
      <>
        <p className="mt-4 type-caption text-slate-500">{p.blockedReason ?? "Running the loop needs org-owner access."}</p>
        {p.error && <p className="mt-3 type-caption text-danger">{p.error}</p>}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={p.onRun}
        aria-describedby={armBlock ? ARM_BLOCK_ID : undefined}
        disabled={p.busy || p.runnable === 0 || armBlock != null}
        className="focus-ring mt-4 w-full rounded-md bg-accent px-3 py-2 type-label tracking-[0.18em] text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        {p.runnable === 0 ? "No paired repos selected" : `Run (${p.runnable} ${p.runnable === 1 ? "repo" : "repos"})`}
      </button>
      {p.canDrive && (
        <>
          <button
            type="button"
            onClick={p.onDrive}
            aria-describedby={armBlock ? ARM_BLOCK_ID : undefined}
            disabled={p.busy || p.runnable === 0 || armBlock != null}
            className="focus-ring mt-2 w-full rounded-md border border-accent/60 px-3 py-2 type-label tracking-[0.18em] text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Drive to green
          </button>
          <p className="mt-1.5 type-note leading-relaxed text-slate-500">
            Runs again and again until every selected repo clears the band, a whole run moves nothing, or the {p.maxRuns}-run
            budget is spent.
          </p>
        </>
      )}
      {p.canDrive && p.onRunner && <RunnerCta onClick={p.onRunner} busy={p.busy} armBlock={armBlock} />}
      {armBlock && <ArmBlockNote reason={armBlock} />}
      {p.error && <p className="mt-3 type-caption text-danger">{p.error}</p>}
    </>
  );
}
