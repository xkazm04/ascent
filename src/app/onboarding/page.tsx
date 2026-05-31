import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Onboarding · Ascent",
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // Seed the activation checklist from a real signal: does the session have a GitHub App
  // installation? (Safely false when auth/App isn't configured.)
  const session = await getSession();
  const hasInstallation = (session?.installations.length ?? 0) > 0;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        {/* animate-fade-up on the header to match connect/page's entrance (Phase 4). */}
        <div className="animate-fade-up mb-8">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">Get started</div>
          <h1 className="mt-1 text-3xl font-bold text-white">Scan your organization</h1>
          <p className="mt-2 text-slate-400">
            Pick up to ten repositories. Ascent scans them in one shot and builds a cross-repo view —
            separating the <span className="text-slate-200">gaps common across your org</span> (fix once,
            reuse a practice) from the <span className="text-slate-200">repo-specific</span> ones.
          </p>
        </div>
        <OnboardingFlow hasInstallation={hasInstallation} />
      </main>
      <SiteFooter />
    </>
  );
}
