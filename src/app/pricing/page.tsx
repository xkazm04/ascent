// /pricing — public plan comparison, rendered from PLAN_FEATURES (the single source of truth the
// credit/entitlement layer also reads). The destination for the quota/credit "upgrade" CTAs (QUOTA-1).
// The metering model shown here mirrors the engine (src/lib/db/credits.ts + decideScanCharge):
// public scans are always free and unmetered; PRIVATE (org) scans are free while under the plan's
// monthly allowance, then run on prepaid credits, 1 per scan. Enterprise is "Custom". Credits are
// bought from the org dashboard (CreditsControl → Polar).

import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { PLAN_FEATURES, PLAN_ORDER, planPriceLabel, type PlanId } from "@/lib/plans";
import { CreditMatrixLedger } from "@/components/pricing/CreditMatrixLedger";
import { planProducts, polarEnabled } from "@/lib/polar";
import { getSession } from "@/lib/auth";
import { getViewer } from "@/lib/access";
import { isDbConfigured, listOrgsForLogin } from "@/lib/db";

// Each tier's primary CTA points at its REAL destination, labeled to match. The previous single
// `href={id === "free" ? "/" : "/connect"}` ternary sent Pro/Team AND Enterprise to /connect (the
// repo-watch page): "Contact us" dead-ended with no way to reach anyone, and "Get started" landed on a
// screen that is neither a checkout nor a plan upgrade. Free → run a scan; Enterprise → a real contact
// mailto when one is configured, else the About page (labeled honestly as "Learn more").
//
// Pro/Team (G1-01): when Polar is configured with a POLAR_PLAN_PRODUCTS mapping for the tier AND we can
// resolve the signed-in viewer's org (the checkout route requires ?org=, see /api/billing/checkout), the
// CTA becomes a REAL "Subscribe" checkout link. Anonymous visitors, viewers without an org yet, or a
// deployment with Polar unconfigured/no plan-product mapping all degrade to the previous "Get started" →
// /onboarding funnel (a real, working destination, never a dead button) — /onboarding is where an org
// gets created in the first place, and the org dashboard's own CreditsControl offers the same checkout
// once the org exists.
const CONTACT_EMAIL = process.env.ASCENT_CONTACT_EMAIL?.trim();
const CTA_CLASS =
  "focus-ring mt-4 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-accent/20";

/** Pure — testable without rendering the page. `org`/`planProductId` are already resolved by the
 *  caller (null/undefined when unavailable), so this only decides the CTA shape from that outcome. */
export function ctaFor(id: PlanId, org: string | null, planProductId: string | undefined): { href: string; label: string } {
  if (id === "free") return { href: "/", label: "Scan a repo free" };
  if (id === "enterprise") {
    return CONTACT_EMAIL
      ? { href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Ascent Enterprise enquiry")}`, label: "Contact us" }
      : { href: "/about", label: "Learn more" };
  }
  if (org && planProductId) {
    return {
      href: `/api/billing/checkout?org=${encodeURIComponent(org)}&pack=${encodeURIComponent(planProductId)}`,
      label: "Subscribe",
    };
  }
  return { href: "/onboarding", label: "Get started" };
}

/** The signed-in viewer's primary (most privileged, then most recent) org slug, or null when there is
 *  no DB, no signed-in viewer, or the viewer belongs to no real org yet — mirrors the header's
 *  `OrgEntryLink` resolution (src/components/Brand.tsx) so the two surfaces agree on "which org". */
async function resolvePrimaryOrgSlug(): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const [session, viewer] = await Promise.all([getSession(), getViewer()]);
  const login = session?.login ?? viewer?.login ?? null;
  if (!login) return null;
  const orgs = await listOrgsForLogin(login);
  return orgs[0]?.slug ?? null;
}

/** planId → Polar product id, from POLAR_PLAN_PRODUCTS — empty when Polar isn't configured, so the
 *  Pro/Team CTA cleanly falls back to /onboarding instead of a dead checkout link. */
