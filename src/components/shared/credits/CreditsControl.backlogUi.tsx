"use client";

// credits-1: the popover's CREDIT BACKLOG section. "N watched repos missed a scan for credits since
// <date>" plus one action that resumes them through the EXISTING capped POST /api/org/scan { repos }
// (useOrgScanButton.run), the same route, the same per-repo reservation and the same cap as "Scan all
// watched". The draw is stated on the button BEFORE the click, with immediateScanCredits's arithmetic.
//
// The server sends the backlog only to a viewer who passes requireOrgAccess (the scan route's gate), so
// a read-only viewer never reaches this section. A backlog of 0 renders nothing: no empty-state noise
// on a healthy org.

import { useRef } from "react";
import type { CreditBacklog } from "@/lib/credit-backlog-model";
import { resumePlan } from "@/lib/credit-backlog-model";
import { useOrgScanButton } from "../scan/useOrgScanButton";

/** "Oct 3": a UTC day, so the server's ISO string reads the same in every viewer's zone. */
export function backlogDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The resume button's label: what it scans and what it draws, stated before the click. */
export function resumeLabel(count: number, drawsUpTo: number | null): string {
  if (drawsUpTo === null) return `Scan ${count} now`;
  if (drawsUpTo === 0) return `Scan ${count} now - covered by free monthly scans`;
  return `Scan ${count} now - draws up to ${drawsUpTo} ${drawsUpTo === 1 ? "credit" : "credits"}`;
}

type SectionProps = {
  org: string;
  backlog: CreditBacklog | null;
  balance: number;
  allowanceLeft: number;
  /** Called when the resume run ends, so the popover re-reads balance + backlog. */
  onSettled: () => void;
};

/** Renders nothing for a healthy org (or a viewer the server sent no backlog). The scan hook mounts
 *  only inside {@link BacklogBody}, so a popover with nothing owed never touches the router. */
export function CreditBacklogSection(props: SectionProps) {
  const { backlog } = props;
  if (!backlog || backlog.count === 0 || !backlog.oldestSkippedAt) return null;
  return <BacklogBody {...props} backlog={backlog} oldest={backlog.oldestSkippedAt} />;
}

function BacklogBody({
  org,
  backlog,
  oldest,
  balance,
  allowanceLeft,
  onSettled,
}: SectionProps & { backlog: CreditBacklog; oldest: string }) {
  const plan = resumePlan(backlog.repos, { balance, allowanceRemaining: allowanceLeft, unlimited: false });
  const { p, run } = useOrgScanButton(org, plan.repos.length);
  // A double click lands both clicks before the hook's `running` state re-renders; this latch makes the
  // second one a no-op, so one click is one run and one set of reservations.
  const started = useRef(false);

  const n = backlog.count;
  const blocked = plan.reason === "top-up-first";
  const inert = blocked || p.running;

  async function resume() {
    if (inert || started.current || plan.repos.length === 0) return;
    started.current = true;
    try {
      await run({ repos: plan.repos });
    } finally {
      started.current = false;
      onSettled();
    }
  }

  return (
    <div data-testid="credit-backlog" className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
      <p className="type-body-sm text-amber-200">
        {n} watched {n === 1 ? "repo" : "repos"} missed a scan for credits since {backlogDate(oldest)}.
        {" "}
        {blocked
          ? "Top up first, then resume them here."
          : plan.deferred > 0
            ? `${plan.deferred} more wait for credits.`
            : "They stay stale until they are scanned."}
      </p>
      <button
        type="button"
        onClick={resume}
        aria-disabled={inert}
        className={`focus-ring mt-2 w-full rounded-md border px-2.5 py-1.5 type-body-sm transition ${
          inert ? "cursor-not-allowed border-slate-700 text-slate-500" : "border-accent text-accent hover:bg-accent/10 hover:text-white"
        }`}
      >
        {blocked ? "Top up first" : resumeLabel(plan.repos.length, plan.drawsUpTo)}
      </button>
      {p.running && (
        <p className="mt-1 type-mono-sm text-slate-400" aria-live="polite">
          Scanning {p.done}/{p.total}
        </p>
      )}
      {p.error && (
        <p className="mt-1 type-body-sm text-danger" aria-live="polite">
          {p.error}
        </p>
      )}
    </div>
  );
}
