"use client";

// Segment error boundary for the report permalink. The page renders its own SiteHeader/SiteFooter
// (there's no intermediate layout), so when it throws this boundary replaces the whole page body -
// hence fullScreen, which brings the shared card's own static chrome (home-linked logo).
//
// It used to be a hand-rolled fork whose Try again was reset() alone: the dead button RouteError was
// fixed for (reset re-renders the same cached server payload, which throws again). As a RouteError
// caller it gets refresh-then-reset, the retry counter, the prefilled report and the Sentry capture.

import { RouteError } from "@/components/ui/RouteError";

export default function ReportError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      {...props}
      fullScreen
      title="Couldn't load this report"
      description="Something went wrong rendering this repository's maturity report. It may be a transient scan or data issue. Try again, or scan the repo fresh."
      homeLabel="Scan another repo"
      logLabel="[report] permalink route error"
    />
  );
}
