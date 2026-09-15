import { SiteFooter, SiteHeader } from "@/components/Brand";
import { IndexLanding } from "@/components/landing/prototypes/IndexLanding";
import { getPublicScanGallery, recordQuotaEvent } from "@/lib/db";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import { isAuthConfigured } from "@/lib/auth";
import { supabaseAuthConfigured } from "@/lib/env";
import { jsonLdScript } from "@/lib/site";
import { publicScanWallEnabled } from "@/lib/scan-gates";
import { resolveFirstRun } from "@/lib/first-run";
import { PLAN_FEATURES, planPriceLabel, type PlanId } from "@/lib/plans";
import { PUBLIC_SCAN_WINDOW_DAYS, publicScanAllowance } from "@/lib/public-scan-limit";

/** "Starter ($5/mo)" — the tier's customer-facing NAME and price, both read from the plan model. */
const paidTier = (id: PlanId) => `${PLAN_FEATURES[id].label} (${planPriceLabel(id).amount}/mo)`;

// Rendered per-request (the gallery reflects persisted scans; SiteHeader already reads the
// session cookie, so this route is dynamic regardless).
export const dynamic = "force-dynamic";

// SHELL-4: FAQ structured data for rich search results. Built from the same rubric the page renders
// (LEVELS/DIMENSIONS) + the on-page method/pricing copy, so the answers can't drift from what's shown.
const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is the AI-native maturity index?",
      acceptedAnswer: {
        "@type": "Answer",
        text: `Ascent reads a GitHub repository and rates how AI-native the engineering is on a ${LEVELS.length}-level ladder across ${DIMENSIONS.length} dimensions, with the evidence behind every score and a prioritized route to the next level.`,
      },
    },
    {
      "@type": "Question",
      name: "How does Ascent score a repository?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It reads structure, configs, CI, tests, docs, and recent commits through the GitHub API — no clone, and the source it reads is never uploaded anywhere as a whole. Deterministic detectors extract evidence and an LLM adds nuance (guardbanded to that evidence so scores stay honest), producing a level, a radar across the dimensions, and prioritized next steps.",
      },
    },
    {
      "@type": "Question",
      name: `What are the ${LEVELS.length} maturity levels?`,
      acceptedAnswer: {
        "@type": "Answer",
        text: LEVELS.map((l) => `${l.id} ${l.name} (${l.band[0]}–${l.band[1]}): ${l.tagline}`).join(" "),
      },
    },
    {
      "@type": "Question",
      name: "Does Ascent store or clone my code?",
      acceptedAnswer: {
        // CORRECTED. The previous answer was a flat "No … doesn't store its source", and two shipped
        // behaviours contradict it: rubric r9 records short VERBATIM quotes with their file paths as
        // the evidence a score rests on (src/lib/scoring/claims.ts), and a public scan's report is
        // persisted — that is how its permalink resolves for the next visitor
        // (src/components/report/ColdScanGate.tsx). Saying "nothing is stored" while storing quoted
        // lines is the kind of claim a reader discovers is false at the worst possible moment.
        "@type": "Answer",
        text: "Ascent never clones your repository — it reads it through the GitHub API at scan time, and the source is never uploaded or kept as a copy. What the report does keep is the evidence: short verbatim quotes, with the file path each came from, so every score can be checked rather than trusted. Public scan reports are persisted so their permalinks stay shareable; private scans follow your plan's retention window.",
      },
    },
    {
      "@type": "Question",
      name: "Is Ascent open source?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Ascent is licensed under the GNU AGPL-3.0. You can clone it and run it yourself for free, forever, with no feature gates and no scan limits, pointed at any model including a local one (Ollama, vLLM, LM Studio) or your own Claude subscription. The hosted cloud runs the same codebase; paying for it buys operation — a managed database, a registered GitHub App, scheduled scans, alerts and support — not capability.",
      },
    },
    {
      "@type": "Question",
      name: "Is Ascent free?",
      acceptedAnswer: {
        "@type": "Answer",
        // DERIVED from the plan model, like the /pricing SEO copy — this sentence hardcoded
        // "Pro ($10/mo) and Team ($20/mo)" and sailed through both a repricing and a rename before
        // anyone noticed the landing page was quoting a price nobody could buy.
        // MC-B5: "public scans are always free and unmetered" was a rich-result answer Google may
        // quote — contradicted by the meter in the scan dialog on the same visit. The allowance is
        // read from the function the quota gate charges against (src/lib/public-scan-limit.ts).
        text: `Self-hosting is free and unlimited. On the hosted cloud, every plan includes a monthly private-scan allowance: ${PLAN_FEATURES.free.includedCredits} scans a month free, plus ${publicScanAllowance().label} on a rolling ${PUBLIC_SCAN_WINDOW_DAYS}-day window. ${paidTier("pro")} and ${paidTier("team")} are subscriptions that bundle more; scans beyond your allowance run on prepaid credits you can top up anytime. The ${PLAN_FEATURES.enterprise.label} plan is scoped to your requirements: hosting, scan volume, support, customization and SSO.`,
      },
    },
  ],
};

