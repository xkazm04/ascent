"use client";

// Segment error boundary for the report permalink. The page renders its own SiteHeader/SiteFooter
// (there's no intermediate layout), so when it throws this boundary replaces the whole page body —
// hence it carries its own minimal chrome (wordmark + footer) instead of relying on shared layout
// components (which are async server components and can't be used from a client boundary).

import { useEffect } from "react";
import Link from "next/link";

export default function ReportError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[report] permalink route error:", error);
  }, [error]);

  return (
    <>
      <header className="border-b border-slate-800/70 bg-ink/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center px-5 py-3.5">
          <Link
            href="/"
            className="focus-ring rounded-sm font-mono text-base font-semibold uppercase tracking-[0.22em] text-white"
          >
            Ascent
          </Link>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 py-24 text-center"
      >
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-danger">Error</p>
        <h1 className="mt-4 text-2xl font-semibold text-white">Couldn&apos;t load this report</h1>
        <p className="mt-3 max-w-md text-base text-slate-400">
          Something went wrong rendering this repository&apos;s maturity report. It may be a transient
          scan or data issue — try again, or scan the repo fresh.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-sm text-slate-500">Reference: {error.digest}</p>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => reset()}
            className="focus-ring rounded-md bg-accent px-4 py-2 font-medium text-on-accent transition hover:bg-accent-soft"
          >
            Try again
          </button>
          <Link
            href="/"
            className="focus-ring rounded-md border border-slate-700 px-4 py-2 text-slate-200 transition hover:border-accent hover:text-white"
          >
            Scan another repo
          </Link>
        </div>
      </main>
      <footer className="mt-auto border-t border-slate-800/70 py-8 text-center text-sm text-slate-500">
        Scored by Ascent
      </footer>
    </>
  );
}
