"use client";

import { useId, useSyncExternalStore } from "react";
import { importWatchMonthlyCredits } from "@/components/onboarding/importCost";
import { IMPORT_WATCH_SCHEDULE } from "@/components/onboarding/importScan";
import {
  getAutoWatchOptIn,
  setAutoWatchOptIn,
  subscribeAutoWatchOptIn,
} from "@/components/onboarding/OnboardingSelectStep.watchOptIn";
import { CREDIT_ESTIMATE_NOTE } from "@/lib/credit-estimate";
import { immediateScanCredits, WatchCostTail } from "@/components/credit/WatchCostTail";

/**
 * Cost disclosure AT the commitment button, plus the recurring-autoscan OPT-IN.
 *
 * Extracted from OnboardingSelectStep so that file stays well inside the 300-LOC cap (AGENTS.md).
 * Two behaviors it owns:
 *
 *  1. The immediate draw. The click scans every selected repo NOW — one prepaid credit each beyond the
 *     free monthly allowance — which the old copy never mentioned; it priced only the recurring month.
 *  2. The weekly autoscan is now OPT-IN. It used to be committed unconditionally (`watch:true`,
 *     `schedule:"weekly"`), so the recurring cost was disclosed but never consented to.
 *
 * Metered App path ONLY. Scanning a public handle (no installation) forces a preview (mock): it sets no
 * credit account and is never metered, so quoting prepaid credits there is money confusion that scares
 * users off the free top-of-funnel.
 */
export function ScanCostDisclosure({
  count,
  sourceInstallId,
  credit,
}: {
  count: number;
  sourceInstallId: string | null;
  /** Prepaid balance for the source org (App path only) — null when the balance couldn't be read. */
  credit: { balance: number; unlimited: boolean; allowanceRemaining?: number | null } | null;
}) {
  // The checkbox renders from the SAME store startScan reads, so the disclosed commitment and the
  // committed request can't drift. Server snapshot is the safe default (false).
  const optedIn = useSyncExternalStore(subscribeAutoWatchOptIn, getAutoWatchOptIn, () => false);
  const toggleId = useId();

  if (count === 0) return null;

  if (!sourceInstallId) {
    return (
      <p className="mt-3 max-w-xl text-sm text-slate-500">
        Free preview — no prepaid credits are used. Install the GitHub App to run metered live scans on
        your own public &amp; private repos.
      </p>
    );
  }

  // Net the org's included free monthly scans, exactly as canRunReal does when it qualifies this org for
  // a real scan — otherwise a qualifying Free-tier org sees an inflated "pauses at zero" alarm at the
  // exact moment it would convert. Zero when nothing recurring was opted into.
  const monthlyCredits = optedIn ? importWatchMonthlyCredits(count, credit?.allowanceRemaining ?? 0) : 0;
  const immediate = immediateScanCredits(count, credit);
  const repoPhrase = count === 1 ? "this repo" : `these ${count} repos`;

  return (
    <div className="mt-3 max-w-xl space-y-2">
      <label htmlFor={toggleId} className="flex cursor-pointer items-start gap-2 text-sm text-slate-400">
        <input
          id={toggleId}
          type="checkbox"
          checked={optedIn}
          onChange={(e) => setAutoWatchOptIn(e.target.checked)}
          className="focus-ring mt-0.5 h-4 w-4 accent-accent"
        />
        <span>
          Also autoscan {repoPhrase} {IMPORT_WATCH_SCHEDULE} — a recurring credit draw you can change or
          turn off anytime on Connect.
        </span>
      </label>
      <p className="text-sm text-slate-500" title={CREDIT_ESTIMATE_NOTE}>
        {optedIn ? (
          <>
            {IMPORT_WATCH_SCHEDULE[0]?.toUpperCase()}
            {IMPORT_WATCH_SCHEDULE.slice(1)} autoscan of {repoPhrase} ≈{" "}
            <span className="font-mono text-slate-300">{monthlyCredits}</span> prepaid credit
            {monthlyCredits === 1 ? "" : "s"}/month
          </>
        ) : (
          <>One-time scan — no recurring autoscan is set up</>
        )}
        <WatchCostTail credit={credit} monthlyCredits={monthlyCredits} immediateCredits={immediate} />.
      </p>
    </div>
  );
}
