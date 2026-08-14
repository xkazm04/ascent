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
// HERE, beside segmentDeleteConfirm; do not scatter the wording into the call sites.
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

/** Opening a draft PR writes a real branch + commit into the CUSTOMER's repo and files a pull request —
 *  a side effect the repo owner sees, not a local change. Name the repo and say what's being seeded.
 *  tone "default" (accent, not red): recoverable — the PR can be closed — but never silent. Shared by
 *  the playbook card and the backlog row (both seed a starter file into one repo). */
export function draftPrConfirm(repo: string, seeds: string): ConfirmSpec {
  return {
    kicker: "Open draft PR",
    title: `Open a draft PR in ${repo}?`,
    body: `This writes a new branch and commit into ${repo} and opens a real draft pull request seeding ${seeds}. It's visible to the repo's owners: recoverable (you can close the PR), but not a local-only change.`,
    confirmLabel: "Open draft PR",
    tone: "default",
  };
}

/** The fleet batch fans "open draft PR" across many repos of ONE org in a single click. State how many
 *  PRs actually open (the server caps each batch at `cap` and keeps the neediest-first repos), and warn
 *  when the selection exceeds the cap so "23 selected → 25 cap" isn't read as full coverage. tone
 *  "default": each PR is closeable, but this is the most expensive button in the app — name the count. */
export function batchPrConfirm(selectedCount: number, cap: number, org: string): ConfirmSpec {
  const n = Math.min(selectedCount, cap);
  const over =
    selectedCount > cap
      ? ` Only the first ${cap} of ${selectedCount} selected open this run. The rest exceed the per-batch cap; re-run to open them.`
      : "";
  return {
    kicker: "Fleet rollout",
    title: `Open ${n} draft ${plural(n, "PR")} across ${n} ${org} ${plural(n, "repo", "repos")}?`,
    body: `This opens a real draft pull request in ${n} ${plural(n, "repository", "repositories")} under ${org}, each writing its own branch and commit. Each repo's starter content is generated for that repo at apply time; it is not individually previewed.${over} Every repo's owners see it: recoverable per PR, but ${n} at once.`,
    confirmLabel: `Open ${n} ${plural(n, "PR")}`,
    tone: "default",
  };
}

/** "Re-test" spends one slot from the org's weekly scan quota to re-score a repo against its latest
 *  commit. It's free when the repo is unchanged (a 304 serves the cached scan), but a moved repo runs —
 *  and bills — a full re-score, so one click can silently burn a slot. tone "default": recoverable but
 *  metered. Name the repo. */
export function retestConfirm(repo: string): ConfirmSpec {
  return {
    kicker: "Re-test",
    title: `Re-scan ${repo}?`,
    body: `This spends one slot from your weekly scan quota to re-score ${repo} against its latest commit. It's free if nothing changed since the last scan, but a moved repo runs (and bills) a full re-score.`,
    confirmLabel: "Re-scan now",
    tone: "default",
  };
}

/** Goal delete is a HARD delete: the goal and its achievement history (the recorded milestones and the
 *  date it was met) go with it — no soft-delete, no undo. tone "danger" (red): irreversible data loss.
 *  Name the goal. */
export function goalDeleteConfirm(label: string): ConfirmSpec {
  return {
    kicker: "Delete goal",
    title: `Delete the "${label}" goal?`,
    body: `This permanently deletes the goal and its achievement history: the milestones it recorded and the date it was met. This can't be undone.`,
    confirmLabel: "Delete goal",
    tone: "danger",
  };
}
