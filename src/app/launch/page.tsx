// /launch — the cinematic "mission control" entrance the OAuth callback now lands on.
// Renders the signed-in user's GitHub App installations as an animated star-map of
// constellations (one per org) that hydrate live as each org's repo/maturity data loads.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { FleetMap } from "@/components/launch/FleetMap";
import { safeNext } from "@/lib/auth";
import { resolveSignInState } from "@/lib/signin-gate";
import { viewerDisplayName, viewerInstallations } from "@/lib/viewer-installations";

export const dynamic = "force-dynamic";

// MAP-5: a branded social card (the co-located opengraph-image renders the constellation). The page
// itself is per-viewer + session-gated, so the card is brand-level, not a specific fleet.
export const metadata: Metadata = {
  title: "Mission Control — your engineering fleet · Ascent",
  description:
    "Your engineering fleet, mapped as living constellations — each org a cluster, each repo a star that brightens with its AI-native maturity.",
  openGraph: { title: "Mission Control · Ascent", type: "website" },
  twitter: { card: "summary_large_image", title: "Mission Control · Ascent" },
};

export default async function LaunchPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: nextParam } = await searchParams;
  // Re-validate the carried-along destination (defense in depth — the value rode in on a
  // query param) and default to the connect dashboard.
  const next = safeNext(nextParam, "/connect");
  // This page was UNREACHABLE in production. It read the dormant custom-OAuth session, which is never
  // minted under the Supabase wall, so `!session` was always true — and the guard inside it then read
  // `if (!isAuthConfigured()) redirect("/connect")`, which is also always true. Every visitor, signed in
  // or not, was bounced to /connect. Resolve the prompt from whichever stack is live, and the
  // installations from the DB when the viewer's identity is a Supabase one.
  const { needsSignIn, provider, expired } = await resolveSignInState();
  if (needsSignIn) {
    return (
      <>
        <SiteHeader />
        {/* id="main" is the global skip-to-content target (layout.tsx). Without it the always-present
            "Skip to content" link no-ops on this sign-in prompt — a WCAG 2.4.1 bypass-blocks failure.
            (The signed-in view's landmark lives on FleetMap's own <main>.) */}
        <main id="main" className="mx-auto w-full max-w-3xl px-5 py-10">
          <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Mission Control</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Your engineering fleet awaits</h1>
          <p className="mt-2 max-w-xl text-slate-400">
            Sign in to chart your orgs and repositories as a living star-map of engineering maturity.
          </p>
          <SignInNotice next="/launch" provider={provider} expired={expired} />
        </main>
        <SiteFooter />
      </>
    );
  }

  const installations = await viewerInstallations();
  // Signed in (or auth-off) but nothing installed: this entrance has nothing to map, so send the visitor
  // where they can install the App. Same intent as the original redirect — it just now depends on the
  // actual fleet rather than on a session object that production never creates.
  if (!installations.length) redirect("/connect");

  const viewerName = await viewerDisplayName();

  return (
    <>
      <SiteHeader />
      <FleetMap installations={installations} userName={viewerName} next={next} />
      <SiteFooter />
    </>
  );
}
