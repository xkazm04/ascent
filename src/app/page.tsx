import Image from "next/image";
import Link from "next/link";
import { ScanForm } from "@/components/ScanForm";
import { QuotaMeter } from "@/components/QuotaMeter";
import { ScanGallery } from "@/components/landing/ScanGallery";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { getPublicScanGallery, isDbConfigured } from "@/lib/db";
import { publicScanQuotaDisabled, publicScanWeeklyLimit, signedInScanWeeklyLimit } from "@/lib/public-scan-quota";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import { LEVEL_CLASSES } from "@/lib/ui";

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
        text: "It reads structure, configs, CI, tests, docs, and recent commits via the GitHub API (no clone, nothing stored). Deterministic detectors extract evidence and an LLM adds nuance — guardbanded to that evidence so scores stay honest — producing a level, a radar across the dimensions, and prioritized next steps.",
      },
    },
    {
      "@type": "Question",
      name: "What are the five maturity levels?",
      acceptedAnswer: {
        "@type": "Answer",
        text: LEVELS.map((l) => `${l.id} ${l.name} (${l.band[0]}–${l.band[1]}): ${l.tagline}`).join(" "),
      },
    },
    {
      "@type": "Question",
      name: "Does Ascent store or clone my code?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. Ascent reads the repository through the GitHub API at scan time — it never clones the repo and doesn't store its source.",
      },
    },
    {
      "@type": "Question",
      name: "Is Ascent free?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Public repositories are free to scan on the web. Private repositories draw on prepaid scan credits — one credit per private scan, no subscription. Enterprise is implemented to requirements.",
      },
    },
  ],
};

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">{children}</div>
  );
}

/** Landing-page surface card — one radius/border/bg/padding so the marketing sections stop drifting
 *  (they hand-rolled the same chrome at p-5 vs p-6). */
