import { SiteFooter, SiteHeader } from "@/components/Brand";
import { BadgeGenerator } from "@/components/badge/BadgeGenerator";

export const metadata = {
  title: "Badge generator · Ascent",
  description: "Generate a copy-paste Ascent maturity badge (Markdown, HTML, AsciiDoc) for your README.",
};

export default function BadgePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <div className="animate-fade-up">
          <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Embed</div>
          <h1 className="mt-1 text-3xl font-bold text-white">Maturity badge generator</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Drop a live Ascent maturity badge into your README. It links back to the full report,
            so a reader can click through and scan their own repo — pick a repo and a style, then
            copy the snippet for Markdown, HTML, or AsciiDoc.
          </p>
          <div className="mt-6">
            <BadgeGenerator />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
