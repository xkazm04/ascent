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

// Each tier's primary CTA points at its REAL destination, labeled to match. The previous single
// `href={id === "free" ? "/" : "/connect"}` ternary sent Pro/Team AND Enterprise to /connect (the
// repo-watch page): "Contact us" dead-ended with no way to reach anyone, and "Get started" landed on a
// screen that is neither a checkout nor a plan upgrade. Free → run a scan; Pro/Team → the onboarding
// funnel (the app's canonical "get started", where watches/credits are set up); Enterprise → a real
// contact mailto when one is configured, else the About page (labeled honestly as "Learn more").
const CONTACT_EMAIL = process.env.ASCENT_CONTACT_EMAIL?.trim();
const CTA_CLASS =
  "mt-4 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-accent/20";

function ctaFor(id: PlanId): { href: string; label: string } {
  if (id === "free") return { href: "/", label: "Scan a repo free" };
  if (id === "enterprise") {
    return CONTACT_EMAIL
      ? { href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Ascent Enterprise enquiry")}`, label: "Contact us" }
      : { href: "/about", label: "Learn more" };
  }
  return { href: "/onboarding", label: "Get started" };
}

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
            const cta = ctaFor(id);
            return (
              <div
                key={id}
                className={`flex flex-col rounded-2xl border bg-slate-900/40 p-5 ${
                  highlight ? "border-accent/50 ring-1 ring-accent/20" : "border-slate-800"
                }`}
              >
                {highlight && (
                  <span className="mb-2 inline-flex w-fit rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">
                    Most popular
                  </span>
                )}
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
                      <span aria-hidden="true" className="select-none text-accent">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {cta.href.startsWith("mailto:") ? (
                  <a href={cta.href} className={CTA_CLASS}>
                    {cta.label}
                  </a>
                ) : (
                  <Link href={cta.href} className={CTA_CLASS}>
                    {cta.label}
                  </Link>
                )}
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
