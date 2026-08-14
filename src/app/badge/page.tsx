import { SiteFooter, SiteHeader } from "@/components/Brand";
import { BadgeGenerator } from "@/components/badge/BadgeGenerator";
import { GATE_QUERY, GATE_YAML } from "./gate-snippets";

export const metadata = {
  title: "Badge generator · Ascent",
  description:
    "Generate a copy-paste Ascent maturity badge (Markdown, HTML, AsciiDoc) for your README, and the free CI gate snippets that enforce the same bar on every PR.",
};

export default function BadgePage() {
  return (
    <>
      <SiteHeader />
      {/* id="main" is the global skip-to-content target (layout.tsx). Without it the always-present
          "Skip to content" link no-ops here — a WCAG 2.4.1 bypass-blocks failure. */}
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-10">
        <div className="animate-fade-up">
          <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Embed</div>
          <h1 className="mt-1 text-3xl font-bold text-white">Maturity badge generator</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Drop a live Ascent maturity badge into your README. It links back to the full report,
            so a reader can click through and scan their own repo. Pick a repo and a style, then
            copy the snippet for Markdown, HTML, or AsciiDoc. The same repo fills in the free CI
            gate snippets at the bottom.
          </p>
          <div className="mt-6">
            {/* The gate snippets ride along inside the generator so they interpolate the repo the
                visitor just typed; the policy they enforce is resolved here, on the server. */}
            <BadgeGenerator gate={{ yaml: GATE_YAML, query: GATE_QUERY }} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
