"use client";

// React error boundary around ReportView. Suspense does NOT catch render-time exceptions,
// so a single bad field that slips past validation (or any unexpected render error) would
// otherwise blank the page / trip the Next error overlay with no recovery. This catches it
// and offers a retry instead.
//
// G6-03: when no `onRetry` is supplied (the pinned permalink case), the old fallback was a blind
// `window.location.reload()`. For a render-time throw on DETERMINISTIC, persisted data — the exact
// case a pinned `/report/{owner}/{repo}` permalink hits — reloading re-fetches the SAME bad report
// and re-renders the SAME code path, so it crashes again immediately: a reload -> crash loop with no
// exit for the visitor. A retry that cannot possibly succeed must not be offered as "Try again" — the
// boundary instead offers two links that actually change the state that crashed: force a fresh live
// scan of this repo (a different code path — /report?...&fresh=1, not the pinned-snapshot reader), or
// leave for another repo entirely.

import React from "react";
import Link from "next/link";

interface Props {
  children: React.ReactNode;
  /** Called by "Try again" when provided (e.g. re-run a live scan). */
  onRetry?: () => void;
  /** When any value here changes, a caught error is CLEARED and the children re-render. Without it the
   *  boundary is sticky: an error caught while viewing repo A stays on screen after the URL switches to
   *  repo B (the boundary never remounts across a searchParams change), until a full page reload. */
  resetKeys?: unknown[];
  /** Canonical `owner/name[@headSha]` ref of the report being viewed, used ONLY to build the terminal
   *  "scan fresh" escape hatch when `onRetry` is absent (e.g. the pinned permalink page). When omitted,
   *  the fallback just offers a generic "scan another repo" link. */
  repoRef?: string;
}

interface State {
  error: Error | null;
  prevKeys: unknown[];
}

/** Shallow, order-sensitive compare of two resetKeys arrays (identity per element). */
function keysDiffer(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return true;
  return false;
}

export class ReportErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, prevKeys: this.props.resetKeys ?? [] };

  // Returns a partial state (merged like setState), so it keeps the tracked `prevKeys`.
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  // Runs before every render: if the reset keys moved (e.g. the report's repo changed) drop any stale
  // caught error so the new content gets a chance to render instead of the previous repo's error card.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const next = props.resetKeys ?? [];
    if (keysDiffer(state.prevKeys, next)) {
      return state.error ? { error: null, prevKeys: next } : { prevKeys: next };
    }
    return null;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[report] render error", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.error) {
      const { onRetry, repoRef } = this.props;
      return (
        <div className="flex flex-col items-center py-24 text-center">
          <div className="text-5xl" aria-hidden>
            🧭
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">This report couldn&apos;t be displayed</h1>
          <p className="mt-2 max-w-md text-slate-400">
            {onRetry
              ? "Something in the report data didn't render. This is usually transient — try again."
              : "Something in this saved report didn't render, and reloading would only show the same result. Run a fresh scan or try a different repo instead."}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {onRetry ? (
              <button
                type="button"
                onClick={this.handleRetry}
                className="focus-ring rounded-xl bg-accent px-5 py-2.5 text-base font-medium text-on-accent transition hover:bg-accent-soft"
              >
                Try again
              </button>
            ) : (
              <>
                {repoRef && (
                  <Link
                    href={`/report?repo=${encodeURIComponent(repoRef)}&fresh=1`}
                    className="focus-ring rounded-xl bg-accent px-5 py-2.5 text-base font-medium text-on-accent transition hover:bg-accent-soft"
                  >
                    Scan {repoRef} fresh
                  </Link>
                )}
                <Link
                  href="/?scan=1"
                  className="focus-ring rounded-xl border border-slate-700 px-5 py-2.5 text-base font-medium text-slate-200 transition hover:bg-slate-900"
                >
                  Scan another repo
                </Link>
              </>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
