// Burn-vs-allotment utilization for /usage — "X of your monthly allotment this calendar month".
// The numerator is calendar-month metered usage (the same countMeteredScansThisMonth the charge
// resolver uses), not the page's selected ?days= billable-scan window and not a 30-day projection of
// that window. The allotment resets at 00:00 UTC on the 1st; a rolling 7/90/365-day rate is a
// different period and would move the meter when the timeframe picker moved. Server-safe (no hooks).
// Renders nothing for unlimited (Custom) plans, which have no finite allotment to size against.

import { planFeatures } from "@/lib/plans";
import { Meter } from "@/components/org/shared/ui";
import { Surface } from "@/components/ui";

/** Whether the org is idle (a smaller tier may fit), comfortable, or near the cap (top-up before the 402). */
export type AllotmentFit = "under" | "ok" | "over";

export interface AllotmentRead {
  label: string;
  included: number;
  /** Calendar-month-to-date metered scans — the same count the charge resolver compares to includedCredits. */
  usedThisMonth: number;
  /** usedThisMonth as a percentage of the included monthly allotment. */
  pct: number;
  fit: AllotmentFit;
}

/**
 * Pure right-sizing read: compare this calendar month's metered usage to the plan's included
 * monthly allotment. Returns null for plans with no finite allotment (Custom is unlimited).
 */
export function allotmentRead(plan: string, meteredThisMonth: number): AllotmentRead | null {
  const p = planFeatures(plan);
  if (p.unlimited || !p.includedCredits) return null;
  const included = p.includedCredits;
  const usedThisMonth = meteredThisMonth;
  const pct = included > 0 ? Math.round((usedThisMonth / included) * 100) : 0;
  const fit: AllotmentFit = pct > 90 ? "over" : usedThisMonth > 0 && pct < 25 ? "under" : "ok";
  return { label: p.label, included, usedThisMonth, pct, fit };
}

/**
 * The two currencies, named. UAT MC-B21 (VICTOR-L1-01): this line used to read "Unused credits roll
 * over. They never expire, so a quiet month is not lost" — directly under a header saying "Monthly
 * allotment · N credits / mo". Both halves were true of DIFFERENT currencies and the reader has no
 * way to know that, so an idle month looked free when it actually burns the whole allotment:
 *
 *   - the PLAN ALLOTMENT is a monthly grant. `decideScanCharge` compares `usageThisMonth` against it
 *     (src/lib/plans.ts), so it restarts each calendar month and an unused month is simply gone.
 *   - PREPAID CREDITS are the balance on `Organization.scanCredits`. Nothing resets them; they are
 *     what actually rolls over.
 *
 * The /pricing footnote already drew this distinction correctly — this is the same sentence, on the
 * page that shows the meter. Exported so a test can pin it: the defect was one sentence, and a
 * sentence with no seam is a sentence that silently regresses.
 */
export const ALLOTMENT_CURRENCIES_NOTE =
  "Two different currencies: this monthly allotment resets on the 1st (an unused month is not carried " +
  "forward), while prepaid credits you buy on top roll over and never expire. The 90% mark is your " +
  "top-up line, well before the hard 402.";

const FIT_COLOR: Record<AllotmentFit, string> = {
  over: "var(--color-warn, #f59e0b)",
  under: "#94a3b8",
  ok: "#84cc16",
};

export function AllotmentPanel({
  plan,
  meteredThisMonth,
}: {
  plan: string;
  /** Calendar-month metered scans from `countMeteredScansThisMonth` — not the ?days= billable tile. */
  meteredThisMonth: number;
}) {
  const read = allotmentRead(plan, meteredThisMonth);
  if (!read) return null;
  const { label, included, usedThisMonth, pct, fit } = read;
  const color = FIT_COLOR[fit];
  const msg =
    fit === "over"
      ? `You're at ~${pct}% of your ${included}/mo allotment: top up or move up a tier before private scans pause.`
      : fit === "under"
        ? `You're using ~${pct}% of your ${included}/mo allotment (a smaller tier may fit).`
        : `Comfortably within your ${included}/mo ${label} allotment.`;

  return (
    <Surface className="mt-4 p-6">
      <h2 className="type-body font-semibold text-white">
        Monthly allotment{" "}
        <span className="font-normal text-slate-500">· {label} plan · {included.toLocaleString()} credits / mo</span>
      </h2>
      <p className="mt-2 type-mono-sm text-slate-300">
        <span className="font-bold text-white">{usedThisMonth.toLocaleString()}</span> metered this calendar month
        (UTC) · <span style={{ color }}>{pct}%</span> of your {included.toLocaleString()} / mo allotment
      </p>
      <Meter className="mt-3" value={Math.min(100, pct)} color={color} threshold={90} />
      <p className="mt-3 type-body-sm" style={{ color }}>
        {msg}
      </p>
      <p className="mt-1 type-body-sm text-slate-500">{ALLOTMENT_CURRENCIES_NOTE}</p>
    </Surface>
  );
}
