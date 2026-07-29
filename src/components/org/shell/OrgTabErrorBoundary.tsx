"use client";

// Contains a single tab panel's render crash to that panel: the org header, the section rail and the
// tour drawer all survive, and the user can pick another tab instead of meeting the segment's
// error.tsx full-page card.
//
// Suspense does NOT catch render-time exceptions, so the boundary is a separate wrapper around it.
// `resetKey` is the active tab id: when it changes the caught error is dropped, so an error thrown
// on Audit does not stay on screen after switching to Overview (a boundary never remounts on its own
// across a searchParams change, and would otherwise be sticky until a full reload).

import React from "react";

interface Props {
  children: React.ReactNode;
  /** The active tab id. A change clears any caught error. */
  resetKey: string;
}

interface State {
  error: Error | null;
  prevKey: string;
}

export class OrgTabErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, prevKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.prevKey) return null;
    return { error: null, prevKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[org] tab render error", this.props.resetKey, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-2xl border border-slate-800 bg-surface/40 p-8 text-center">
        <h2 className="text-lg font-semibold text-white">This tab couldn&apos;t be displayed</h2>
        <p className="mx-auto mt-2 max-w-md text-slate-400">
          Something in this view didn&apos;t render. The rest of the dashboard is fine — pick another
          section from the rail, or reload to try again.
        </p>
      </div>
    );
  }
}
