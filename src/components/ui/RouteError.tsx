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
//
// app-shell-1: the card is a place to act, not a report of state. Retries are counted per error (the
// pure rules live in routeErrorModel.ts); after two failed tries the primary action becomes a prefilled
// report on this deployment's tracker (digest + redacted route only), or "Copy details" when the
// deployment names no tracker. Each error is forwarded to Sentry once (browser SDK; a no-op without
// NEXT_PUBLIC_SENTRY_DSN, see src/instrumentation-client.ts). global-error.tsx only catches a throw in
// the root layout, which never reaches this card, so the two never send the same error.

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HEADER_INNER, HEADER_SHELL, Logo } from "@/components/StaticNav";
import { CTA_OUTLINE, CTA_PRIMARY } from "@/lib/ui";
import {
  actionsFor,
  browserRetryStore,
  errorKey,
  issueTrackerBase,
  readAttempts,
  recordRetry,
  reportDetails,
  reportHref,
  shouldCapture,
} from "./routeErrorModel";

/** The count only changes through this tab's own click, which remounts the card, so nothing to watch. */
const noSubscribe = () => () => {};

function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

/** The no-tracker fallback: copies the same redacted details the report link would carry. */
function CopyDetailsButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <button type="button" onClick={copy} className={CTA_PRIMARY}>
      {copied ? "Copied" : "Copy details"}
    </button>
  );
}

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
  const key = errorKey(error, currentPath());
  // Server snapshot 0: the escalated state (and the path-bearing report link) never renders during
  // SSR/hydration, so a stored count cannot cause a hydration mismatch.
  const attempts = useSyncExternalStore(
    noSubscribe,
    () => readAttempts(browserRetryStore(), key),
    () => 0,
  );
  const actions = actionsFor({ attempts });
  useEffect(() => {
    console.error(logLabel, { digest: error.digest, message: error.message, stack: error.stack });
    if (shouldCapture(key)) {
      Sentry.captureException(error, {
        tags: { boundary: logLabel, ...(error.digest ? { digest: error.digest } : {}) },
      });
    }
  }, [error, logLabel, key]);

  // "Try again" recovery: reset() alone only re-renders the boundary with the SAME, still-cached server
  // output, so a SERVER-thrown error (the common case here) re-throws immediately and looks unrecoverable.
  // router.refresh() first re-runs the server components with fresh data, THEN reset() re-renders the
  // boundary against that fresh result — the real recovery. (app-shell-seo-error-pages #3)
  const retry = () => {
    recordRetry(browserRetryStore(), key);
    router.refresh();
    reset();
  };

  const report = { digest: error.digest, path: currentPath(), label: logLabel };
  const trackerBase = actions.showReport ? issueTrackerBase() : null;
  const reportAction = !actions.showReport ? null : trackerBase ? (
    <a href={reportHref(report, trackerBase)} target="_blank" rel="noopener noreferrer" className={CTA_PRIMARY}>
      Report this
    </a>
  ) : (
    <CopyDetailsButton text={reportDetails(report)} />
  );

  const inner = (
    <>
      <p className="type-mono-sm uppercase tracking-[0.3em] text-danger">Error</p>
      <h1 className="mt-4 type-heading font-semibold text-white sm:type-display">{title}</h1>
      <p className="mt-3 max-w-md type-body text-slate-400">{description}</p>
      {error.digest && <p className="mt-2 type-mono-sm text-slate-500">Reference: {error.digest}</p>}
      {actions.escalated && (
        <p role="status" className="mt-4 max-w-md type-body-sm text-slate-300">
          {`Still failing after ${attempts} tries, so this is not a transient error. Reporting it is the fastest way to a fix.`}
        </p>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {reportAction}
        <button onClick={retry} className={actions.primary === "retry" ? CTA_PRIMARY : CTA_OUTLINE}>
          {actions.retryLabel}
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
