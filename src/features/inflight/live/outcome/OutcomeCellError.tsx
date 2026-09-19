"use client";

// A LANE FAILURE, AS A MARK RATHER THAN A PARAGRAPH.
//
// The engine writes its errors to be READ — they name the cycle, the stage that was in flight, what
// was cut loose and what is now orphaned. That is the right length for someone diagnosing a run and
// the wrong length for a spreadsheet cell: one FORCE-FAILED lane put sixty words of danger-red prose
// into a 168px column and pushed every other repository's row off the screen. Two of them made the
// sheet unreadable, and the sheet is the surface the whole outcome section exists for.
//
// So the cell keeps the SIGNAL (a red mark that cannot be missed, at a size that says "this is the
// thing that went wrong") and the dialog keeps the ACCOUNT, in full, verbatim, unclipped. Nothing is
// summarised away: `errorHeadline` only picks which clause titles the dialog, and the whole error
// string is printed inside it.
//
// The trigger is a real button with the failure's lead clause as its accessible name, so a screen
// reader hears WHAT failed on this repo before deciding whether to open it — an icon whose label is
// "error" would make that decision impossible without opening every one.

import { useState } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { errorHeadline } from "./outcomeText";

export function OutcomeCellError({ error, repo, stage }: { error: string; repo: string; stage?: string | null }) {
  const [open, setOpen] = useState(false);
  const headline = errorHeadline(error);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="cell-error"
        aria-label={`Lane failure on ${repo}: ${headline}`}
        title={headline}
        className="focus-ring mt-1 inline-flex items-center gap-1 rounded text-danger transition hover:text-danger/80"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinejoin="round" d="M12 3.6 1.9 20.4h20.2L12 3.6Z" />
          <path strokeLinecap="round" d="M12 9.5v4.4" />
          <circle cx="12" cy="17.1" r=".9" fill="currentColor" stroke="none" />
        </svg>
        <span className="type-micro font-mono uppercase tracking-wider">failed</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} ariaLabel={`Lane failure on ${repo}`} size="reading">
        <ModalHeader kicker="Lane failure" title={headline} context={stage ? `${repo} · cut at ${stage}` : repo} />
        <ModalBody>
          <p className="type-body whitespace-pre-wrap leading-relaxed text-slate-300">{error}</p>
        </ModalBody>
        <ModalFooter>
          <span className="type-note text-slate-500">
            What a failed lane produced is not committed, rescanned or delivered — this run&rsquo;s column says nothing about
            this repository because nothing was measured.
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="focus-ring shrink-0 rounded-lg border border-divider px-3 py-1.5 type-body-sm text-slate-300 transition hover:border-accent hover:text-white"
          >
            Close
          </button>
        </ModalFooter>
      </Modal>
    </>
  );
}
