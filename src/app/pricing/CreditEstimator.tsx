"use client";

// Recurring-cost estimator for /pricing — the "model MY cost" tool the pricing-20 UAT panel asked for
// (16/20 characters couldn't tell whether repeated scanning was worth it because the page never let them
// turn "my fleet, my cadence" into a credit number). It's deliberately dollar-free: it maps a fleet size
// and a re-scan cadence to credits/month (1 private scan = 1 credit) and names the cheapest tier whose
// monthly allotment covers it — so a buyer can right-size BEFORE they hit a 402 or overpay for headroom.
// Pure client state; reads the allotment thresholds from the same PLAN_FEATURES the cards render from.

import { useState } from "react";
import { PLAN_FEATURES, PLAN_ORDER, type PlanId } from "@/lib/plans";

/** Re-scan cadence → scans per repo per month. Daily uses ~22 working days; weekly ~4.33 weeks/month. */
const CADENCE = [
  { id: "monthly", label: "monthly", perMonth: 1 },
  { id: "weekly", label: "weekly", perMonth: 4.33 },
  { id: "daily", label: "daily (workdays)", perMonth: 22 },
] as const;

type CadenceId = (typeof CADENCE)[number]["id"];

/** Cheapest tier whose monthly allotment covers the burn; Enterprise (unlimited) when nothing else does. */
function fitTier(creditsPerMonth: number): PlanId {
  for (const id of PLAN_ORDER) {
    const p = PLAN_FEATURES[id];
    if (p.unlimited) return id;
    if (p.includedCredits && p.includedCredits >= creditsPerMonth) return id;
  }
  return "enterprise";
}

function allotmentLabel(id: PlanId): string {
  const p = PLAN_FEATURES[id];
  return p.unlimited ? "unlimited scans" : `${p.includedCredits} scans / mo`;
}

export function CreditEstimator() {
  const [repos, setRepos] = useState(10);
  const [cadence, setCadence] = useState<CadenceId>("weekly");

  const perMonth = CADENCE.find((c) => c.id === cadence)!.perMonth;
  const safeRepos = Number.isFinite(repos) && repos > 0 ? Math.floor(repos) : 0;
  const creditsPerMonth = Math.round(safeRepos * perMonth);
  const tier = fitTier(creditsPerMonth);

  return (
    <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Estimate your monthly scan need</h2>
      <p className="mt-1 text-sm text-slate-500">
        Each plan includes a monthly scan allowance; scans beyond it cost 1 credit. Cached re-scans of unchanged
        repos are free. Estimate your fleet&apos;s recurring scan volume to pick the tier that fits.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <span>Repositories</span>
          <input
            type="number"
            min={0}
            value={repos}
            onChange={(e) => setRepos(e.target.valueAsNumber)}
            className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white focus:border-accent focus:outline-none"
            aria-label="Number of repositories"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <span>Re-scanned</span>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as CadenceId)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-accent focus:outline-none"
            aria-label="Re-scan cadence"
          >
            {CADENCE.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
        <p className="font-mono text-lg text-white">
          ≈ <span className="font-bold text-accent">{creditsPerMonth.toLocaleString("en-US")}</span> scans / month
        </p>
        <p className="mt-1 text-sm text-slate-300">
          {creditsPerMonth === 0
            ? "Add some repositories to estimate your monthly scan volume."
            : tier === "enterprise" && !PLAN_FEATURES[tier].includedCredits
              ? `That exceeds every monthly allowance — the Enterprise tier (unlimited scans) fits, and the team can size a plan with you.`
              : `The ${PLAN_FEATURES[tier].label} tier covers this — ${allotmentLabel(tier)}. Scans beyond the allowance run on prepaid credits (which roll over).`}
        </p>
      </div>
    </div>
  );
}
