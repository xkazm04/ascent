"use client";

// Shared App Router error-boundary card. An error.tsx MUST be a Client Component and stay self-contained
// (no @/components/Brand — that pulls in server-only @/lib/auth, which can't be bundled into a client
// component), so this depends only on react + next/link + the pure-string @/lib/ui constants + the
// dependency-free StaticNav leaf. The root boundary renders it full-screen; a segment boundary renders
// the compact card inside its own persistent layout (e.g. the org shell keeps SiteHeader + OrgNav). One
// card, one bounded telemetry line — so the three boundaries can't drift.
//
// G6-13: the full-screen case used to render with ZERO brand chrome — no logo, nothing — while the 404
// page (not-found.tsx) solved the identical "can't use the real async SiteHeader here" problem with a
// dependency-free static header. A genuine runtime error is the most stressful screen a user can hit;
// it shouldn't look less trustworthy than a 404. Logo now lives in StaticNav.tsx specifically so it can
// be imported here (next/image + next/link only, no server-only auth import) — see that file's comment.

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HEADER_INNER, HEADER_SHELL, Logo } from "@/components/StaticNav";
import { CTA_OUTLINE, CTA_PRIMARY } from "@/lib/ui";

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
        <button onClick={retry} className={CTA_PRIMARY}>
          Try again
        </button>
        <Link href={homeHref} className={CTA_OUTLINE}>
          {homeLabel}
        </Link>
      </div>
    </>
  );

  if (fullScreen) {
    return (
      <>
        <header className={HEADER_SHELL}>
          <div className={HEADER_INNER}>
            <Link href="/" className="focus-ring rounded-sm">
              <Logo />
            </Link>
          </div>
        </header>
        <main
          id="main"
          className="mx-auto flex min-h-[calc(100vh-var(--header-h))] w-full max-w-2xl flex-1 flex-col items-center justify-center px-5 py-24 text-center"
        >
          {inner}
        </main>
      </>
    );
  }
  return <div className="mx-auto w-full max-w-2xl px-5 py-20 text-center">{inner}</div>;
}
