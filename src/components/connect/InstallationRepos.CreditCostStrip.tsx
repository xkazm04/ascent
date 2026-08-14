import { CREDIT_ESTIMATE_NOTE } from "@/lib/credit-estimate";

interface CreditInfo {
  balance: number;
  unlimited: boolean;
  /** Included free monthly scans still available — the estimate nets these out before charging credits. */
  allowanceRemaining: number;
}

/** Cost/quota context at the moment of commitment: schedules below are billable units, so
 *  say what they add up to — and what's in the tank — before the cron finds out. Hidden
 *  when nothing is scheduled and no balance could be read (e.g. DB-less local). */
export function CreditCostStrip({
  credit,
  scheduledCount,
  scheduledRuns,
  monthlyCredits,
  allowanceRemaining,
  underAMonth,
}: {
  credit: CreditInfo | null;
  scheduledCount: number;
  scheduledRuns: number;
  monthlyCredits: number;
  allowanceRemaining: number;
  underAMonth: boolean;
}) {
  if (!(scheduledRuns > 0 || (credit != null && !credit.unlimited))) return null;
  return (
    <p className="-mt-2 mb-3 text-sm text-slate-500">
      {scheduledCount > 0 ? (
        <>
          {scheduledCount} scheduled autoscan{scheduledCount === 1 ? "" : "s"} ≈{" "}
          <span className="font-mono text-slate-300">{scheduledRuns}</span> run
          {scheduledRuns === 1 ? "" : "s"}/month →{" "}
          <span className="font-mono text-slate-300">{monthlyCredits}</span> credit
          {monthlyCredits === 1 ? "" : "s"}/month
          {allowanceRemaining > 0 && (
            <> (after {allowanceRemaining} free scan{allowanceRemaining === 1 ? "" : "s"} left this month)</>
          )}
        </>
      ) : (
        <>Each scheduled autoscan run draws 1 prepaid credit beyond your free monthly allowance</>
      )}
      {credit != null &&
        (credit.unlimited ? (
          <> · unlimited plan</>
        ) : (
          <>
            {" "}
            · balance: <span className="font-mono text-slate-300">{credit.balance}</span>
          </>
        ))}
      {underAMonth && (
        <span className="text-warn"> (covers under a month; autoscans pause at zero)</span>
      )}
      {/* The estimate's basis + refund semantics, VISIBLE fine print. It previously lived only in a
          `title` tooltip on this non-interactive <p> — which never fires for keyboard users, doesn't
          exist on touch, and is unreliably exposed to screen readers — so most users read the figure
          as an exact charge (WCAG 1.4.13). One sentence: inline it for everyone. */}
      <span className="block text-xs text-slate-600">{CREDIT_ESTIMATE_NOTE}</span>
    </p>
  );
}

export type { CreditInfo };
