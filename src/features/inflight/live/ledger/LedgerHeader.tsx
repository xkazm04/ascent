// The ledger's masthead: the kicker, the runner's one line, and the view switch. No hooks — the line is
// a pure function of the load (`runnerStatus`), measured against the load's own clock.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { LiveViewSwitch } from "../LiveViewSwitch";
import { runnerStatus, type RunnerState } from "./ledgerModel";
import type { DriveStatus, LedgerActiveRun } from "./ledgerTypes";

const DOT: Record<RunnerState, string> = {
  running: "bg-success live-dot",
  paused: "bg-warn",
  idle: "bg-slate-500",
  none: "bg-slate-700",
};

export function LedgerHeader({
  slug,
  runner,
  activeRun,
  now,
  ledgerHref,
  cockpitHref,
}: {
  slug: string;
  runner: DriveStatus | null;
  activeRun: LedgerActiveRun | null;
  now: string;
  ledgerHref: string;
  cockpitHref: string;
}) {
  const status = runnerStatus(runner, activeRun, now);
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-divider pb-4">
      <div className="min-w-0 space-y-1.5">
        <Kicker>Ledger</Kicker>
        <p data-testid="ledger-runner-status" className="flex flex-wrap items-center gap-2 type-body text-slate-200">
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${DOT[status.state]}`} />
          <span title={runner?.pausedUntil ?? runner?.startedAt ?? undefined}>{status.text}</span>
          {status.state === "none" && (
            <>
              <span className="text-slate-500">—</span>
              <Link href={cockpitHref} className="focus-ring rounded text-accent hover:text-accent-soft">
                Start one from the Cockpit
              </Link>
            </>
          )}
        </p>
      </div>
      <LiveViewSwitch slug={slug} current="ledger" ledgerHref={ledgerHref} cockpitHref={cockpitHref} />
    </header>
  );
}