export default async function Home() {
  // Cookieless visit counter — the top of the visit → signup → activation funnel (the other two
  // stages already come from kpi-metrics.ts; read back on GET /api/kpi). Fire-and-forget exactly
  // like the scan route's quota tallies: recordQuotaEvent no-ops when no DB is configured and
  // swallows every store error internally, and the un-awaited `void` call keeps the landing render
  // entirely off the write path — a slow or broken DB can never block or fail this page.
  void recordQuotaEvent("landing_view", "landing").catch(() => {});

  // Live discovery rail + leaderboard from persisted public scans. Null when persistence is
  // off or nothing has been scored yet — the variants then keep their static examples.
  const gallery = await getPublicScanGallery().catch(() => null);
  const exampleRepos = gallery?.topAiNative.slice(0, 3).map((c) => c.fullName);

  // Which GitHub sign-in backend the hero's scan dialog should offer (mirrors SiteHeader's pick):
  // Supabase OAuth when configured, else the dormant custom OAuth, else none (get-started fallback).
  const auth = supabaseAuthConfigured() ? "supabase" : isAuthConfigured() ? "github" : null;

  // Whether the hero's scan dialog should lock behind sign-in. This asks the SCAN ENDPOINT'S OWN
  // predicate for the anonymous public scan the dialog starts (`publicScanWallEnabled` — the
  // `publicScan: true` branch of `scanAuthGate`), not the coarser `authGateEnabled()` it used to read.
  // Those two diverged the moment the server exempted the public funnel (UAT TOMAS-L1-01): a
  // cookie-less POST /api/scan returned 200 while this page went on painting a "Scanning is for
  // signed-in members" wall over the form — and over the QuotaMeter and the honest duration sentence
  // that sit with it. The wall is now shown exactly when the server would enforce one.
  const gated = publicScanWallEnabled();
  // Self-hosted vs cloud decides where the org CTAs point and whether the deck pitches self-hosting at
  // all (src/lib/first-run.ts — the same resolver /onboarding branches on, so the two agree).
  const firstRun = await resolveFirstRun();

  return (
    <>
      {/* SHELL-4: FAQ rich-result data. Rubric/copy-derived, and inlined through the shared
          jsonLdScript escaper so this stays safe if a dynamic field is ever added (lib/site). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(FAQ_LD) }} />
      <SiteHeader />
      <IndexLanding
        gallery={gallery}
        exampleRepos={exampleRepos}
        auth={auth}
        gated={gated}
        selfHosted={firstRun.mode === "self-hosted"}
        setup={firstRun.setup}
      />
      {/* snap-end makes the trailing footer its own snap point (aligned to the viewport bottom) so the
          deck can rest on it instead of the last section snapping back over it. */}
      <div className="snap-end">
        <SiteFooter />
      </div>
    </>
  );
}
