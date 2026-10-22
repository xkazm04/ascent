// The fleet scan's end as a ROSTER (pure; no React, no db). The "Scan all watched" stream hands the
// client every repo's name, outcome and charged flag; the queue poll (GET /api/org/scan/queue) later
// reports what the background worker settled after the stream closed. Both fold into one roster
// KEYED BY REPO, so a repo lives in exactly one bucket and every count is re-derived from the lists
// rather than incremented (registry: batch-undo-commit-window, partial-failure-reselect). The
// failures are re-selected by `retryScope`, so one action retries exactly them through the ordinary
// scoped POST /api/org/scan (which keeps its own watchlist intersection and per-repo credit rules).
//
// Named *Model.ts so it cannot collide with ScanRunRoster.tsx on a case-insensitive file system.

import { orgTabHref } from "@/lib/org/orgTabs";

/** Mirrors DEGRADED_SCAN_ERROR in src/lib/scan-consequences.ts (server-only, so not importable
 *  here; a test pins the two together). A scan the provider degraded to the deterministic floor is
 *  NOT persisted and NOT charged: a retryable engine failure, never a finished scan. */
export const DEGRADED_SCAN_ERROR_TEXT = "LLM unavailable: not persisted";

export type SkipReason = "insufficient_credits" | "no_token" | "in_progress" | "other";
const SKIP_REASONS: readonly SkipReason[] = ["insufficient_credits", "no_token", "in_progress", "other"];

export interface FailedEntry {
  repo: string;
  reason: string;
  /** The org paid for a scan it did not get to keep: a retry is a NEW scan. */
  chargedOnce: boolean;
  /** The scan engine degraded to the floor: nothing was saved or charged. */
  degraded: boolean;
}

export interface ScanRunRoster {
  scored: string[];
  failed: FailedEntry[];
  skipped: Record<SkipReason, string[]>;
  /** Repos still owed by this run (a retry's scope, or the poll's queued/claimed rows). */
  pending: string[];
  /** Up-front credit skips arrive as a COUNT on `notice` (no names); `result` carries the
   *  authoritative totals. Names are shown where known, the remainder as a count. */
  creditsUpfront: number;
  totals: { insufficient_credits?: number; no_token?: number };
}

export function emptyRoster(pending: string[] = []): ScanRunRoster {
  return { scored: [], failed: [], skipped: { insufficient_credits: [], no_token: [], in_progress: [], other: [] }, pending: [...pending], creditsUpfront: 0, totals: {} };
}

type Placement = { kind: "scored" } | { kind: "pending" } | { kind: "failed"; entry: FailedEntry } | { kind: "skipped"; reason: SkipReason };

/** Put `repo` in exactly one bucket: an entry already in the target keeps its position. */
function place(r: ScanRunRoster, repo: string, to: Placement): ScanRunRoster {
  const drop = (list: string[]) => list.filter((x) => x !== repo);
  const keepOrAppend = (list: string[]) => (list.includes(repo) ? list : [...list, repo]);
  const skipped = Object.fromEntries(
    SKIP_REASONS.map((k) => [k, to.kind === "skipped" && to.reason === k ? keepOrAppend(r.skipped[k]) : drop(r.skipped[k])]),
  ) as Record<SkipReason, string[]>;
  let failed = r.failed.filter((f) => f.repo !== repo);
  if (to.kind === "failed") {
    const at = r.failed.findIndex((f) => f.repo === repo);
    failed = at >= 0 ? r.failed.map((f) => (f.repo === repo ? to.entry : f)) : [...r.failed, to.entry];
  }
  return {
    ...r,
    scored: to.kind === "scored" ? keepOrAppend(r.scored) : drop(r.scored),
    pending: to.kind === "pending" ? keepOrAppend(r.pending) : drop(r.pending),
    failed,
    skipped,
  };
}

function failedEntry(r: ScanRunRoster, repo: string, reason: string, charged: boolean): FailedEntry {
  const prior = r.failed.find((f) => f.repo === repo);
  return { repo, reason, chargedOnce: charged || prior?.chargedOnce === true, degraded: reason === DEGRADED_SCAN_ERROR_TEXT };
}

function asSkipReason(value: unknown): SkipReason {
  return value === "insufficient_credits" || value === "no_token" || value === "in_progress" ? value : "other";
}

const finite = (v: unknown): number | undefined => (typeof v === "number" || typeof v === "string") && Number.isFinite(Number(v)) && String(v) !== "" ? Number(v) : undefined;

