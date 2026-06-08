"use client";

// Segment error boundary for an org dashboard. It catches throws from the sub-pages (rollup/aggregate
// fetches, etc.) and renders inside the org layout's Frame — so SiteHeader, the org header and OrgNav
// stay put while just the panel area shows the failure. (A throw in the layout itself escalates to the
// root boundary.) Most org failures are transient DB hiccups, hence the prominent retry.

import { useEffect } from "react";
import Link from "next/link";

export default function OrgError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[org] dashboard route error:", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-20 text-center">
      <p className="font-mono text-sm uppercase tracking-[0.3em] text-danger">Error</p>
      <h1 className="mt-4 text-2xl font-semibold text-white">This dashboard failed to load</h1>
      <p className="mt-3 text-base text-slate-400">
        An unexpected error occurred while loading this organization&apos;s data. This is often a
        transient database hiccup — retrying usually resolves it.
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
          Home
        </Link>
      </div>
    </div>
  );
}
