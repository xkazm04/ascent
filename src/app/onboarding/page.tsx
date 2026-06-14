import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { getSession } from "@/lib/auth";
import { getOrgRollup } from "@/lib/db";

export const metadata: Metadata = {
  title: "Onboarding · Ascent",
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // Seed the activation checklist from a real signal: does the session have a GitHub App
  // installation? (Safely false when auth/App isn't configured.) Pass the installations
  // themselves down so the org step can pull private repos through the App, not just the
  // public listing.
  const session = await getSession();
  const installations = (session?.installations ?? []).map((i) => ({ login: i.login, id: String(i.id) }));
  const hasInstallation = installations.length > 0;
  // Orgs auto-discovered at login (public memberships + repo activity under the default read:user
  // scope; full membership only when the token carries read:org — see buildAuthorizeUrl): not-yet-
  // installed orgs to suggest scanning, and the most-active org whose watchlist we pre-seeded so
  // its dashboard already has data to explore.
  const suggestedOrgs = session?.suggestedOrgs ?? [];
  const seededOrg = session?.seededOrg;

  // ONB-2 (server half): has this viewer already scanned repos in one of their orgs? If so, offer a
  // "welcome back" jump to that dashboard instead of a cold start. Cheap: only the viewer's own org
  // slugs (installations + the seeded org), capped, rollups fetched concurrently; the first with a
  // scanned repo wins. The client wizard separately resumes an *in-progress* (unfinished) flow.
  const candidateSlugs = Array.from(
    new Set([...installations.map((i) => i.login.toLowerCase()), ...(seededOrg ? [seededOrg.toLowerCase()] : [])]),
  ).slice(0, 6);
  const rollups = await Promise.all(candidateSlugs.map((s) => getOrgRollup(s).catch(() => null)));
  const scannedOrg = candidateSlugs.find((_, i) => (rollups[i]?.scannedCount ?? 0) > 0) ?? null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        {scannedOrg && (
          <div className="animate-fade-up mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
            <div className="text-base text-slate-200">
              <span className="font-medium text-white">Welcome back.</span> You&apos;ve already scanned repos in{" "}
              <span className="font-mono text-accent">{scannedOrg}</span> — pick up where you left off, or scan more below.
            </div>
            <Link
              href={`/org/${encodeURIComponent(scannedOrg)}`}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              View dashboard →
            </Link>
          </div>
        )}
        {/* animate-fade-up on the header to match connect/page's entrance (Phase 4). */}
        <div className="animate-fade-up mb-8">
          <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Get started</div>
          <h1 className="mt-1 text-3xl font-bold text-white">Scan your organization</h1>
          <p className="mt-2 text-slate-400">
            Pick up to ten repositories. Ascent scans them in one shot and builds a cross-repo view —
            separating the <span className="text-slate-200">gaps common across your org</span> (fix once,
            reuse a practice) from the <span className="text-slate-200">repo-specific</span> ones.
          </p>
        </div>
        <OnboardingFlow
          hasInstallation={hasInstallation}
          installations={installations}
          suggestedOrgs={suggestedOrgs}
          seededOrg={seededOrg}
        />
      </main>
      <SiteFooter />
    </>
  );
}
