"use client";

import { isUnderAMonth } from "@/lib/credit-estimate";

/**
 * Credits the CLICK ITSELF draws — the immediate, one-off charge, as distinct from the recurring
 * monthly watch cost the rest of this tail describes.
 *
 * A metered import reserves ONE prepaid credit per repo BEFORE scanning it
 * (`reserveScanCredit`, src/lib/scan-credit.ts), and the route's capacity is
 * `balance + allowanceRemaining` (src/app/api/org/import/route.ts) — within-allowance scans are
 * charged to the free monthly allowance and debit nothing (`ScanCreditReservation.reserved` is
 * `res.charged`). So the immediate draw for `count` repos is `count` minus whatever free monthly
 * scans are still available. It is an UPPER bound: runs that degrade to mock or dedupe to an
 * unchanged commit are refunded.
 *
 * Returns `null` when the figure must not be stated at all:
 *   - no readable credit object → the scan will run as a disclosed PREVIEW (canRunRealScan fails
 *     closed without a credit read), which draws nothing; quoting a number would be wrong AND
 *     would flash a fabricated cost at an anonymous / DB-less viewer.
 *   - `unlimited` → an Enterprise org is never charged per scan.
 */
export function immediateScanCredits(
  count: number,
  credit: { unlimited: boolean; allowanceRemaining?: number | null } | null,
): number | null {
  if (credit == null || credit.unlimited) return null;
  return Math.max(0, Math.max(0, count) - Math.max(0, credit.allowanceRemaining ?? 0));
}

/**
 * The shared tail of the watch/schedule cost-disclosure line: the immediate "draws up to N credits now"
 * fragment, the `· unlimited plan` / `· balance: N` fragment, and the "covers under a month" warning.
 * Rendered inline inside the disclosure `<p>` on both the connect repo list and the onboarding select
 * step, which previously hand-rolled byte-identical copies of this markup. Returns a fragment so the
 * surrounding sentence reads unchanged.
 *
 * `immediateCredits` closes the gap that the tail only ever priced the RECURRING month: the commit
 * click also fires a scan of every selected repo right now, one credit each beyond the free allowance,
 * and that draw was disclosed nowhere. Pass `immediateScanCredits(count, credit)`; `null` (unknown
 * balance / unlimited / a free preview) omits the fragment entirely rather than guessing.
 */
export function WatchCostTail({
  credit,
  monthlyCredits,
  immediateCredits = null,
}: {
  credit: { balance: number; unlimited: boolean } | null;
  monthlyCredits: number;
  /** Credits this click draws immediately (see `immediateScanCredits`). `null` hides the fragment. */
  immediateCredits?: number | null;
}) {
  return (
    <>
      {immediateCredits != null &&
        (immediateCredits > 0 ? (
          <>
            {" "}
            · this scan draws up to{" "}
            <span className="font-mono text-slate-300">{immediateCredits}</span> credit
            {immediateCredits === 1 ? "" : "s"} now
          </>
        ) : (
          <> · this scan is covered by your free monthly scans</>
        ))}
      {credit != null &&
        (credit.unlimited ? (
          <> · unlimited plan</>
        ) : (
          <>
            {" "}
            · balance: <span className="font-mono text-slate-300">{credit.balance}</span>
          </>
        ))}
      {isUnderAMonth(credit, monthlyCredits) && (
        <span className="text-warn"> (covers under a month; autoscans pause at zero)</span>
      )}
    </>
  );
}
