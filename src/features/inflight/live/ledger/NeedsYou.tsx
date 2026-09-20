// "Needs you" — the approval inbox and every pause only a person lifts, in one section. The briefing's
// "waits for your approval" and "paused now" lines both anchor here.

import { LedgerSectionHeader } from "./LedgerSectionHeader";
import { LEDGER_ANCHOR } from "./ledgerModel";
import { PausedRepos } from "./PausedRepos";
import { PlanInbox } from "./PlanInbox";
import type { DriveStatus, LoopDirectionRecord, LoopPlanRecord } from "./ledgerTypes";

export function NeedsYou({
  slug,
  pending,
  runner,
  now,
  isOwner,
  onDecided,
  onResumed,
}: {
  slug: string;
  /** Null = the inbox could not be read, which is said — never shown as an empty inbox. */
  pending: readonly LoopPlanRecord[] | null;
  runner: DriveStatus | null;
  now: string;
  isOwner: boolean;
  onDecided: (plan: LoopPlanRecord, direction: LoopDirectionRecord | null) => void;
  onResumed: (drive: DriveStatus) => void;
}) {
  return (
    <section id={LEDGER_ANCHOR.needsYou} aria-labelledby="ledger-needs-you-h" className="scroll-mt-24 space-y-3">
      <LedgerSectionHeader
        id="ledger-needs-you-h"
        title="Needs you"
        count={pending && pending.length > 0 ? `${pending.length} waiting` : null}
        about={
          isOwner
            ? "Plans that would move architecture wait here for a verdict; everything else the runner decides for itself."
            : "Plans that would move architecture wait here for an owner's verdict. You can read every one."
        }
      />
      <PausedRepos slug={slug} runner={runner} now={now} isOwner={isOwner} onResumed={onResumed} />
      {pending == null ? (
        <p role="alert" className="type-body-sm text-warn">
          Could not read the pending plans — this is not an empty inbox. Reload to try again.
        </p>
      ) : (
        <PlanInbox plans={pending} now={now} isOwner={isOwner} onDecided={onDecided} />
      )}
    </section>
  );
}
