import { type SortKey } from "./fleetMapDerive";

// After a manual scan finishes, its fresh scores need a moment to land in /api/app/repos. Skip the
// ~90s live refresh for that org until this window elapses, so the poll can't pull a still-stale
// payload and dim a just-brightened star back down (MAP-6 race). Longer than the refresh interval so
// at least one poll is deferred past a scan's completion.
export const SCAN_SETTLE_MS = 120_000;

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
