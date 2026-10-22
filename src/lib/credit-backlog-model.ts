// The CREDIT BACKLOG: watched repos whose newest rescore job was skipped for insufficient credits, and
// the honest one-click resume of them. Pure and client-safe (no db, no "use client" import), because
// both the credits route (the fold) and the popover (the plan) run it.
//
// Why it exists: a cadence job that cannot reserve a credit settles `skipped` / "insufficient credits"
// AND moves the repo a FULL cadence out (scan-queue-worker.ts, settleCadence), so after a top-up the
// repo stays stale for a week or a month and nothing on the credits surface says so. The ScanJob row is
// the only trace a cadence skip leaves; this fold reads it back.
//
// A skip is read from the job's settled state and error, never from `creditCharged`: a skipped job
// never reserved anything, and whether a job HOLDS a credit is the ledger's answer
// (db/credit-reservations.ts), not this module's question.

/** The error string a credit skip settles with (CREDIT_SKIP_ERROR in db/org-watch.ts). */
export const CREDIT_SKIP = "insufficient credits";

/** One rescore job as the backlog read hands it over. `at` is when it settled (or was last touched
 *  while still pending), as an ISO string. */
export interface CreditSkipJob {
  repoFullName: string;
  lane: string;
  reason: string;
  state: string;
  error: string | null;
  at: string;
}

/** What enqueued the skipped job: the schedule, a push webhook, the import funnel, or a person. */
export type CreditBacklogVia = "cadence" | "push" | "import" | "manual";

export interface CreditBacklogRepo {
  repo: string;
  /** ISO string (this crosses to the popover; see src/lib/db/wire-safe.ts). */
  skippedAt: string;
  via: CreditBacklogVia;
}

export interface CreditBacklog {
  count: number;
  /** Oldest skip first: the order a partial resume takes them in. */
  repos: CreditBacklogRepo[];
  oldestSkippedAt: string | null;
}

function viaOf(reason: string): CreditBacklogVia {
  if (reason === "cadence") return "cadence";
  if (reason.startsWith("webhook:")) return "push";
  if (reason === "import") return "import";
  return "manual";
}

/**
 * Fold rescore jobs to the repos whose NEWEST job is a credit skip. A newer job of any state (done,
 * failed for another reason, or still queued) means the repo is not owed, and so does a scan that
 * landed after the skip by another path (`lastScanAt`, keyed by repo full name).
 */
export function foldCreditBacklog(jobs: CreditSkipJob[], lastScanAt: Record<string, string | null> = {}): CreditBacklog {
  const newest = new Map<string, CreditSkipJob>();
  for (const j of jobs) {
    if (j.lane !== "rescore") continue;
    const key = j.repoFullName.toLowerCase();
    const prev = newest.get(key);
    if (!prev || j.at > prev.at) newest.set(key, j);
  }
  const scanned = new Map(Object.entries(lastScanAt).map(([k, v]) => [k.toLowerCase(), v]));
  const repos: CreditBacklogRepo[] = [];
  for (const [key, j] of newest) {
    if (j.state !== "skipped" || j.error !== CREDIT_SKIP) continue;
    const last = scanned.get(key);
    if (last && last > j.at) continue;
    repos.push({ repo: j.repoFullName, skippedAt: j.at, via: viaOf(j.reason) });
  }
  repos.sort((a, b) => (a.skippedAt < b.skippedAt ? -1 : a.skippedAt > b.skippedAt ? 1 : 0));
  return { count: repos.length, repos, oldestSkippedAt: repos[0]?.skippedAt ?? null };
}

export interface ResumeCredit {
  balance: number;
  allowanceRemaining: number | null;
  unlimited: boolean;
}

export interface ResumePlan {
  /** The repos one click sends to POST /api/org/scan, oldest skip first. */
  repos: string[];
  /** Owed repos the click leaves for later (no capacity for them yet). */
  deferred: number;
  /** Prepaid credits the click draws at most; null when no figure is honest (unlimited plan). */
  drawsUpTo: number | null;
  /** Why the action is disabled, or null when it can run. */
  reason: "top-up-first" | null;
}

/**
 * Plan the resume against the SAME cap /api/org/scan applies (balance + free allowance left), so the
 * button never promises a repo the route would slice off. The draw is `immediateScanCredits`'s
 * arithmetic (components/credit/WatchCostTail.tsx): count minus the free scans left, never below 0.
 * It is restated here rather than imported because that module is "use client", and a server route
 * importing it would receive a client reference instead of a function; a test pins the two equal.
 */
export function resumePlan(owed: CreditBacklogRepo[], credit: ResumeCredit): ResumePlan {
  const ordered = [...owed].sort((a, b) => (a.skippedAt < b.skippedAt ? -1 : a.skippedAt > b.skippedAt ? 1 : 0));
  if (credit.unlimited) return { repos: ordered.map((r) => r.repo), deferred: 0, drawsUpTo: null, reason: null };
  const allowance = Math.max(0, credit.allowanceRemaining ?? 0);
  const capacity = Math.max(0, credit.balance) + allowance;
  const repos = ordered.slice(0, capacity).map((r) => r.repo);
  return {
    repos,
    deferred: ordered.length - repos.length,
    drawsUpTo: Math.max(0, repos.length - allowance),
    reason: repos.length === 0 && ordered.length > 0 ? "top-up-first" : null,
  };
}
