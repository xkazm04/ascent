"use client";

// Segment error boundary for an org dashboard. It catches throws from the sub-pages (rollup/aggregate
// fetches, etc.) and renders inside the org layout's Frame — so SiteHeader, the org header and OrgNav
// stay put while just the panel area shows the failure. (A throw in the layout itself escalates to the
// root boundary.) Most org failures are transient DB hiccups, hence the prominent retry. Uses the shared
// RouteError card (compact, in-shell) so the three boundaries stay in lockstep.

import { RouteError } from "@/components/ui/RouteError";

export default function OrgError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      {...props}
      title="This dashboard failed to load"
      description="An unexpected error occurred while loading this organization's data. This is often a transient database hiccup. Retrying usually resolves it."
      homeLabel="Home"
      logLabel="[org] dashboard route error"
    />
  );
}
