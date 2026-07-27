import { type SortKey } from "./fleetMapDerive";

// After a manual scan finishes, its fresh scores need a moment to land in /api/app/repos. Skip the
// ~90s live refresh for that org until this window elapses, so the poll can't pull a still-stale
// payload and dim a just-brightened star back down (MAP-6 race). Longer than the refresh interval so
// at least one poll is deferred past a scan's completion.
export const SCAN_SETTLE_MS = 120_000;

/** Cadence of the MAP-6 live refresh: every visible-tab poll cycle re-pulls each org's stars.
 *  SCAN_SETTLE_MS is deliberately longer than this so at least one poll is deferred past a scan. */
export const POLL_INTERVAL_MS = 90_000;

/**
 * How many orgs may have a `/api/app/repos` pull IN FLIGHT at once (mount burst and every poll cycle).
 *
 * The map fired one request PER ORG with no bound, so a 20-org fleet opened 20 sockets on mount and
 * again every 90s. Six is the browsers' own per-origin HTTP/1.1 connection limit: above it the extra
 * requests only queue in the socket pool anyway, while starving the requests that matter at that
 * moment — a running scan's SSE stream and the user's own navigations. At or below the cap (the
 * overwhelming majority of fleets) the behavior is exactly the old parallel `Promise.all`; above it
 * the same orgs are still all polled each cycle, just six at a time, so nothing goes stale.
 */
export const POLL_ORG_CAP = 6;

/**
 * Ceiling on the per-org exponential poll backoff. A permanently failing org (App uninstalled, a 502
 * from the GitHub side, a revoked grant) used to be re-fetched every 90s forever. Backoff doubles from
 * one poll interval — 90s, 180s, 360s, 720s — and parks here, so a dead org costs ~4 requests/hour
 * instead of 40 while every HEALTHY org keeps its normal cadence. A single blip's first retry is at
 * 90s, i.e. the normal next tick: transient failures are not punished.
 */
export const POLL_BACKOFF_MAX_MS = 15 * 60_000;

export const LEVEL_BANDS = ["L1", "L2", "L3", "L4", "L5", "unscanned"] as const;
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "name" },
  { key: "maturity", label: "maturity" },
  { key: "repos", label: "repos" },
  { key: "movement", label: "movement" },
];

// Kept structurally identical to the session's UserInstallation, but declared locally so
// this client component never imports the server-only auth module.
export interface Installation {
  id: number;
  login: string;
}
