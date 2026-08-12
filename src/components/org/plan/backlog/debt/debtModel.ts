// The join behind the Debt Ledger: REAL overdue recommendation debt (from OrgBacklog — the same rows
// the backlog panel below it manages) × REAL delivery-quality metrics from each repo's latest scan
// (OrgRework, org-rework.ts — revert linkage + rework rates, W5; trailer exposure, W2).
//
// One repo-keyed row is the unit of the surface. NULL DISCIPLINE: a repo whose latest scan predates
// rework tracking (pre-W5 blob) or whose PR sample is under the ≥5 floor renders "—", never a zero —
// the pressure composite renormalizes over the terms that ARE measured.
//
// DEFERRED (tier B): "AI churn share" (share of rework landing on AI-authored lines) has NO real
// signal yet — it needs per-commit file paths (`files(first:50)` ingest). The prototype's mock column
// was REMOVED rather than faked; it returns when the churn ingest lands (pairs with stance path-zone
// enforcement, which needs the same data).
//
// Server-safe (no hooks, no DOM).

import type { BacklogItem, OrgBacklog, OrgRework, RepoReworkRow } from "@/lib/db";
import { dimShort } from "@/lib/ui";

/** Impact → projected-points fallback when the scan predates persisted dimensions (projectedPoints null). */
const IMPACT_POINTS: Record<string, number> = { high: 6, medium: 3, low: 1.5 };

/** One repo's delivery-quality slice of the ledger. All rates 0..100 whole percents; null = "no sample". */
export interface RepoDebtQuality {
  /** % of merged PRs later reverted in the window (W5 revert linkage — a lower bound). */
  reworkRate: number | null;
  /** The same, over AI-involved merged PRs only. */
  aiReworkRate: number | null;
  /** % of analyzed PRs titled `Revert…` (W1a) — the write-off rate. */
  revertRate: number | null;
  /** AI exposure: the trailer-grounded aiTrailerRate when measured, else the broader aiInvolvedRate. */
  exposure: number | null;
  /** True when `exposure` is the trailer-grounded rate (W2), false for the marker-based fallback. */
  exposureGrounded: boolean;
  /** False = the latest scan PREDATES rework tracking (pre-W5 blob) — "re-scan to measure". */
  measured: boolean;
  /** False = the repo has no scanned PR data at all (or was never scanned). */
  hasScan: boolean;
}

const NO_SCAN: RepoDebtQuality = {
  reworkRate: null,
  aiReworkRate: null,
  revertRate: null,
  exposure: null,
  exposureGrounded: false,
  measured: false,
  hasScan: false,
};

function qualityOf(r: RepoReworkRow | undefined): RepoDebtQuality {
  if (!r) return NO_SCAN;
  return {
    reworkRate: r.reworkRate,
    aiReworkRate: r.aiReworkRate,
    revertRate: r.revertRate,
    exposure: r.aiTrailerRate ?? r.aiInvolvedRate,
    exposureGrounded: r.aiTrailerRate != null,
    measured: r.measured,
    hasScan: true,
  };
}

export interface RepoDebt {
  repo: string; // owner/name
  repoName: string;
  /** Active (open + in_progress) recommendations on this repo. */
  active: number;
  /** Active recommendations already past their due date — the principal's overdue slice. */
  overdue: number;
  /** Sum of projected score points locked up in OVERDUE recommendations. The "principal". */
  principal: number;
  /** Sum of projected points across ALL active recommendations (overdue or not). */
  activePoints: number;
  /** Mean days past due across the overdue items (0 when none). The "age" of the debt. */
  avgDaysOverdue: number;
  /** Worst single item by days overdue — the row's headline evidence. */
  oldest: BacklogItem | null;
  /** Dimension short labels (D1…D9) carrying the overdue debt, most-represented first, max 3. */
  dims: string[];
  /** Unassigned active items — debt nobody has picked up. */
  unowned: number;
  /** REAL delivery-quality metrics from the repo's latest scan (nullable — see RepoDebtQuality). */
  q: RepoDebtQuality;
  /**
   * 0–100 composite, HIGHER = MORE DEBT PRESSURE. Deliberately not a maturity score — render it
   * through `scoreHex(100 - pressure)` so the brand's red→green ramp keeps meaning "green is good".
   * Blend over the MEASURED terms only (weights renormalize when a rate is null): overdue principal
   * 45% · rework rate 35% (full weight at ≥35%) · write-off rate 20% (full weight at ≥9%). The
   * prototype's AI-churn term is deferred with its signal (see module header).
   */
  pressure: number;
}

export interface DebtFleet {
  rows: RepoDebt[]; // sorted by pressure, worst first
  /** Fleet totals — the masthead numbers. Backlog half is org-real; rates are fleet scan aggregates. */
  repos: number;
  overdue: number;
  dueSoon: number;
  principal: number;
  unowned: number;
  /** Analyzed-weighted fleet rates from OrgRework (whole scanned fleet, not just backlog repos). */
  reworkRate: number | null;
  aiReworkRate: number | null;
  revertRate: number | null;
  exposure: number | null;
  exposureGrounded: boolean;
  /** Median rework across the MEASURED ledger rows — the "vs fleet" line verdicts compare against. */
  medianRework: number | null;
  /** Measurement coverage: how many ledger rows have a rework-tracking scan behind them. */
  measuredRows: number;
  /** The repo carrying the most pressure, or null on an empty fleet. */
  worst: RepoDebt | null;
}

