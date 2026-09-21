"use client";

// RUN SETUP — the dials, in a dialog, reached from the gear in the cockpit masthead.
//
// WHY THEY LEFT THE RAIL. Ten dials and five standing paragraphs lived in the inspector, an 18rem
// column that also had to hold the selection, the shared-ground bars, the brief and the CTA. They did
// not fit and they did not belong: setup is something an operator does ONCE and then forgets, while
// the rail answers "what am I about to run, on what". A dialog is the right shape for an
// occasionally-visited form, and it buys the dials two columns to breathe in.
//
// NOTHING ABOUT THE ARMED RUN CHANGED. The same `RunDials` object, the same server-side caps, the same
// defaults — an operator who never opens this dialog arms exactly the run they would have armed
// before it existed. The dials live in `useCockpit` now rather than in the inspector, because two
// surfaces read them (this dialog writes, the inspector's CTA composes the request from them).
//
// THE MODE (2026-09-18). A choice at the top says what is being armed: Run, Drive to green, or the
// STANDING RUNNER. The runner swaps the right column for its own: scope and daily ceiling, then the
// two settings it forces (delivery, the guard) drawn as fixed values with their reasons — plus a
// read-only summary of what it does that nobody can change here. It is the one mode started FROM the
// dialog: it runs until stopped, so it starts with its ceiling in view.
//
// THE FOOTER PRINTS WHAT IS ARMED. The dialog is dismissable from three places and the values persist
// for the session, so the last thing it says is the configuration itself — the same line the gear's
// tooltip carries, so closing the dialog does not mean losing sight of what you set.

import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { RunnerForcedSection } from "./RunSetupForced";
import { ModeSection } from "./RunSetupMode";
import { RunnerDoes, RunnerSection } from "./RunSetupRunner";
import { DeliverySection, SafetySection } from "./RunSetupSafety";
import { AgentSection, SessionSection, WorkSection } from "./RunSetupSections";
import { dialsSummary } from "./setupSummary";
import { runnerStartInput } from "./startInputs";
import type { RunDials } from "./useRunDials";

export { dialsSummary };

/** What the dialog needs to START a standing runner. */
export interface RunnerSetup {
  /** The default scope as this page knows it: every watched repo with a paired checkout. */
  repos: readonly string[];
  /** The rail's runnable selection — the alternative scope. */
  selection: readonly string[];
  onStart: () => void;
  busy: boolean;
  /** The route's own refusal, verbatim. */
  error: string | null;
  /** Why a runner cannot start right now (a drive or runner is already on), else null. */
  blocked: string | null;
}

export interface RunSetupModalProps {
  open: boolean;
  onClose: () => void;
  dials: RunDials;
  onChange: <K extends keyof RunDials>(key: K, value: RunDials[K]) => void;
  /** The dimensions the current selection's proposals actually carry — the Focus dial's options. */
  dims: { id: string; label: string }[];
  /** False when this deployment has no GitHub App: "Open a PR" is DISABLED with the reason shown. */
  prAvailable?: boolean;
  /** Absent = the runner can be configured but not started from here (no Start button). */
  runner?: RunnerSetup;
}

const BUTTON = "focus-ring shrink-0 rounded-lg px-4 py-1.5 type-body-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";

export function RunSetupModal({ open, onClose, dials, onChange, dims, prAvailable = true, runner }: RunSetupModalProps) {
  const asRunner = dials.mode === "runner";
  const startable = runner != null && runnerStartInput(dials, runner.selection).ok && runner.blocked == null;
  return (
    <Modal open={open} onClose={onClose} ariaLabel="Run setup" size="xl" locked={asRunner && runner?.busy === true}>
      <ModalHeader
        kicker="Run setup"
        title={asRunner ? "How the standing runner works" : "How this run works"}
        context={
          asRunner
            ? "Every value is remembered for this session. The runner keeps them until you stop it."
            : "Every value is remembered for this session and travels with both Run and Drive."
        }
      />
      <ModalBody className="max-h-[70vh] overflow-y-auto">
        <ModeSection dials={dials} onChange={onChange} />
        {asRunner && <RunnerDoes />}
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="space-y-6">
            <WorkSection dials={dials} onChange={onChange} dims={dims} />
            <SessionSection dials={dials} onChange={onChange} />
          </div>
          <div className="space-y-6">
            {asRunner ? (
              <>
                <RunnerSection dials={dials} onChange={onChange} repos={runner?.repos ?? []} selection={runner?.selection ?? []} />
                <AgentSection dials={dials} onChange={onChange} />
                <RunnerForcedSection dials={dials} onChange={onChange} />
              </>
            ) : (
              <>
                <AgentSection dials={dials} onChange={onChange} />
                <SafetySection dials={dials} onChange={onChange} />
                <DeliverySection dials={dials} onChange={onChange} prAvailable={prAvailable} />
              </>
            )}
          </div>
        </div>
        {asRunner && runner?.blocked && <p className="mt-4 type-caption text-warn">{runner.blocked}</p>}
        {asRunner && runner?.error && (
          <p role="alert" className="mt-4 type-caption text-danger">
            {runner.error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <span className="type-mono-sm min-w-0 truncate text-slate-500" data-testid="setup-summary">
          {dialsSummary(dials)}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {asRunner && runner && (
            <button
              type="button"
              data-testid="setup-start-runner"
              onClick={runner.onStart}
              disabled={!startable || runner.busy}
              className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-soft`}
            >
              {runner.busy ? "Starting…" : "Start standing runner"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={asRunner && runner?.busy === true}
            className={asRunner && runner ? `${BUTTON} border border-divider text-slate-300 hover:border-accent` : `${BUTTON} bg-accent text-on-accent hover:bg-accent-soft`}
          >
            Done
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
