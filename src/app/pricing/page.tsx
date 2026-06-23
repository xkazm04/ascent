// /pricing — public plan comparison, rendered from PLAN_FEATURES (the single source of truth the
// credit/entitlement layer also reads). The destination for the quota/credit "upgrade" CTAs (QUOTA-1).
// Subscription dollar amounts live in the billing provider (Polar, CRED-1) and aren't invented here —
// so we show the one price we DO know honestly (Free = $0), the prepaid-credit model plainly (private
// scans run on credits, 1 per scan; public scans are always free), and Enterprise as "Custom". Credits
// are bought from the org dashboard (CreditsControl → Polar).

import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { PLAN_FEATURES, PLAN_ORDER, type PlanId } from "@/lib/plans";
import { CreditEstimator } from "./CreditEstimator";

// Display-only price labels. Free is genuinely $0; Pro/Team run on prepaid credits (no fixed
// subscription price is asserted in code); Enterprise is bespoke. Kept here, not in plans.ts, so the
// feature/allotment source of truth stays free of pricing claims.
const PRICE: Record<PlanId, { amount: string; note: string }> = {
  free: { amount: "$0", note: "free forever" },
  pro: { amount: "Prepaid", note: "credits — 1 per scan over your allowance" },
  team: { amount: "Prepaid", note: "credits — 1 per scan over your allowance" },
  enterprise: { amount: "Custom", note: "contact us" },
};

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Plans & credits — Ascent",
  description:
    "Public-repo maturity scans are free forever. Private repos + the org fleet dashboard run on prepaid scan credits — from Free to Enterprise.",
};

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">Plans &amp; credits</h1>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-slate-400">
            Every plan includes a <span className="text-slate-200">monthly scan allowance</span>; scans beyond it run
            on prepaid credits (1 per scan). Public-repo scans also have a free weekly allowance — pick the tier that
            fits your fleet.
          </p>
        </div>

        <CreditEstimator />

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((id) => {
            const p = PLAN_FEATURES[id];
            const highlight = id === "team";
            return (
              <div
                key={id}
                className={`flex flex-col rounded-2xl border bg-slate-900/40 p-5 ${
                  highlight ? "border-accent/50 ring-1 ring-accent/20" : "border-slate-800"
                }`}
              >
                <h2 className="text-lg font-semibold text-white">{p.label}</h2>
                <p className="mt-2">
                  <span className="text-3xl font-bold text-white">{PRICE[id].amount}</span>{" "}
                  <span className="text-sm text-slate-400">{PRICE[id].note}</span>
                </p>
                <p className="mt-2 text-sm text-slate-400">{p.blurb}</p>
                <p className="mt-3 font-mono text-sm text-accent">
                  {p.unlimited ? "Unlimited scans" : `${p.includedCredits} scans / mo included`}
                </p>
                <ul className="mt-3 flex-1 space-y-1.5 text-sm text-slate-300">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="select-none text-accent">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={id === "free" ? "/" : "/connect"}
                  className="mt-4 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-accent/20"
                >
                  {id === "free" ? "Scan a repo free" : id === "enterprise" ? "Contact us" : "Get started"}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-500">
          Each plan includes a monthly scan allowance that{" "}
          <span className="text-slate-300">resets every month</span>. Scans beyond it run on prepaid credits (1 per
          scan), which <span className="text-slate-300">roll over and never expire</span> — so you pay only for the
          overflow you actually use. Cached re-scans of unchanged repos are always free. Manage credits and your plan
          from the org dashboard.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
