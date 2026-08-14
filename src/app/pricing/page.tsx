// /pricing — public plan comparison, rendered from PLAN_FEATURES (the single source of truth the
// credit/entitlement layer also reads). The destination for the quota/credit "upgrade" CTAs (QUOTA-1).
// The metering model shown here mirrors the engine (src/lib/db/credits.ts + decideScanCharge):
// public scans are always free and unmetered; PRIVATE (org) scans are free while under the plan's
// monthly allowance, then run on prepaid credits, 1 per scan. Credits are bought from the org
// dashboard (CreditsControl → Polar). The bespoke tier (stored `enterprise`, shown as "Custom") has no
// checkout — its CTA opens PlanEnquiryCta, which mails the requirement to the operator.

import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { HairlineGrid, Kicker } from "@/components/ui";
import { PLAN_FEATURES, PLAN_ORDER, planPriceLabel, planScanLine, type PlanId } from "@/lib/plans";
import { CreditMatrixLedger } from "@/components/pricing/CreditMatrixLedger";
import { PlanEnquiryCta } from "@/components/pricing/PlanEnquiryCta";
import { DEMO_ORG_SLUG, demoOrgHref } from "@/lib/site";
import { planProducts, polarEnabled } from "@/lib/polar";
import { getSession } from "@/lib/auth";
import { getViewer } from "@/lib/access";
import { isDbConfigured, listOrgsForLogin } from "@/lib/db";

// Each tier's primary CTA points at its REAL destination, labeled to match. The previous single
// `href={id === "free" ? "/" : "/connect"}` ternary sent the paid tiers AND the bespoke one to /connect (the
// repo-watch page): "Contact us" dead-ended with no way to reach anyone, and "Get started" landed on a
// screen that is neither a checkout nor a plan upgrade. Free → run a scan.
//
// Starter/Team (G1-01): when Polar is configured with a POLAR_PLAN_PRODUCTS mapping for the tier AND we can
// resolve the signed-in viewer's org (the checkout route requires ?org=, see /api/billing/checkout), the
// CTA becomes a REAL "Subscribe" checkout link. Anonymous visitors, viewers without an org yet, or a
// deployment with Polar unconfigured/no plan-product mapping all degrade to the previous "Get started" →
// /onboarding funnel (a real, working destination, never a dead button) — /onboarding is where an org
// gets created in the first place, and the org dashboard's own CreditsControl offers the same checkout
// once the org exists.
//
// The CUSTOM tier (billing: "custom") has no href at all: `ctaFor` returns null and the card renders
// PlanEnquiryCta, a dialog that captures the requirement and mails it to the operator. It used to be a
// `mailto:` when ASCENT_CONTACT_EMAIL was set and "Learn more" → /about when it wasn't — so on a deploy
// without that env, the page's highest-intent click landed on a marketing page.
const CTA_CLASS =
  "focus-ring mt-4 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-accent/20";

/** Pure — testable without rendering the page. `org`/`planProductId` are already resolved by the
 *  caller (null/undefined when unavailable), so this only decides the CTA shape from that outcome.
 *  `null` means "this tier has no destination" — the card renders the enquiry dialog instead. */
