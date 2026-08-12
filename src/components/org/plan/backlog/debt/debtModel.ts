// The join behind every "AI-era debt" variant: REAL overdue recommendation debt (from OrgBacklog)
// × MOCK delivery-quality metrics (debtMockData.ts — see its header for what is fabricated and why).
//
// One repo-keyed row is the unit of the whole surface. Every variant renders the SAME `RepoDebt[]`
// through a different metaphor, so a direction can be judged on presentation rather than on which
// numbers it happened to pick.
//
// Server-safe (no hooks, no DOM) so any variant may be a server component if it drops its hooks.

import type { BacklogItem, OrgBacklog } from "@/lib/db";
import { dimShort } from "@/lib/ui";
import { fleetMedian, mockFleetQuality, type RepoAiQuality } from "./debtMockData";

/** Impact → projected-points fallback when the scan predates persisted dimensions (projectedPoints null). */
const IMPACT_POINTS: Record<string, number> = { high: 6, medium: 3, low: 1.5 };

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
  /** MOCK delivery-quality metrics for this repo. */
  q: RepoAiQuality;
  /**
   * 0–100 composite, HIGHER = MORE DEBT PRESSURE. Deliberately not a maturity score — render it
   * through `scoreHex(100 - pressure)` / `heatCell(100 - pressure, …)` so the brand's red→green
   * ramp still means "green is good" and the ramp is not re-purposed with an inverted meaning.
   * Blend: overdue principal 35% · rework rate 30% · reversion rate 20% · AI churn share 15%.
   */
  pressure: number;
}

export interface DebtFleet {
  rows: RepoDebt[]; // sorted by pressure, worst first
  /** Fleet totals — the masthead numbers. */
  repos: number;
  overdue: number;
  principal: number;
  unowned: number;
  /** Weighted-by-churn fleet rework rate, and the same one period earlier (for the trend arrow). */
  reworkRate: number;
  reworkRatePrev: number;
  reversionRate: number;
  reversionRatePrev: number;
  aiAuthoredShare: number;
  medianRework: number;
  medianAiShare: number;
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

/** Join one repo's real backlog slice with its mock quality metrics. `maxPrincipal` normalizes pressure. */
function buildRow(repo: string, items: BacklogItem[], q: RepoAiQuality, maxPrincipal: number): RepoDebt {
  const overdueItems = items.filter((i) => i.overdue);
  const principal = overdueItems.reduce((s, i) => s + pointsOf(i), 0);
  const daysOver = overdueItems.map((i) => (i.dueInDays == null ? 0 : -i.dueInDays));
  const oldest = overdueItems.reduce<BacklogItem | null>(
    (worst, i) => (worst == null || (i.dueInDays ?? 0) < (worst.dueInDays ?? 0) ? i : worst),
    null,
  );

  const principalNorm = maxPrincipal > 0 ? principal / maxPrincipal : 0;
  const pressure = Math.round(
    100 *
      Math.max(
        0,
        Math.min(
          1,
          principalNorm * 0.35 +
            Math.min(1, q.reworkRate / 0.35) * 0.3 +
            Math.min(1, q.reversionRate / 0.09) * 0.2 +
            q.aiChurnShare * 0.15,
        ),
      ),
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
    pressure,
  };
}

/**
 * Build the whole surface's data from the backlog the tab already loads. Pure — call it in a
 * `useMemo` (client) or straight in a server component.
 */
export function buildDebtFleet(b: OrgBacklog): DebtFleet {
  const items = activeItems(b);
  const byRepo = new Map<string, BacklogItem[]>();
  for (const i of items) {
    const list = byRepo.get(i.repo);
    if (list) list.push(i);
    else byRepo.set(i.repo, [i]);
  }

  const quality = mockFleetQuality([...byRepo.keys()]);
  const maxPrincipal = Math.max(
    0,
    ...[...byRepo.values()].map((list) => list.filter((i) => i.overdue).reduce((s, i) => s + pointsOf(i), 0)),
  );

  const rows = [...byRepo.entries()]
    .map(([repo, list]) => buildRow(repo, list, quality.get(repo)!, maxPrincipal))
    .sort((a, z) => z.pressure - a.pressure || z.principal - a.principal);

  const all = rows.map((r) => r.q);
  const churn = all.reduce((s, q) => s + q.churnPerWeek, 0) || 1;
  const weighted = (pick: (q: RepoAiQuality) => number) =>
    all.reduce((s, q) => s + pick(q) * q.churnPerWeek, 0) / churn;

  return {
    rows,
    repos: rows.length,
    overdue: rows.reduce((s, r) => s + r.overdue, 0),
    principal: Math.round(rows.reduce((s, r) => s + r.principal, 0) * 10) / 10,
    unowned: rows.reduce((s, r) => s + r.unowned, 0),
    reworkRate: weighted((q) => q.reworkRate),
    reworkRatePrev: weighted((q) => q.reworkRatePrev),
    reversionRate: weighted((q) => q.reversionRate),
    reversionRatePrev: weighted((q) => q.reversionRatePrev),
    aiAuthoredShare: weighted((q) => q.aiAuthoredShare),
    medianRework: fleetMedian(all, (q) => q.reworkRate),
    medianAiShare: fleetMedian(all, (q) => q.aiAuthoredShare),
    worst: rows[0] ?? null,
  };
}

/** "24%" — a 0–1 rate as whole percent. */
export const pct = (n: number): string => `${Math.round(n * 100)}%`;
/** "24.3%" — one decimal, for the small reversion rates where whole percent flattens the signal. */
export const pct1 = (n: number): string => `${(n * 100).toFixed(1)}%`;
/** Percentage-POINT delta between two rates, rounded — the input to fmtDelta/deltaHex. */
export const ppDelta = (now: number, prev: number): number => Math.round((now - prev) * 1000) / 10;
/** "5.2k" — compact churn volume. */
export const fmtChurn = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
