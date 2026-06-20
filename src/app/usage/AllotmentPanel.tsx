// Burn-vs-allotment utilization for /usage — turns "credits burned" into "X of your monthly allotment",
// the right-sizing signal the pricing-20 UAT panel asked for: Victor couldn't tell if Team was over- or
// under-provisioned, and Gabriel learned the tier ceiling only by hitting a 402. Normalizes the observed
// burn to a monthly rate so the percentage is comparable to the per-month allotment regardless of the
// selected window, then nudges toward a fit (downgrade when idle, upgrade/top-up before scans pause).
// Server-safe (no hooks). Renders nothing for unlimited (Enterprise) or allotment-less (Free) plans.

import { planFeatures } from "@/lib/plans";
import { Meter } from "@/components/org/ui";

/** Whether the org is idle (a smaller tier may fit), comfortable, or near the cap (top-up before the 402). */
export type AllotmentFit = "under" | "ok" | "over";

export interface AllotmentRead {
  label: string;
  included: number;
  /** Observed burn normalized to a per-month rate, so it's comparable to the monthly allotment. */
  monthlyBurn: number;
  /** monthlyBurn as a percentage of the included monthly allotment. */
  pct: number;
  fit: AllotmentFit;
}

/**
 * Pure right-sizing read: normalize the period's billable burn to a monthly rate and compare it to the
 * plan's included monthly allotment. Returns null for plans with no finite allotment (Free buys packs;
 * Enterprise is unlimited) — neither has a "% of allotment" to size against.
 */
export function allotmentRead(plan: string, billableInPeriod: number, periodDays: number): AllotmentRead | null {
  const p = planFeatures(plan);
  if (p.unlimited || !p.includedCredits) return null;
  const included = p.includedCredits;
  const monthlyBurn = periodDays > 0 ? Math.round((billableInPeriod / periodDays) * 30) : 0;
  const pct = included > 0 ? Math.round((monthlyBurn / included) * 100) : 0;
  const fit: AllotmentFit = pct > 90 ? "over" : monthlyBurn > 0 && pct < 25 ? "under" : "ok";
  return { label: p.label, included, monthlyBurn, pct, fit };
}

const FIT_COLOR: Record<AllotmentFit, string> = {
  over: "var(--color-warn, #f59e0b)",
  under: "#94a3b8",
  ok: "#84cc16",
};

export function AllotmentPanel({
  plan,
  billableInPeriod,
  periodDays,
}: {
  plan: string;
  billableInPeriod: number;
  periodDays: number;
}) {
  const read = allotmentRead(plan, billableInPeriod, periodDays);
  if (!read) return null;
  const { label, included, monthlyBurn, pct, fit } = read;
  const color = FIT_COLOR[fit];
  const msg =
    fit === "over"
      ? `You're at ~${pct}% of your ${included}/mo allotment — top up or move up a tier before private scans pause.`
      : fit === "under"
        ? `You're using ~${pct}% of your ${included}/mo allotment — a smaller tier may fit.`
        : `Comfortably within your ${included}/mo ${label} allotment.`;

  return (
    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <h2 className="text-base font-semibold text-white">
        Monthly allotment{" "}
        <span className="font-normal text-slate-500">· {label} plan · {included.toLocaleString()} credits / mo</span>
      </h2>
      <p className="mt-2 font-mono text-sm text-slate-300">
        ≈ <span className="font-bold text-white">{monthlyBurn.toLocaleString()}</span> credits / mo at this pace ·{" "}
        <span style={{ color }}>{pct}%</span> of your {included.toLocaleString()} / mo allotment
      </p>
      <Meter className="mt-3" value={Math.min(100, pct)} color={color} threshold={90} />
      <p className="mt-3 text-sm" style={{ color }}>
        {msg}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        Unused credits roll over — they never expire, so a quiet month is not lost. The 90% mark is your
        top-up line, well before the hard 402.
      </p>
    </div>
  );
}