/** Fold one frame of the bulk-scan stream (`repo`, `notice`, `result`; others are ignored). */
export function foldStreamFrame(r: ScanRunRoster, event: string, data: Record<string, unknown>): ScanRunRoster {
  if (event === "repo") {
    const repo = typeof data.repo === "string" ? data.repo : "";
    if (!repo) return r;
    if (data.error) return place(r, repo, { kind: "failed", entry: failedEntry(r, repo, String(data.error), data.charged === true) });
    if (data.skipped) return place(r, repo, { kind: "skipped", reason: asSkipReason(data.skipped) });
    return place(r, repo, { kind: "scored" });
  }
  if (event === "notice") {
    const n = finite(data.skipped);
    return n && n > 0 ? { ...r, creditsUpfront: r.creditsUpfront + n } : r;
  }
  if (event === "result") {
    const credits = finite(data.skippedForCredits);
    const noToken = finite(data.skippedNoToken);
    return { ...r, totals: { insufficient_credits: credits ?? r.totals.insufficient_credits, no_token: noToken ?? r.totals.no_token } };
  }
  return r;
}

/** The worker's skip errors (scan-queue-worker.ts / org/import settleJob) onto the fix they need. */
function snapshotSkip(error: string | null): SkipReason {
  if (error === "insufficient credits") return "insufficient_credits";
  if (error === "installation token unavailable") return "no_token";
  return "other";
}

/** Fold one GET /api/org/scan/queue answer. Tolerates a snapshot without a `repos` list. */
export function foldQueueSnapshot(r: ScanRunRoster, snapshot: unknown): ScanRunRoster {
  const rows = (snapshot as { repos?: unknown } | null)?.repos;
  if (!Array.isArray(rows)) return r;
  let out = r;
  for (const raw of rows) {
    const row = raw as { repo?: unknown; state?: unknown; error?: unknown; charged?: unknown };
    if (typeof row.repo !== "string" || typeof row.state !== "string") continue;
    const error = typeof row.error === "string" && row.error ? row.error : null;
    if (row.state === "failed" || (row.state === "skipped" && error === DEGRADED_SCAN_ERROR_TEXT)) {
      out = place(out, row.repo, { kind: "failed", entry: failedEntry(out, row.repo, error ?? "Scan failed.", row.charged === true) });
    } else if (row.state === "skipped") out = place(out, row.repo, { kind: "skipped", reason: snapshotSkip(error) });
    else if (row.state === "done") out = place(out, row.repo, { kind: "scored" });
    else out = place(out, row.repo, { kind: "pending" });
  }
  return out;
}

export const failedCount = (r: ScanRunRoster): number => r.failed.length;

/** How many repos a skip reason covers: the authoritative total once `result` lands, else names + up-front. */
export function skippedCount(r: ScanRunRoster, reason: SkipReason): number {
  const named = r.skipped[reason].length;
  if (reason === "insufficient_credits") return Math.max(named, r.totals.insufficient_credits ?? named + r.creditsUpfront);
  if (reason === "no_token") return Math.max(named, r.totals.no_token ?? named);
  return named;
}

/** The re-selection: the failures only (degraded included), never skipped or scored repos. */
export function retryScope(r: ScanRunRoster): { repos: string[] } {
  return { repos: r.failed.map((f) => f.repo) };
}

export function retryLabel(r: ScanRunRoster): string {
  const charged = r.failed.filter((f) => f.chargedOnce).length;
  const base = `Retry ${r.failed.length} failed`;
  return charged > 0 ? `${base} (${charged} already charged once; a retry is a new scan)` : base;
}

export type RosterAction = { kind: "retry"; label: string } | { kind: "credits"; href: string } | { kind: "reconnect"; href: string };
export interface RosterGroup {
  key: "failed" | SkipReason;
  title: string;
  /** Named rows; `count` may exceed it when some repos arrived only as a number. */
  entries: { repo: string; note?: string }[];
  count: number;
  action?: RosterAction;
}

const plural = (n: number) => (n === 1 ? "repo" : "repos");

/** Non-empty groups, each with the ONE action its fix needs (in_progress / other: wait, no action). */
export function rosterGroups(r: ScanRunRoster, org: string): RosterGroup[] {
  const groups: RosterGroup[] = [];
  if (r.failed.length) {
    groups.push({
      key: "failed",
      title: `${r.failed.length} ${plural(r.failed.length)} failed to scan`,
      entries: r.failed.map((f) => ({ repo: f.repo, note: f.degraded ? "The scan engine was unavailable; nothing was saved or charged." : f.reason })),
      count: r.failed.length,
      action: { kind: "retry", label: retryLabel(r) },
    });
  }
  const skip = (key: SkipReason, title: (n: number) => string, action?: RosterAction) => {
    const n = skippedCount(r, key);
    if (n > 0) groups.push({ key, title: title(n), entries: r.skipped[key].map((repo) => ({ repo })), count: n, action });
  };
  skip("insufficient_credits", (n) => `${n} ${plural(n)} skipped: out of scan credits`, { kind: "credits", href: "/pricing" });
  skip("no_token", (n) => `${n} ${plural(n)} skipped: GitHub App access unavailable`, { kind: "reconnect", href: orgTabHref(org, "integrations") });
  skip("in_progress", (n) => `${n} ${plural(n)} skipped: already being scanned`);
  skip("other", (n) => `${n} ${plural(n)} not scanned this run`);
  return groups;
}
