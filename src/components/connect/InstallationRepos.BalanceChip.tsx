import { UNLIMITED_PLAN_LABEL } from "@/lib/plans";
import type { CreditInfo } from "./InstallationRepos.CreditCostStrip";

/**
 * Prepaid-credit balance at the connect screen's commitment point.
 *
 * The gap it closes: this is the one screen where a user can flip EVERY private repo to a recurring
 * autoscan, and it showed no balance anywhere — the number only existed on the org dashboard's
 * CreditsControl, one navigation away from the decision. The chip sits in the list header, inline with
 * "N of M watched" and the dashboard link, so it reads as list context rather than turning the connect
 * page into a billing surface.
 *
 * Deliberately NOT a second CreditsControl: no popover, no top-up, no fetch of its own (the balance is
 * the one `useInstallationRepos` already reads). It borrows CreditsControl's visual language —
 * `{balance} credits` in a bordered mono chip, the emerald "Credits · Unlimited" variant, the amber
 * paused variant with a non-color cue — so the two surfaces read as the same object.
 *
 * Degradation: `credit` is null until a balance is successfully read, and stays null for an anonymous /
 * DB-less / no-access viewer (the fetch failure path just leaves it null). Rendering nothing in that
 * case is the point — no "NaN credits", and no flash of a zero balance the viewer doesn't actually have.
 */
export function BalanceChip({ credit }: { credit: CreditInfo | null }) {
  if (!credit) return null;

  if (credit.unlimited) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 font-mono text-sm text-emerald-300"
        title={`${UNLIMITED_PLAN_LABEL} plan — private scans are unlimited`}
      >
        Credits · Unlimited
        <span className="sr-only">— {UNLIMITED_PLAN_LABEL} plan, private scans are unlimited</span>
      </span>
    );
  }

  // A 0 prepaid balance only PAUSES scanning when the monthly free allowance is also spent — while the
  // allowance covers scans, consumeScanCredit charges nothing, so "paused" would be a false alarm.
  const freeScansLeft = Math.max(0, credit.allowanceRemaining);
  const paused = credit.balance <= 0 && freeScansLeft <= 0;

  return (
    <span
      // WCAG 1.4.1: the paused state carries a glyph + word, not the amber tint alone.
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-sm ${
        paused ? "border-amber-500/50 bg-amber-500/10 text-amber-300" : "border-slate-700 text-slate-300"
      }`}
      title="Prepaid private-scan credits — each autoscan run draws one beyond your free monthly allowance"
    >
      <span className="font-semibold">{credit.balance}</span> credits
      {paused ? (
        <>
          <span aria-hidden>⚠</span> paused
          <span className="sr-only">— out of credits, private scanning paused</span>
        </>
      ) : (
        <span className="sr-only">
          prepaid private-scan credits{freeScansLeft > 0 ? `, plus ${freeScansLeft} free scans left this month` : ""}
        </span>
      )}
      {!paused && freeScansLeft > 0 && (
        <span aria-hidden className="text-slate-500">+{freeScansLeft} free</span>
      )}
    </span>
  );
}
