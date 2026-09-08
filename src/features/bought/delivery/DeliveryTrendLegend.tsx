// The demoted prose of the Delivery trend section, and the one non-state symbol its legend needs.
//
// These two constants are the (D) Disclosed destinations for sentences that used to sit permanently
// under the small multiples. They are kept as named exports rather than inlined so the claim has one
// address: if the sampling model or the DORA position changes, it changes here and nowhere else.
//
// Server-safe — no hooks, no handlers.

/** Was: "A day's point describes the repos scanned that day, not the whole fleet. Hover any point for
 *  its sample size." Now the hint on the legend's `sample` chip. */
export const SAMPLE_HINT =
  "A day's point describes only the repos scanned that day, not the whole fleet — hover any point for the scan and repo count behind it.";

/**
 * Was the closing paragraph refusing the DORA label. The full argument now lives in
 * docs/features/org-dashboard/org-intelligence.md (§2.1 F); this is the one sentence the reader
 * needs at the chart.
 *
 * CORRECTED 2026-09-08. The old sentence said Ascent "does not ingest a deployment feed" — true when
 * it was written, stale since W4 shipped the Deployments API read, and tracked in the doc's Known
 * gaps as a residual. Deployment frequency and change-failure rate now exist, on the Delivery
 * outcomes card below; what is still missing is the incident feed behind time-to-restore. The label
 * is refused for the same reason as before, stated accurately.
 */
export const NAMING_HINT =
  "These are git and GitHub pull-request signals, deliberately not labelled DORA: time to merge is review latency, not lead time to production. Deployment frequency and change-failure rate do exist — on the Delivery outcomes card below, from the GitHub Deployments API — but time to restore needs an incident feed Ascent does not ingest.";

/** The hollow mock-engine dot, at legend scale — the same mark DeliveryTrendPanel draws. */
export function MockPointSwatch() {
  return (
    <svg viewBox="0 0 14 14" width={14} height={14} className="shrink-0" role="img" aria-label="Demo-engine day">
      <circle cx={7} cy={7} r={4} fill="var(--color-surface-strong)" stroke="var(--color-accent)" strokeWidth={1.75} />
    </svg>
  );
}