const pointsOf = (i: BacklogItem): number => i.projectedPoints ?? IMPACT_POINTS[i.impact] ?? 2;
const isActive = (i: BacklogItem) => i.status === "open" || i.status === "in_progress";

/** Every ACTIVE item in the backlog, flattened out of the owner groups (byOwner is the full set). */
export function activeItems(b: OrgBacklog): BacklogItem[] {
  return b.byOwner.flatMap((g) => g.items).filter(isActive);
}

function topDims(items: BacklogItem[]): string[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.dimId, (counts.get(i.dimId) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => dimShort(id));
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Pressure composite over the measured terms only — a null rate drops out and its weight
 *  renormalizes, so "not measured" never reads as "0 pressure" OR as fabricated risk. */
function pressureOf(principalNorm: number, q: RepoDebtQuality): number {
  const terms: { v: number; w: number }[] = [{ v: clamp01(principalNorm), w: 0.45 }];
  if (q.reworkRate != null) terms.push({ v: clamp01(q.reworkRate / 35), w: 0.35 });
  if (q.revertRate != null) terms.push({ v: clamp01(q.revertRate / 9), w: 0.2 });
  const wsum = terms.reduce((s, t) => s + t.w, 0);
  return Math.round((100 * terms.reduce((s, t) => s + t.v * t.w, 0)) / wsum);
}

/** Join one repo's real backlog slice with its real scan quality. `maxPrincipal` normalizes pressure. */
function buildRow(repo: string, items: BacklogItem[], q: RepoDebtQuality, maxPrincipal: number): RepoDebt {
  const overdueItems = items.filter((i) => i.overdue);
  const principal = overdueItems.reduce((s, i) => s + pointsOf(i), 0);
  const daysOver = overdueItems.map((i) => (i.dueInDays == null ? 0 : -i.dueInDays));
  const oldest = overdueItems.reduce<BacklogItem | null>(
    (worst, i) => (worst == null || (i.dueInDays ?? 0) < (worst.dueInDays ?? 0) ? i : worst),
    null,
  );

  return {
    repo,
    repoName: items[0]?.repoName ?? repo.split("/").pop() ?? repo,
    active: items.length,
    overdue: overdueItems.length,
    principal: Math.round(principal * 10) / 10,
    activePoints: Math.round(items.reduce((s, i) => s + pointsOf(i), 0) * 10) / 10,
    avgDaysOverdue: daysOver.length ? Math.round(daysOver.reduce((a, b) => a + b, 0) / daysOver.length) : 0,
    oldest,
    dims: topDims(overdueItems.length ? overdueItems : items),
    unowned: items.filter((i) => i.assigneeLogin == null).length,
    q,
    pressure: pressureOf(maxPrincipal > 0 ? principal / maxPrincipal : 0, q),
  };
}

/**
 * Build the ledger's data from the backlog the tab already loads + the fleet rework read. Pure —
 * call it in a server component (BacklogTab) or a `useMemo`. `rework` may be null (DB off, no PR
 * data) — every quality cell then renders as unmeasured, never as zero.
 */
export function buildDebtFleet(b: OrgBacklog, rework: OrgRework | null): DebtFleet {
  const items = activeItems(b);
  const byRepo = new Map<string, BacklogItem[]>();
  for (const i of items) {
    const list = byRepo.get(i.repo);
    if (list) list.push(i);
    else byRepo.set(i.repo, [i]);
  }

  const reworkByRepo = new Map<string, RepoReworkRow>((rework?.perRepo ?? []).map((r) => [r.fullName, r]));
  const maxPrincipal = Math.max(
    0,
    ...[...byRepo.values()].map((list) => list.filter((i) => i.overdue).reduce((s, i) => s + pointsOf(i), 0)),
  );

  const rows = [...byRepo.entries()]
    .map(([repo, list]) => buildRow(repo, list, qualityOf(reworkByRepo.get(repo)), maxPrincipal))
    .sort((a, z) => z.pressure - a.pressure || z.principal - a.principal);

  const measured = rows.map((r) => r.q.reworkRate).filter((v): v is number => v != null);

  return {
    rows,
    repos: rows.length,
    overdue: rows.reduce((s, r) => s + r.overdue, 0),
    dueSoon: b.dueSoon,
    principal: Math.round(rows.reduce((s, r) => s + r.principal, 0) * 10) / 10,
    unowned: rows.reduce((s, r) => s + r.unowned, 0),
    reworkRate: rework?.avgReworkRate ?? null,
    aiReworkRate: rework?.avgAiReworkRate ?? null,
    revertRate: rework?.avgRevertRate ?? null,
    exposure: rework ? (rework.avgAiTrailerRate ?? rework.avgAiInvolvedRate) : null,
    exposureGrounded: rework?.avgAiTrailerRate != null,
    medianRework: fleetMedian(measured),
    measuredRows: rows.filter((r) => r.q.measured).length,
    worst: rows[0] ?? null,
  };
}

/** Median of an already-filtered measured sample; null on an empty one. */
export function fleetMedian(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** "24%" for a 0–100 rate, "—" for "no sample". */
export const fmtRate = (n: number | null): string => (n == null ? "—" : `${Math.round(n)}%`);
