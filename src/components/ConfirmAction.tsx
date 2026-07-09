"use client";

// Shared "are you REALLY sure" gate for one-click destructive / expensive actions. Several controls in
// the org surfaces sit one misclick away from an irreversible or costly outcome with no friction. This
// is the ONE confirm they route through.
//
// WIRED TODAY: the segment `×`, which wipes the segment AND every RepoSegment tag on a single misclick
// (the button sits one pixel from the ✎ edit control). The remaining unguarded sites -- "Open draft PR"
// (writes a real branch+commit+PR into a customer repo), the fleet batch (fans that across up to 25
// repos), "Re-test" (spends a weekly scan slot) and goal delete -- are tracked in
// docs/harness/bug-ui-scan-2026-07-09/INDEX.md theme T13. Add their copy builders HERE, beside
// segmentDeleteConfirm, when wiring them; do not scatter the wording into the call sites.
//
// Built on the brand Modal (app-root portal, focus trap, Escape/backdrop close, focus restore, body
// scroll lock, and `locked`-while-busy so a half-finished write is read not dismissed) rather than the
// blocking browser `confirm()` — which can't be themed, announced, or state the scope/impact. The one
// thing this adds on top of Modal: initial focus lands on CANCEL, never the destructive Confirm, so a
// stray Enter dismisses instead of fires. The copy each caller passes must state WHAT happens and HOW
// MANY things it affects (name the repo(s), count the tags) — the pure builders at the bottom do that.

import { useEffect, useRef } from "react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui";

export type ConfirmTone = "danger" | "default";

/** The copy + styling for one confirm prompt. The pure builders below return this; callers spread it
 *  straight into <ConfirmAction {...spec} …/>. */
export interface ConfirmSpec {
  title: string;
  /** What will happen and how many things it affects — never "Are you sure?". */
  body: string;
  confirmLabel: string;
  /** "danger" = irreversible data loss (red confirm); "default" = expensive/side-effectful (accent). */
  tone: ConfirmTone;
  kicker?: string;
}

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
 * The dialog's inner content — deliberately hook-free so it can be invoked directly and walked as a
 * React element tree in tests (no jsdom in this repo; see EmptyState.test.tsx). All state/focus lives
 * in the ConfirmAction wrapper below. `cancelRef` is threaded so the wrapper can move focus to Cancel.
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
        <p className="text-base text-slate-300">{body}</p>
      </ModalBody>
      <ModalFooter>
        <span className="font-mono text-xs text-slate-500">Esc or Cancel to back out</span>
        <div className="flex items-center gap-2">
          <button
            ref={cancelRef}
            type="button"
            // Cancel is the default focus (see the wrapper's effect) + the browser autofocus fallback,
            // so a keyboard user who hits Enter dismisses rather than triggers the destructive action.
            autoFocus
            onClick={onCancel}
            disabled={busy}
            className="focus-ring rounded-lg border border-slate-700 px-4 py-2 font-mono text-sm text-slate-200 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`focus-ring rounded-lg px-4 py-2 font-mono text-sm font-semibold transition disabled:opacity-50 ${CONFIRM_CLASS[tone]}`}
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

// ── Pure copy builders — each states WHAT happens and HOW MANY things it affects ─────────────────────
// Kept here (not at the call sites) so the wording is one place and unit-testable without a DOM.

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Segment delete wipes the segment AND every RepoSegment tag row (which also feed the Overview filter
 *  and the comparison view). Name the segment; count the tags going with it. */
export function segmentDeleteConfirm(name: string, tagCount: number): ConfirmSpec {
  const tags = tagCount > 0 ? ` and removes its ${tagCount} repo ${plural(tagCount, "tag")}` : "";
  return {
    kicker: "Delete segment",
    title: `Delete the "${name}" segment?`,
    body: `This permanently deletes the segment${tags}. Those tags also drive the Overview filter and segment comparison. This can't be undone.`,
    confirmLabel: "Delete segment",
    tone: "danger",
  };
}
