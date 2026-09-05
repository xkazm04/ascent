// The weekly digest's wire contract — the one shape the model (`digest.ts`), the markdown serializer
// (`digest-markdown.ts`) and the Weekly digest tab (`src/features/bought/digest/`) all read. Pure
// types, no runtime, so a server panel and a node test can import it without dragging a client
// boundary. Every timestamp is an ISO string: the digest crosses to a server component only, but the
// wire-safe-dates rule is cheaper to honour than to argue about.
//
// Semantics fixed here so no renderer re-derives them:
//   - The window is the trailing 7 CALENDAR days in the org's canonical zone, half-open
//     `[start, endExclusive)` (src/lib/window.ts `weekRangeParams` → `resolveWindow`).
//   - A dimension delta is COHORT-MATCHED (repos scanned on both sides of the window); `null` means
//     "not measurable", which is not 0. `band` carries the presentation verdict so the page and the
//     markdown print the same word for the same number.
//   - "Closed" is a `RecommendationEvent` status change to `done` inside the window; "dismissed" is
//     counted beside it, never folded in. "Opened" is a derived identity diff (see
//     src/lib/db/org-followups-week.ts) and can be UNMEASURABLE — `openedMeasurable` says so.

export type DigestBand = "up" | "down" | "flat" | "unmeasured";

export interface DigestWindow {
  /** Canonical-zone day keys, inclusive on both ends as the user reads them (yyyy-mm-dd). */
  from: string;
  to: string;
  /** The half-open bounds the reads were made with, ISO. */
  start: string;
  endExclusive: string;
  /** Human title, e.g. "2026-08-26 → 2026-09-01". */
  title: string;
}

export interface DigestHeadline {
  overall: number;
  adoption: number;
  rigor: number;
  levelId: string;
  levelName: string;
  /** Cohort-matched movement over the window; null when there is no baseline or no overlap. */
  dOverall: number | null;
  dAdoption: number | null;
  dRigor: number | null;
  /** The denominator every delta above was measured over; null exactly when the deltas are null. */
  cohortSize: number | null;
  onboarded: number;
  departed: number;
  /** Coverage: scanned repos / repos in the org. */
  scanned: number;
  total: number;
}

export interface DigestDimDelta {
  dimId: string;
  label: string;
  now: number;
  delta: number | null;
  band: DigestBand;
}

export interface DigestFollowupRow {
  title: string;
  dimId: string;
  dimLabel: string;
  /** Repository full name ("owner/name"). */
  repo: string;
  /** ISO time of the closing event; null for an opened row (no creation event exists). */
  at: string | null;
  /** Who closed it: the rescan resolver (system event) or a person. Null on opened rows. */
  how: "scan" | "human" | null;
}

export interface DigestFollowups {
  closed: number;
  dismissed: number;
  closedRows: DigestFollowupRow[];
  opened: number;
  openedRows: DigestFollowupRow[];
  /** False when no repository had a scan before the window start — the diff has nothing to compare. */
  openedMeasurable: boolean;
  /** Repos excluded from the opened diff because they had no pre-window scan. */
  unmeasuredRepos: number;
}

export interface DigestAction {
  rank: 1 | 2 | 3;
  title: string;
  dimId: string;
  dimLabel: string;
  impact: string;
  repoCount: number;
  projectedPoints: number | null;
  liftsRepos: number;
  /** The one-sentence form (`nextMoveLine` for rank 1; a shorter line for 2 and 3). */
  line: string;
}

export interface DigestMover {
  name: string;
  fullName?: string;
  dOverall: number;
  levelFrom: string;
  levelTo: string;
}

export interface DigestMovement {
  gainers: DigestMover[];
  regressers: DigestMover[];
  /** Repos compared on both sides of the window. */
  compared: number;
}

export interface DigestProvenance {
  /** Scans that finished inside the window; null when the count could not be read. */
  scansInWindow: number | null;
  /** The mock-engine caveat for the window, or null when every score came from a live engine. */
  engineCaveat: string | null;
  /** One line per read that degraded — printed, never swallowed. */
  notes: string[];
}

export interface WeeklyDigest {
  org: string;
  /** yyyy-mm-dd */
  generatedOn: string;
  window: DigestWindow;
  headline: DigestHeadline;
  dims: DigestDimDelta[];
  followups: DigestFollowups | null;
  actions: DigestAction[];
  movement: DigestMovement | null;
  provenance: DigestProvenance;
}
