"use client";

// React error boundary around ReportView. Suspense does NOT catch render-time exceptions,
// so a single bad field that slips past validation (or any unexpected render error) would
// otherwise blank the page / trip the Next error overlay with no recovery. This catches it
// and offers a retry instead.

import React from "react";

interface Props {
  children: React.ReactNode;
  /** Called by "Try again" when provided (e.g. re-run a live scan). Falls back to reload. */
  onRetry?: () => void;
  /** When any value here changes, a caught error is CLEARED and the children re-render. Without it the
   *  boundary is sticky: an error caught while viewing repo A stays on screen after the URL switches to
   *  repo B (the boundary never remounts across a searchParams change), until a full page reload. */
  resetKeys?: unknown[];
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
    if (this.props.onRetry) this.props.onRetry();
    else if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center py-24 text-center">
          <div className="text-5xl" aria-hidden>
            🧭
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">This report couldn&apos;t be displayed</h1>
          <p className="mt-2 max-w-md text-slate-400">
            Something in the report data didn&apos;t render. This is usually transient — try again.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="focus-ring mt-6 rounded-xl bg-accent px-5 py-2.5 text-base font-medium text-on-accent transition hover:bg-accent-soft"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
