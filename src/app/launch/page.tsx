// /launch — the cinematic "mission control" entrance the OAuth callback now lands on.
// Renders the signed-in user's GitHub App installations as an animated star-map of
// constellations (one per org) that hydrate live as each org's repo/maturity data loads.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { FleetMap } from "@/components/launch/FleetMap";
import { getSessionState, isAuthConfigured, safeNext } from "@/lib/auth";

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
  const { session, status } = await getSessionState();

  // Direct visits without a session: prompt sign-in when auth is on, otherwise this
  // entrance has nothing to map — send the visitor to connect.
  if (!session) {
    if (!isAuthConfigured()) redirect("/connect");
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-3xl px-5 py-10">
          <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Mission Control</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Your engineering fleet awaits</h1>
          <p className="mt-2 max-w-xl text-slate-400">
            Sign in to chart your orgs and repositories as a living star-map of engineering maturity.
          </p>
          <SignInNotice next="/launch" expired={status === "expired"} />
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <FleetMap installations={session.installations} userName={session.name ?? session.login} next={next} />
      <SiteFooter />
    </>
  );
}
