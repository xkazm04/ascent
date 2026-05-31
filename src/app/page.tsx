import Image from "next/image";
import { ScanForm } from "@/components/ScanForm";
import { ScanGallery } from "@/components/landing/ScanGallery";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { getPublicScanGallery } from "@/lib/db";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import { LEVEL_CLASSES } from "@/lib/ui";

// Rendered per-request (the gallery reflects persisted scans; SiteHeader already reads the
// session cookie, so this route is dynamic regardless).
export const dynamic = "force-dynamic";

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">{children}</div>
  );
}

export default async function Home() {
  // Live discovery rail + leaderboard from persisted public scans. Null when persistence is
  // off or nothing has been scored yet — the page then keeps its static examples.
  const gallery = await getPublicScanGallery().catch(() => null);
  const exampleRepos = gallery?.topAiNative.slice(0, 3).map((c) => c.fullName);

  return (
    <>
      <SiteHeader />
      <main className="w-full">
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
            <div className="absolute inset-0 bg-gradient-to-t from-transparent via-[#080d1a]/35 to-[#080d1a]" />
          </div>

          <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
            <Kicker>The AI-native maturity index</Kicker>
            <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
              How <span className="text-accent">AI-native</span> is your engineering org?
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-slate-400">
              Point Ascent at a GitHub repository. It reads its altitude on a 5-level ladder
              across 7 dimensions — with evidence and a prioritized route to the next level.
            </p>
            <div className="mt-9 flex w-full justify-center">
              <ScanForm autoFocus examples={exampleRepos} />
            </div>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-slate-400">
              Free for public repos · No signup · Results in under a minute
            </p>
          </div>
        </section>

        <div className="mx-auto w-full max-w-6xl px-5">
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
                      <div className={`font-mono text-sm font-bold ${c.text}`}>{l.id}</div>
                      <div className="mt-0.5 text-lg font-semibold text-white">{l.name}</div>
                      <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-slate-400">
                        {l.band[0]}–{l.band[1]}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-slate-400">{l.tagline}</p>
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
                  d: "A level, a radar across 7 dimensions, the evidence behind every score, and prioritized next steps to climb.",
                },
              ].map((s) => (
                <div key={s.n} className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
                  <div className="font-mono text-sm text-accent">{s.n}</div>
                  <h3 className="mt-2 text-lg font-semibold text-white">{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.d}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Dimensions */}
          <section className="py-12">
            <Kicker>The instrument</Kicker>
            <h2 className="mt-2 text-2xl font-bold text-white">Eight scoring dimensions</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {DIMENSIONS.map((d) => (
                <div key={d.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-white">{d.name}</h3>
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-400">
                      {Math.round(d.weight * 100)}%
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{d.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Pricing — usage-based */}
          <section id="pricing" className="scroll-mt-20 py-12">
            <Kicker>Pricing</Kicker>
            <h2 className="mt-2 text-2xl font-bold text-white">Usage-based — pay only for what you scan</h2>
            <p className="mt-2 max-w-2xl text-slate-400">
              Public repositories are free on the web. Private repositories are metered per
              scan to cover model inference and service costs — no subscription. Enterprise
              is implemented to your requirements.
            </p>
            <div className="mt-8 grid gap-5 lg:grid-cols-3">
              {PRICING.map((p) => (
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
                      <span className="rounded-md bg-accent/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-accent">
                        Pay as you go
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">{p.price}</div>
                  <p className="mt-1 text-sm text-slate-400">{p.tagline}</p>
                  <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-300">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <span className="text-accent">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-400">{p.note}</p>
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

const PRICING = [
  {
    name: "Public",
    price: "Free",
    tagline: "Any public repo, on the web",
    featured: false,
    features: [
      "Unlimited public-repo scans",
      "Full report · radar · roadmap",
      "Shareable maturity badge",
    ],
    note: "No signup. Free forever for public repositories.",
  },
  {
    name: "Private",
    price: "Usage-based",
    tagline: "Metered per private scan",
    featured: true,
    features: [
      "Private repos via token / GitHub App",
      "Scan history + progress trends",
      "Recommendation tracking",
      "PDF export",
    ],
    note: "Pay per scan to cover model inference + service costs — no subscription. Indicative; final rate TBD.",
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
