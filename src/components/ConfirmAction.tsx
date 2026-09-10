"use client";

// Shared "are you REALLY sure" gate for one-click destructive / expensive actions. Several controls in
// the org surfaces sit one misclick away from an irreversible or costly outcome with no friction. This
// is the ONE confirm they route through.
//
// WIRED: the segment `×` (wipes the segment AND every RepoSegment tag on a single misclick, the button
// sits one pixel from the ✎ edit control); "Open draft PR" on a playbook card and a backlog row (each
// writes a real branch+commit+PR into a customer repo — draftPrConfirm); the practice fleet batch (fans
// that across up to MAX_BATCH repos at once — batchPrConfirm); "Re-test" (spends a weekly scan slot —
// retestConfirm); and goal delete (hard-deletes the goal + its achievement history — goalDeleteConfirm).
// These were the T13 cluster in docs/harness/bug-ui-scan-2026-07-09/INDEX.md. ALL copy builders live
// in confirmCopy.ts; do not scatter the wording into the call sites.
//
// Built on the brand Modal (app-root portal, focus trap, Escape/backdrop close, focus restore, body
// scroll lock, and `locked`-while-busy so a half-finished write is read not dismissed) rather than the
// blocking browser `confirm()` — which can't be themed, announced, or state the scope/impact. The one
// thing this adds on top of Modal: initial focus lands on CANCEL, never the destructive Confirm, so a
// stray Enter dismisses instead of fires. The copy each caller passes must state WHAT happens and HOW
// MANY things it affects (name the repo(s), count the tags) — the pure builders in confirmCopy.ts do that.

import { useEffect, useRef } from "react";
import type { ConfirmSpec, ConfirmTone } from "./confirmCopy";
export { segmentDeleteConfirm, draftPrConfirm, batchPrConfirm, retestConfirm, goalDeleteConfirm, type ConfirmSpec, type ConfirmTone } from "./confirmCopy";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui";

export interface ConfirmActionProps extends Partial<Pick<ConfirmSpec, "kicker" | "tone">> {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** An operation is in flight — both buttons disable and the dialog refuses to close. */
  busy?: boolean;
}

const CONFIRM_CLASS: Record<ConfirmTone, string> = {
  // #ef4444 danger token for irreversible loss; accent for expensive-but-recoverable writes.
  danger: "bg-danger text-white hover:bg-danger/90",
  default: "bg-accent text-on-accent hover:bg-accent-soft",
};

/**
 * The dialog's presentational content, also exposed for focused DOM tests. The wrapper below owns
 * state and focus; `cancelRef` connects its focus effect to the Cancel control.
 */
export function ConfirmActionContent({
  title,
  body,
  confirmLabel,
  tone = "danger",
  busy = false,
  kicker,
  cancelRef,
  onConfirm,
  onCancel,
}: Omit<ConfirmActionProps, "open"> & { cancelRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <>
      <ModalHeader kicker={kicker ?? "Confirm"} title={title} />
      <ModalBody>
        <p className="type-body text-slate-300">{body}</p>
      </ModalBody>
      <ModalFooter>
        <span className="type-caption text-slate-500">Esc or Cancel to back out</span>
        <div className="flex items-center gap-2">
          <button
            ref={cancelRef}
            type="button"
            // Cancel is the default focus (see the wrapper's effect) + the browser autofocus fallback,
            // so a keyboard user who hits Enter dismisses rather than triggers the destructive action.
            autoFocus
            onClick={onCancel}
            disabled={busy}
            className="focus-ring rounded-lg border border-slate-700 px-4 py-2 type-mono-sm text-slate-200 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`focus-ring rounded-lg px-4 py-2 type-mono-sm font-semibold transition disabled:opacity-50 ${CONFIRM_CLASS[tone]}`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </ModalFooter>
    </>
  );
}

/**
 * The confirm dialog. Keep it ALWAYS mounted at the call site and toggle `open` (rather than
 * conditionally mounting it) so Modal's portal is armed before `open` flips true and the Cancel-focus
 * effect can land.
 */
export function ConfirmAction({ open, busy = false, onCancel, ...rest }: ConfirmActionProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Modal focuses its own panel on open; this parent effect runs AFTER Modal's child effect, so moving
  // focus to Cancel here wins — the destructive Confirm is never the initial focus target.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <Modal open={open} onClose={onCancel} locked={busy} ariaLabel={rest.title}>
      <ConfirmActionContent {...rest} busy={busy} onCancel={onCancel} cancelRef={cancelRef} />
    </Modal>
  );
}