function planProductMap(): Partial<Record<PlanId, string>> {
  if (!polarEnabled()) return {};
  const map: Partial<Record<PlanId, string>> = {};
  for (const p of planProducts()) if (!(p.plan in map)) map[p.plan] = p.productId;
  return map;
}

export const dynamic = "force-dynamic";

// The prices + free allowance in the marketing/SEO copy are DERIVED from the plan model (plans.ts,
// CRED-1) — the SAME source the price cards read — so this string can't drift from plans.ts (it
// previously hardcoded "5 free … Pro $10/mo, Team $20/mo"). It CAN still drift from Polar: plans.ts
// `monthlyPrice` is a display-only duplicate of the Polar product price, so a price change in the
// Polar dashboard must be mirrored in plans.ts (see the PRICE CONTRACT note there) or this page
// advertises a number checkout won't charge.
const FREE_ALLOWANCE = PLAN_FEATURES.free.includedCredits ?? 0;
const PRO_PRICE = planPriceLabel("pro").amount; // e.g. "$10"
const TEAM_PRICE = planPriceLabel("team").amount; // e.g. "$20"

export const metadata = {
  title: "Plans & credits — Ascent",
  description: `Public scans are always free. Every plan includes a monthly private-scan allowance — ${FREE_ALLOWANCE} free a month, Pro ${PRO_PRICE}/mo, Team ${TEAM_PRICE}/mo. Private scans beyond your allowance run on prepaid credits you can top up anytime.`,
};

export default async function PricingPage() {
  const org = await resolvePrimaryOrgSlug();
  const productByPlan = planProductMap();
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">Plans &amp; credits</h1>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-slate-400">
            The deterministic <span className="text-slate-200">AI-native Scorecard</span> gate and public scans are{" "}
            <span className="text-slate-200">always free</span>. Every scan produces the full AI-graded{" "}
            <span className="text-slate-200">readiness briefing</span>, and every plan adds a{" "}
            <span className="text-slate-200">monthly private-scan allowance</span> — {FREE_ALLOWANCE} free a month, then
            a subscription for more. Private scans beyond your allowance run on prepaid credits you can{" "}
            <span className="text-slate-200">top up anytime</span>. Pick the tier that fits your fleet.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((id) => {
            const p = PLAN_FEATURES[id];
            const highlight = id === "team";
            const cta = ctaFor(id, org, productByPlan[id]);
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
                  <span className="text-3xl font-bold text-white">{planPriceLabel(id).amount}</span>{" "}
                  <span className="text-sm text-slate-400">{planPriceLabel(id).cadence}</span>
                </p>
                <p className="mt-2 text-sm text-slate-400">{p.blurb}</p>
                <p className="mt-3 font-mono text-sm text-accent">
                  {p.unlimited ? "Unlimited scans" : `${p.includedCredits} private scans / mo included`}
                </p>
                <ul className="mt-3 flex-1 space-y-1.5 text-sm text-slate-300">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span aria-hidden="true" className="select-none text-accent">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {cta.href.startsWith("mailto:") || cta.href.startsWith("/api/billing/checkout") ? (
                  // Plain <a>, not next/link: the checkout route mints a real, billable Polar session on
                  // GET, so it must never be Link-prefetched — same reasoning as PacksSection's checkout
                  // links in CreditsControl. The route itself also rejects a Sec-Purpose/Purpose-flagged
                  // prefetch as a second line of defense.
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

        {/* Full operation × credit × plan breakdown — the "what actually draws on credits" comparison
            beneath the price cards. */}
        <div className="mt-16">
          <CreditMatrixLedger />
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-500">
          Every plan&apos;s monthly scan allowance <span className="text-slate-300">resets on the 1st of each month (UTC)</span>; Pro and
          Team are monthly subscriptions that bundle more of it. Need more than your plan includes? Buy prepaid scan
          credits (1 per scan), which <span className="text-slate-300">roll over and never expire</span> — so you pay
          only for the overflow you actually use. Cached re-scans of unchanged repos are always free. Manage your plan
          and credits from the org dashboard.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
