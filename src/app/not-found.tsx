// Root 404. A server throw or unknown path previously fell through to Next's bare default screen;
// this keeps the brand chrome and points lost visitors back into the funnel.

import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { DEMO_ORG_HREF } from "@/lib/site";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
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
          <Link
            href="/"
            className="focus-ring rounded-md bg-accent px-4 py-2 font-medium text-on-accent transition hover:bg-accent-soft"
          >
            Scan a repo
          </Link>
          <Link
            href={DEMO_ORG_HREF}
            className="focus-ring rounded-md border border-slate-700 px-4 py-2 text-slate-200 transition hover:border-accent hover:text-white"
          >
            See an org demo
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
