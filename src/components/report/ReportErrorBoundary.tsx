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
}

interface State {
  error: Error | null;
}

export class ReportErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
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
            className="focus-ring mt-6 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-[#04070e] transition hover:bg-accent-soft"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
