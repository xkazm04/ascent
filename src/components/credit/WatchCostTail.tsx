"use client";

import { isUnderAMonth } from "@/lib/credit-estimate";

/**
 * The shared tail of the watch/schedule cost-disclosure line: the `· unlimited plan` / `· balance: N`
 * fragment plus the "covers under a month" warning. Rendered inline inside the disclosure `<p>` on
 * both the connect repo list and the onboarding select step, which previously hand-rolled byte-identical
 * copies of this markup. Returns a fragment so the surrounding sentence reads unchanged.
 */
export function WatchCostTail({
  credit,
  monthlyCredits,
}: {
  credit: { balance: number; unlimited: boolean } | null;
  monthlyCredits: number;
}) {
  return (
    <>
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
        <span className="text-warn"> — covers under a month; autoscans pause at zero</span>
      )}
    </>
  );
}
