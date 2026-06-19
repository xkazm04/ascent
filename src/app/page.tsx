import { SiteFooter, SiteHeader } from "@/components/Brand";
import { IndexLanding } from "@/components/landing/prototypes/IndexLanding";
import { getPublicScanGallery, isDbConfigured } from "@/lib/db";
import { publicScanQuotaDisabled, publicScanWeeklyLimit, signedInScanWeeklyLimit } from "@/lib/public-scan-quota";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";

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

export default async function Home() {
  // Live discovery rail + leaderboard from persisted public scans. Null when persistence is
  // off or nothing has been scored yet — the variants then keep their static examples.
  const gallery = await getPublicScanGallery().catch(() => null);
  const exampleRepos = gallery?.topAiNative.slice(0, 3).map((c) => c.fullName);

  // The weekly free-scan gate only enforces when persistence is on and the kill switch is off.
  // Advertise the REAL terms then — the limits come from the same functions the gate enforces, so
  // copy and enforcement can't drift; a DB-less deploy genuinely has no limit.
  const quota =
    isDbConfigured() && !publicScanQuotaDisabled()
      ? { anon: publicScanWeeklyLimit(), member: signedInScanWeeklyLimit() }
      : null;

  return (
    <>
      {/* SHELL-4: FAQ rich-result data. Static rubric/copy-derived strings — safe to inline. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD) }} />
      <SiteHeader />
      <IndexLanding gallery={gallery} quota={quota} exampleRepos={exampleRepos} />
      {/* snap-end makes the trailing footer its own snap point (aligned to the viewport bottom) so the
          deck can rest on it instead of the last section snapping back over it. */}
      <div className="snap-end">
        <SiteFooter />
      </div>
    </>
  );
}