export function ctaFor(
  id: PlanId,
  org: string | null,
  planProductId: string | undefined,
): { href: string; label: string } | null {
  if (id === "free") return { href: "/", label: "Scan a repo free" };
  // Keyed off the BILLING MODEL, not the literal id: a bespoke tier is one that can't be bought from a
  // page, whatever it ends up being called.
  if (PLAN_FEATURES[id].billing === "custom") return null;
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
 *  paid-tier CTA cleanly falls back to /onboarding instead of a dead checkout link. */
function planProductMap(): Partial<Record<PlanId, string>> {
  if (!polarEnabled()) return {};
  const map: Partial<Record<PlanId, string>> = {};
  for (const p of planProducts()) if (!(p.plan in map)) map[p.plan] = p.productId;
  return map;
}

export const dynamic = "force-dynamic";

// The prices, NAMES and free allowance in the marketing/SEO copy are DERIVED from the plan model
// (plans.ts, CRED-1) — the SAME source the price cards read — so this string can't drift from plans.ts
// (it previously hardcoded "5 free … Pro $10/mo, Team $20/mo", which survived a repricing AND a rename
// intact). It CAN still drift from Polar: plans.ts `monthlyPrice` is a display-only duplicate of the
// Polar product price, so a price change in the Polar dashboard must be mirrored in plans.ts (see the
// PRICE CONTRACT note there) or this page advertises a number checkout won't charge.
const FREE_ALLOWANCE = PLAN_FEATURES.free.includedCredits ?? 0;

/** "Starter $5/mo" — name and price both from the model, for the SEO/FAQ sentences. */
const priced = (id: PlanId) => `${PLAN_FEATURES[id].label} ${planPriceLabel(id).amount}/mo`;

export const metadata = {
  title: "Plans & credits · Ascent",
  description: `Public scans are always free. Every plan includes a monthly private-scan allowance: ${FREE_ALLOWANCE} free a month, ${priced("pro")}, ${priced("team")}. Private scans beyond your allowance run on prepaid credits you can top up anytime.`,
};

export default async function PricingPage() {
  const org = await resolvePrimaryOrgSlug();
  const productByPlan = planProductMap();
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-12">
        {/* The masthead is deliberately SHORT and spans the full card grid rather than sitting in a
            narrow column of dense prose. The old version restated the entire metering model — free
            gate, briefing, allowance, credits, top-ups — above a table that explains all of it below,
            and a visitor had to read a paragraph before finding anything to click. One sentence and
            the two real first moves (scan something, or look at a populated dashboard) do the job. */}
        <header className="text-center">
          <Kicker>Plans &amp; credits</Kicker>
          <h1 className="deck-h2 mt-3 text-3xl font-bold text-white sm:text-4xl">Pick the tier that fits your fleet</h1>
          <p className="deck-lede mt-4 text-lg leading-relaxed text-slate-300">
            Public scans are always free; every plan adds a monthly private-scan allowance. Start with a scan, or see a
            whole fleet already scored.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="focus-ring rounded-xl bg-accent px-5 py-2.5 font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              Scan a repo free
            </Link>
            <Link
              href={demoOrgHref()}
              className="focus-ring rounded-xl border border-divider px-5 py-2.5 font-medium text-slate-200 transition hover:border-accent hover:text-white"
            >
              Explore the live demo →
            </Link>
          </div>
          {/* The demo's REFERENCE: naming the org (and showing its path) is what makes "live demo" a
              claim a visitor can check, rather than a word that could equally mean a canned tour. */}
          <p className="mt-3 font-mono text-xs text-slate-500">
            a real scanned organization · /org/{DEMO_ORG_SLUG}
          </p>
        </header>

        {/* The brand's editorial cluster (BRAND.md names pricing as a HairlineGrid case): ONE framed
            ledger with 1px rules between tiers, not four floating cards. Cells set their own bg so the
            gap reads as a rule. */}
        <HairlineGrid className="tick-corners mt-12 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((id) => {
            const p = PLAN_FEATURES[id];
            const price = planPriceLabel(id);
            // Team keeps a quiet accent emphasis, but the "Most popular" pill is gone: it was an
            // unbacked popularity claim (nothing here counts subscriptions). Inside a HairlineGrid the
            // emphasis is a lit cell + an accent eyebrow, not a border — a per-cell border would fight
            // the hairline rules the grid is made of.
            const highlight = id === "team";
            const cta = ctaFor(id, org, productByPlan[id]);
            return (
              <div key={id} className={`flex flex-col p-6 ${highlight ? "bg-surface/60" : "bg-ink"}`}>
                <Kicker as="span" tone={highlight ? "accent" : "muted"}>
                  {p.label}
                </Kicker>
                {/* Numbers are typeset (BRAND.md §4): mono + tabular-nums, so every tier's amount sits
                    on the same baseline across the four cells. The cadence gets its OWN line rather
                    than trailing the amount inline — inline, "scoped with you" wrapped under "Flexible"
                    while "/ month" didn't, making the Custom cell one line taller than its neighbours
                    and pushing every rule below it out of alignment. */}
                <p className="mt-3 font-mono text-3xl font-bold leading-none tabular-nums text-white">{price.amount}</p>
                <p className="mt-2 text-sm text-slate-500">{price.cadence}</p>
                {/* Three lines of room whatever the blurb's length, so the hairline rule beneath sits
                    at the SAME height in all four cells — an inner rule that stair-steps across a row
                    reads as a rendering fault, not as four different sentences. */}
                <p className="mt-3 min-h-[4.25rem] text-sm leading-relaxed text-slate-400">{p.blurb}</p>
                {/* The scan volume, stated ONCE per cell, under its own rule. The bullets below
                    deliberately don't repeat it — the same sentence in two typefaces read as two
                    different facts. */}
                <div className="mt-5 border-t border-divider pt-4">
                  <Kicker as="span" tone="muted">
                    Included
                  </Kicker>
                  <p className="mt-1.5 font-mono text-sm text-accent">{planScanLine(id)}</p>
                </div>
                <ul className="mt-4 flex-1 space-y-2 text-sm leading-relaxed text-slate-300">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <span aria-hidden="true" className="mt-px select-none text-accent">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {cta === null ? (
                  <PlanEnquiryCta className={CTA_CLASS} />
                ) : cta.href.startsWith("/api/billing/checkout") ? (
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
        </HairlineGrid>

        {/* Full operation × credit × plan breakdown — the "what actually draws on credits" comparison
            beneath the price cards. */}
        <div className="mt-16">
          <CreditMatrixLedger />
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-500">
          Every plan&apos;s monthly scan allowance <span className="text-slate-300">resets on the 1st of each month (UTC)</span>; Pro and
          Team are monthly subscriptions that bundle more of it. Need more than your plan includes? Buy prepaid scan
          credits (1 per scan), which <span className="text-slate-300">roll over and never expire</span>, so you pay
          only for the overflow you actually use. Cached re-scans of unchanged repos are always free. Manage your plan
          and credits from the org dashboard.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
