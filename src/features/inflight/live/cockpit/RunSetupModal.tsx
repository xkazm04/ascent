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
// THE FOOTER PRINTS WHAT IS ARMED. The dialog is dismissable from three places and the values persist
// for the session, so the last thing it says is the configuration itself — the same line the gear's
// tooltip carries, so closing the dialog does not mean losing sight of what you set.

import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { AgentSection, SessionSection, WorkSection } from "./RunSetupSections";
import { DeliverySection, SafetySection } from "./RunSetupSafety";
import type { RunDials } from "./useRunDials";

/** One line naming the armed configuration — the dialog's footer and the gear's own title. */
export function dialsSummary(d: RunDials): string {
  return [
    d.dimFocus ? `focus ${d.dimFocus}` : "all dimensions",
    `${d.batchSize} item${d.batchSize === 1 ? "" : "s"}/lane`,
    `${d.concurrency} lane${d.concurrency === 1 ? "" : "s"}`,
    `${d.cycles} cycle${d.cycles === 1 ? "" : "s"}`,
    d.model ?? "default model",
    d.effort ? `${d.effort} effort` : "default effort",
    d.verifyMode === "on" ? "verified" : "unverified",
    d.delivery,
  ].join(" · ");
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
}

export function RunSetupModal({ open, onClose, dials, onChange, dims, prAvailable = true }: RunSetupModalProps) {
  return (
    <Modal open={open} onClose={onClose} ariaLabel="Run setup" size="xl">
      <ModalHeader
        kicker="Run setup"
        title="How this run works"
        context="Every value is remembered for this session and travels with both Run and Drive."
      />
      <ModalBody className="max-h-[70vh] overflow-y-auto">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-6">
            <WorkSection dials={dials} onChange={onChange} dims={dims} />
            <SessionSection dials={dials} onChange={onChange} />
          </div>
          <div className="space-y-6">
            <AgentSection dials={dials} onChange={onChange} />
            <SafetySection dials={dials} onChange={onChange} />
            <DeliverySection dials={dials} onChange={onChange} prAvailable={prAvailable} />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <span className="type-mono-sm min-w-0 truncate text-slate-500" data-testid="setup-summary">
          {dialsSummary(dials)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="focus-ring shrink-0 rounded-lg bg-accent px-4 py-1.5 type-body-sm font-semibold text-on-accent transition hover:bg-accent-soft"
        >
          Done
        </button>
      </ModalFooter>
    </Modal>
  );
}
