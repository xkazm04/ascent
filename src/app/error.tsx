"use client";

// Root-segment error boundary: the application-wide fallback for any throw NOT caught by a nearer
// error.tsx. Most importantly it catches a throw in a NESTED LAYOUT (e.g. org/[slug]/layout.tsx) —
// which that segment's own error.tsx cannot catch, because the boundary renders inside the very
// layout that failed — and which would otherwise fall through to the bare, chrome-less global-error
// document (a full-page replacement). Rendered inside the root layout, so it keeps the brand chrome
// (SiteHeader/SiteFooter), matching not-found.tsx. The nearer org/[slug]/error.tsx still handles
// ordinary org sub-page failures in-shell; this only catches what escapes those boundaries.

import { useEffect } from "react";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] route error:", error);
  }, [error]);

  return (
    <>
      <SiteHeader />
      <main
        id="main"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-5 py-24 text-center"
      >
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-danger">Error</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Something went wrong</h1>
        <p className="mt-3 max-w-md text-base text-slate-400">
          An unexpected error occurred while loading this page. This is usually a transient hiccup —
          retrying often resolves it.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-sm text-slate-500">Reference: {error.digest}</p>
        )}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
            Back to home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
