"use client";

// Shared App Router error-boundary card. An error.tsx MUST be a Client Component and stay self-contained
// (no @/components/Brand — that pulls in server-only @/lib/auth, which can't be bundled into a client
// component), so this depends only on react + next/link. The root boundary renders it full-screen; a
// segment boundary renders the compact card inside its own persistent layout (e.g. the org shell keeps
// SiteHeader + OrgNav). One card, one bounded telemetry line — so the three boundaries can't drift.

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function RouteError({
  error,
  reset,
  title,
  description,
  homeHref = "/",
  homeLabel = "Back to home",
  logLabel,
  fullScreen = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
  description: string;
  homeHref?: string;
  homeLabel?: string;
  /** A stable, greppable prefix for the single structured console.error the log drain can alert on. */
  logLabel: string;
  /** Root boundary: fill the viewport (the app-wide fallback). Segment boundary: compact in-shell card. */
  fullScreen?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error(logLabel, { digest: error.digest, message: error.message, stack: error.stack });
  }, [error, logLabel]);

  // "Try again" recovery: reset() alone only re-renders the boundary with the SAME, still-cached server
  // output, so a SERVER-thrown error (the common case here) re-throws immediately and looks unrecoverable.
  // router.refresh() first re-runs the server components with fresh data, THEN reset() re-renders the
  // boundary against that fresh result — the real recovery. (app-shell-seo-error-pages #3)
  const retry = () => {
    router.refresh();
    reset();
  };

  const inner = (
    <>
      <p className="font-mono text-sm uppercase tracking-[0.3em] text-danger">Error</p>
      <h1 className="mt-4 text-2xl font-semibold text-white sm:text-3xl">{title}</h1>
      <p className="mt-3 max-w-md text-base text-slate-400">{description}</p>
      {error.digest && <p className="mt-2 font-mono text-sm text-slate-500">Reference: {error.digest}</p>}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={retry}
          className="focus-ring rounded-md bg-accent px-4 py-2 font-medium text-on-accent transition hover:bg-accent-soft"
        >
          Try again
        </button>
        <Link
          href={homeHref}
          className="focus-ring rounded-md border border-slate-700 px-4 py-2 text-slate-200 transition hover:border-accent hover:text-white"
        >
          {homeLabel}
        </Link>
      </div>
    </>
  );

  if (fullScreen) {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen w-full max-w-2xl flex-1 flex-col items-center justify-center px-5 py-24 text-center"
      >
        {inner}
      </main>
    );
  }
  return <div className="mx-auto w-full max-w-2xl px-5 py-20 text-center">{inner}</div>;
}
