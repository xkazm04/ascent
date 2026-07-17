// Root 404. A server throw or unknown path previously fell through to Next's bare default screen;
// this keeps the brand chrome and points lost visitors back into the funnel.
//
// The full SiteHeader is intentionally NOT used here: it's an async server component that awaits
// getSession()/getActiveOrg() (auth + DB). If that fragile path throws while rendering a 404 (e.g. a
// transient Aurora DSQL token blip), the not-found render itself throws and cascades to the bare,
// chrome-less global-error 500 — a plain "page not found" turning into a scary crash. A lightweight
// STATIC header (no session/DB) keeps the brand chrome robust on exactly those transient failures.

import Link from "next/link";
import { Logo, SiteFooter } from "@/components/Brand";
import { HEADER_INNER, HEADER_NAV, HEADER_SHELL, MarketingNavLinks } from "@/components/StaticNav";
import { isDbConfigured } from "@/lib/db";
import { demoOrgHref } from "@/lib/site";
import { CTA_OUTLINE, CTA_PRIMARY } from "@/lib/ui";

// Static, session-free header for the 404 shell — renders SiteHeader's static nav without any of its
// auth/DB lookups, so this boundary can never throw its way into the 500 document. The shell classes
// and link list come from StaticNav (a dependency-free leaf both headers consume), so a nav change in
// SiteHeader can no longer silently leave this copy stale.
function StaticHeader() {
  return (
    <header className={HEADER_SHELL}>
      <div className={HEADER_INNER}>
        <Link href="/" className="focus-ring rounded-sm">
          <Logo />
        </Link>
        <nav className={HEADER_NAV}>
          <MarketingNavLinks />
        </nav>
      </div>
    </header>
  );
}

export default function NotFound() {
  const dbOn = isDbConfigured();
  return (
    <>
      <StaticHeader />
      <main
        id="main"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 py-24 text-center"
      >
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-accent">404</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">This page drifted off the map</h1>
        <p className="mt-3 max-w-md text-base text-slate-400">
          The page you&apos;re looking for doesn&apos;t exist or has moved. Scan a repository to see
          its AI-native maturity report, or head back to the start.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/?scan=1" className={CTA_PRIMARY}>
            Scan a repo
          </Link>
          {/* The org demo dashboard needs a DB; on the supported no-DB MVP deploy the header hides it
              (Brand.tsx gates on isDbConfigured), so the 404 must too - otherwise it funnels a lost
              visitor to an empty org page. Fall back to the always-valid pricing page instead. */}
          {dbOn ? (
            <Link href={demoOrgHref()} className={CTA_OUTLINE}>
              See an org demo
            </Link>
          ) : (
            <Link href="/pricing" className={CTA_OUTLINE}>
              See pricing
            </Link>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