function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-800 bg-slate-900/40 p-6 ${className}`}>{children}</div>;
}

export default async function Home() {
  // Live discovery rail + leaderboard from persisted public scans. Null when persistence is
  // off or nothing has been scored yet — the page then keeps its static examples.
  const gallery = await getPublicScanGallery().catch(() => null);
  const exampleRepos = gallery?.topAiNative.slice(0, 3).map((c) => c.fullName);

  // The weekly free-scan gate (src/lib/public-scan-quota.ts) only enforces when persistence is on
  // and the kill switch is off. Advertise the REAL terms then — the limits come from the same
  // functions the gate enforces, so copy and enforcement can't drift — and only then: a DB-less
  // deploy genuinely has no limit, and promising numbers a gate can't enforce would be the same
  // dishonesty in the other direction. The signed-in tier doubles as the sign-up pitch.
  const quota =
    isDbConfigured() && !publicScanQuotaDisabled()
      ? { anon: publicScanWeeklyLimit(), member: signedInScanWeeklyLimit() }
      : null;

  return (
    <>
      {/* SHELL-4: FAQ rich-result data. Static rubric/copy-derived strings — safe to inline. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD) }} />
      <SiteHeader />
      <main id="main" className="w-full">
        {/* Hero */}
        <section className="relative isolate overflow-hidden px-5 py-20 sm:py-28">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <Image
              src="/brand/hero-bg.png"
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover object-bottom opacity-70"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-transparent via-ink/35 to-ink" />
          </div>

          <div className="animate-fade-up mx-auto flex max-w-6xl flex-col items-center text-center">
            <Kicker>The AI-native maturity index</Kicker>
            <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
              How <span className="text-accent">AI-native</span> is your engineering org?
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-slate-400">
              Point Ascent at a GitHub repository. It reads its altitude on a 5-level ladder
              across {DIMENSIONS.length} dimensions — with evidence and a prioritized route to the next level.
            </p>
            <div className="mt-9 flex w-full justify-center">
              <ScanForm autoFocus examples={exampleRepos} />
            </div>
            <QuotaMeter />
            <p className="mt-4 font-mono text-sm uppercase tracking-widest text-slate-400">
              {quota ? (
                <>
                  <span>
                    {quota.anon} free scans a week — no signup
                  </span>
                  <span aria-hidden> · </span>
                  <span>Sign in for {quota.member}</span>
                  <span aria-hidden> · </span>
                  <span>Results in under a minute</span>
                </>
              ) : (
                <>
                  <span>Free for public repos</span>
                  <span aria-hidden> · </span>
                  <span>No signup</span>
                  <span aria-hidden> · </span>
                  <span>Results in under a minute</span>
                </>
              )}
            </p>
          </div>
        </section>

        <div className="mx-auto w-full max-w-6xl px-5">
          {/* Try it on a whole org — links to the seeded Vercel cross-repo report, or onboarding
              to analyze your own organization. */}
          <section className="pt-12">
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.04] p-6 sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="max-w-2xl">
                  <Kicker>Organization view</Kicker>
                  <h2 className="mt-2 text-2xl font-bold text-white">
                    Analyze a whole organization, not just one repo
                  </h2>
                  <p className="mt-2 text-base leading-relaxed text-slate-400">
                    Ascent scans every repository in an org and rolls the results into one cross-repo
                    view — shared strengths, the gaps common across teams, contributor activity, and
                    where to invest next.
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-3 sm:items-end">
                  <Link
                    href="/org/vercel"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
                  >
                    Explore the Vercel org report →
                  </Link>
                  <Link
                    href="/onboarding"
                    className="text-sm font-medium text-slate-300 transition hover:text-white"
                  >
                    Or analyze your own organization →
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* Live discovery — recently scanned rail + most-AI-native leaderboard. Only rendered
              when persisted public scans exist; otherwise the landing page is unchanged. */}
          {gallery && <ScanGallery gallery={gallery} />}

          {/* Levels ladder */}
          <section id="levels" className="scroll-mt-20 py-12">
            <Kicker>The ladder</Kicker>
            <h2 className="mt-2 text-2xl font-bold text-white">The five levels of ascent</h2>
            <p className="mt-2 max-w-2xl text-slate-400">
              From ad-hoc AI use to a fully autonomous, reliable, AI-native system.
            </p>
            <div className="relative mt-8">
              <div aria-hidden className="strata pointer-events-none absolute -inset-x-4 inset-y-0" />
              <div className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {LEVELS.map((l) => {
                  const c = LEVEL_CLASSES[l.id];
                  return (
                    <div key={l.id} className={`rounded-xl border ${c.border} ${c.bg} p-4 backdrop-blur-sm`}>
                      <div className={`font-mono text-base font-bold ${c.text}`}>{l.id}</div>
                      <div className="mt-0.5 text-lg font-semibold text-white">{l.name}</div>
                      <div className="mt-1 font-mono text-sm uppercase tracking-widest text-slate-400">
                        {l.band[0]}–{l.band[1]}
                      </div>
                      <p className="mt-2 text-base leading-relaxed text-slate-400">{l.tagline}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* How it works */}
          <section id="how" className="scroll-mt-20 py-12">
            <Kicker>Method</Kicker>
            <h2 className="mt-2 text-2xl font-bold text-white">How it works</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {[
                {
                  n: "01",
                  t: "Read the repo",
                  d: "We read structure, configs, CI, tests, docs, and recent commits via the GitHub API — no clone, nothing stored.",
                },
                {
                  n: "02",
                  t: "Score the signals",
                  d: "Deterministic detectors extract evidence; an LLM adds nuance — guardbanded to the evidence so scores stay honest.",
                },
                {
                  n: "03",
                  t: "Get the route",
                  d: `A level, a radar across ${DIMENSIONS.length} dimensions, the evidence behind every score, and prioritized next steps to climb.`,
                },
              ].map((s) => (
                <Panel key={s.n}>
                  <div className="font-mono text-base text-accent">{s.n}</div>
                  <h3 className="mt-2 text-lg font-semibold text-white">{s.t}</h3>
                  <p className="mt-2 text-base leading-relaxed text-slate-400">{s.d}</p>
                </Panel>
              ))}
            </div>
          </section>

          {/* Dimensions */}
          <section className="py-12">
            <Kicker>The instrument</Kicker>
            <h2 className="mt-2 text-2xl font-bold text-white">{DIMENSIONS.length} scoring dimensions</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {DIMENSIONS.map((d) => (
                <Panel key={d.id}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-white">{d.name}</h3>
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-sm text-slate-400">
                      {Math.round(d.weight * 100)}%
                    </span>
                  </div>
                  <p className="mt-2 text-base leading-relaxed text-slate-400">{d.description}</p>
                </Panel>
              ))}
            </div>
          </section>

          {/* Pricing — usage-based */}
          <section id="pricing" className="scroll-mt-20 py-12">
            <Kicker>Pricing</Kicker>
            <h2 className="mt-2 text-2xl font-bold text-white">Usage-based — pay only for what you scan</h2>
            <p className="mt-2 max-w-2xl text-slate-400">
              Public repositories are free on the web. Private repositories draw on prepaid scan
              credits — buy a balance, and each private scan uses one. No subscription. Enterprise
              is implemented to your requirements.
            </p>
            <div className="mt-8 grid gap-5 lg:grid-cols-3">
              {buildPricing(quota).map((p) => (
                <div
                  key={p.name}
                  className={`flex flex-col rounded-xl border p-6 ${
                    p.featured
                      ? "border-accent/60 bg-accent/5 ring-1 ring-accent/30"
                      : "border-slate-800 bg-slate-900/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">{p.name}</h3>
                    {p.featured && (
                      <span className="rounded-md bg-accent/15 px-2 py-0.5 font-mono text-sm uppercase tracking-widest text-accent">
                        Prepaid credits
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">{p.price}</div>
                  <p className="mt-1 text-base text-slate-400">{p.tagline}</p>
                  <ul className="mt-4 flex-1 space-y-2 text-base text-slate-300">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <span className="text-accent">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 border-t border-slate-800 pt-3 text-sm text-slate-400">{p.note}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * Pricing cards. The Public card states the freemium ladder honestly: when the weekly gate is
 * live, its first feature carries the REAL limits (from the gate's own limit functions) and sells
 * the free-account upgrade — the worst place to learn the marketing was false is the 429 wall.
 * Only a deploy with no enforceable gate (`quota: null`) may say "unlimited".
 */
function buildPricing(quota: { anon: number; member: number } | null) {
  return [
    {
      name: "Public",
      price: "Free",
      tagline: "Any public repo, on the web",
      featured: false,
      features: [
        quota
          ? `${quota.anon} free scans a week — ${quota.member} with a free account`
          : "Unlimited public-repo scans",
        "Full report · radar · roadmap",
        "Shareable maturity badge",
      ],
      note: quota
        ? "No signup needed to start. Free for public repositories — sign in to lift the weekly limit."
        : "No signup. Free forever for public repositories.",
    },
    ...PRICING_PAID,
  ];
}

const PRICING_PAID = [
  {
    name: "Private",
    price: "Prepaid credits",
    tagline: "One credit per private scan",
    featured: true,
    features: [
      "Private repos via token / GitHub App",
      "Scan history + progress trends",
      "Recommendation tracking",
      "PDF report export",
    ],
    note: "Buy a balance of scan credits; each private scan uses one. No subscription. Indicative; final rate TBD.",
  },
  {
    name: "Enterprise",
    price: "Custom",
    tagline: "Implemented on demand",
    featured: false,
    features: [
      "Private inference via AWS Bedrock",
      "SSO / SAML + RBAC",
      "Audit logs · data residency · VPC",
      "Org rollups + dedicated support",
    ],
    note: "Tailored deployment for your security and scale requirements.",
  },
];
