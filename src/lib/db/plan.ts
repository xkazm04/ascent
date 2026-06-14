// The "Plan" layer — the management surface over the fleet: maturity goals (targets the org is
// steering toward, progress derived live from the latest scans), initiatives (tracked, scoped
// programs of work — usually born from a fleet recommendation), and the org what-if simulator
// (project the fleet impact of landing a fix on a chosen repo set, via the pure simulateFleet).
//
// Every function is a no-op / null when DATABASE_URL is unset, like the rest of src/lib/db.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";
import { projectGoal, type GoalPace, type SeriesPoint, type Trajectory } from "@/lib/maturity/forecast";
import { rankFleetInvestments, simulateFleet, type FleetProjection, type InvestmentRank, type RepoDims, type SimFix } from "@/lib/scoring/orgsim";
import type { DimensionId, RepoArchetype } from "@/lib/types";

export type GoalMetric = "overall" | "adoption" | "rigor" | DimensionId;
const VALID_METRICS = new Set(["overall", "adoption", "rigor", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"]);

export function isGoalMetric(v: string): v is GoalMetric {
  return VALID_METRICS.has(v);
}

/** A human label for a goal's metric ("Overall", "Adoption", "Rigor", or a dimension name). */
export function metricLabel(metric: string): string {
  if (metric === "overall") return "Overall maturity";
  if (metric === "adoption") return "AI Adoption";
  if (metric === "rigor") return "Engineering Rigor";
  return DIMENSION_BY_ID[metric as DimensionId]?.name ?? metric;
}

/** A repo in the snapshot: its dims (for the simulator) plus its headline scores (for goal laggards). */
type SnapshotRepo = RepoDims & { overall: number; adoption: number; rigor: number };

/** The fleet's latest-scan snapshot — averages, per-dimension averages, and per-repo dims. */
interface FleetSnapshot {
  avgOverall: number;
  avgAdoption: number;
  avgRigor: number;
  dimAvg: Record<string, number>;
  repos: SnapshotRepo[];
}

async function resolveOrgId(slug: string): Promise<string | null> {
  const org = await getPrisma().organization.findUnique({ where: { slug }, select: { id: true } });
  return org?.id ?? null;
}

/** Build the latest-scan snapshot once; goals/initiatives/simulate all read from it. */
async function fleetSnapshot(orgId: string): Promise<FleetSnapshot> {
  const repos = await getPrisma().repository.findMany({
    where: { orgId },
    select: {
      fullName: true,
      name: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { overallScore: true, adoptionScore: true, rigorScore: true, archetype: true, dimensions: { select: { dimId: true, score: true } } },
      },
    },
  });

  const rows: SnapshotRepo[] = [];
  const dimSum: Record<string, { sum: number; n: number }> = {};
  let oSum = 0;
  let aSum = 0;
  let rSum = 0;
  let n = 0;
  for (const r of repos) {
    const s = r.scans[0];
    if (!s) continue;
    n += 1;
    oSum += s.overallScore;
    aSum += s.adoptionScore;
    rSum += s.rigorScore;
    const dims: Record<string, number> = {};
    for (const d of s.dimensions) {
      dims[d.dimId] = d.score;
      const entry = (dimSum[d.dimId] = dimSum[d.dimId] || { sum: 0, n: 0 });
      entry.sum += d.score;
      entry.n += 1;
    }
    rows.push({
      fullName: r.fullName,
      name: r.name,
      archetype: (s.archetype as RepoArchetype) ?? "org",
      dims,
      overall: s.overallScore,
      adoption: s.adoptionScore,
      rigor: s.rigorScore,
    });
  }

  const avg = (sum: number) => (n ? Math.round(sum / n) : 0);
  const dimAvg: Record<string, number> = {};
  for (const [k, v] of Object.entries(dimSum)) dimAvg[k] = Math.round(v.sum / v.n);
  return { avgOverall: avg(oSum), avgAdoption: avg(aSum), avgRigor: avg(rSum), dimAvg, repos: rows };
}

function currentFor(metric: string, snap: FleetSnapshot): number {
  if (metric === "overall") return snap.avgOverall;
  if (metric === "adoption") return snap.avgAdoption;
  if (metric === "rigor") return snap.avgRigor;
  return snap.dimAvg[metric] ?? 0;
}

/** One repo's score on a goal metric — for finding the repos dragging a target. */
function repoValueFor(metric: string, r: SnapshotRepo): number {
  if (metric === "overall") return r.overall;
  if (metric === "adoption") return r.adoption;
  if (metric === "rigor") return r.rigor;
  return r.dims[metric] ?? 0;
}

/** Collapse timestamped observations to one per-day mean — the shape forecastTrajectory fits. */
function dailyAvg(points: { at: Date; value: number }[]): SeriesPoint[] {
  const byDay: Record<string, { sum: number; n: number }> = {};
  for (const p of points) {
    const day = p.at.toISOString().slice(0, 10);
    (byDay[day] ||= { sum: 0, n: 0 }).sum += p.value;
    byDay[day].n += 1;
  }
  return Object.keys(byDay)
    .sort()
    .map((date) => {
      const entry = byDay[date]!; // safe: date comes from Object.keys(byDay)
      return { date, value: Math.round(entry.sum / entry.n) };
    });
}

/**
 * Per-day average trend series for each metric the org's goals reference, so the goal projector
 * has a slope to fit. Only the metrics actually in use are queried (axes/overall share one scan
 * pass; dimension goals pull the relevant ScanDimension rows) — no work when no goals reference them.
 */
async function metricSeries(orgId: string, metrics: Set<string>): Promise<Record<string, SeriesPoint[]>> {
  const out: Record<string, SeriesPoint[]> = {};
  if (metrics.size === 0) return out;
  const prisma = getPrisma();
  const wantAxis = metrics.has("overall") || metrics.has("adoption") || metrics.has("rigor");
  const wantDims = [...metrics].filter((m) => DIMENSION_BY_ID[m as DimensionId]);

  await Promise.all([
    (async () => {
      if (!wantAxis) return;
      const scans = await prisma.scan.findMany({
        where: { repo: { orgId } },
        select: { scannedAt: true, overallScore: true, adoptionScore: true, rigorScore: true },
        orderBy: { scannedAt: "asc" },
      });
      out.overall = dailyAvg(scans.map((s) => ({ at: s.scannedAt, value: s.overallScore })));
      out.adoption = dailyAvg(scans.map((s) => ({ at: s.scannedAt, value: s.adoptionScore })));
      out.rigor = dailyAvg(scans.map((s) => ({ at: s.scannedAt, value: s.rigorScore })));
    })(),
    (async () => {
      if (wantDims.length === 0) return;
      const dims = await prisma.scanDimension.findMany({
        where: { dimId: { in: wantDims }, scan: { repo: { orgId } } },
        select: { dimId: true, score: true, scan: { select: { scannedAt: true } } },
      });
      const byDim: Record<string, { at: Date; value: number }[]> = {};
      for (const d of dims) (byDim[d.dimId] ||= []).push({ at: d.scan.scannedAt, value: d.score });
      for (const dimId of wantDims) out[dimId] = dailyAvg(byDim[dimId] ?? []);
    })(),
  ]);
  return out;
}

function parseTargetDate(v?: string | null): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

// ── Goals ──────────────────────────────────────────────────────────────────

/** A repo that's below a goal's target on its metric — the "what must move" breakdown. */
export interface GoalLaggard {
  fullName: string;
  name: string;
  /** The repo's current score on the goal's metric. */
  value: number;
  /** How far below the target it is (target − value). */
  gap: number;
}

export interface GoalProgress {
  id: string;
  label: string;
  metric: string;
  metricLabel: string;
  target: number;
  current: number;
  /** 0..100 progress toward the target. */
  pct: number;
  achieved: boolean;
  status: string;
  createdAt: string;
  /** Optional deadline (YYYY-MM-DD) the goal is paced against, or null when open-ended. */
  targetDate: string | null;
  /** Pace verdict from the trend slope vs. the deadline: reached | on-pace | behind | tracking. */
  pace: GoalPace;
  /** Current weekly rate of change of the metric. */
  perWeek: number;
  trajectory: Trajectory;
  /** R² of the trend fit, 0..1. */
  fitQuality: number;
  /** Whole days until the metric reaches the target at the current pace, or null. */
  etaDays: number | null;
  /** Projected target-crossing date (YYYY-MM-DD), or null. */
  etaDate: string | null;
  /** Weekly gain still needed to hit the target by the deadline, or null. */
  requiredPerWeek: number | null;
  /** Repos below the target on this metric (worst first), capped for payload size. */
  laggards: GoalLaggard[];
  /** Total repos below the target (laggards may be truncated). */
  belowCount: number;
}

export async function createGoal(
  orgSlug: string,
  input: { label: string; metric: GoalMetric; target: number; targetDate?: string | null },
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { slug: orgSlug, name: orgSlug === "public" ? "Public Scans" : orgSlug },
  });
  const goal = await prisma.goal.create({
    data: {
      orgId: org.id,
      label: input.label.slice(0, 200),
      metric: input.metric,
      target: Math.max(0, Math.min(100, Math.round(input.target))),
      targetDate: parseTargetDate(input.targetDate),
    },
    select: { id: true },
  });
  return goal;
}

/**
 * All goals for an org with live progress, a trend-derived ETA/pace, and the repos that must move.
 * Progress and laggards come from the fleet's latest scans; the pace ("on pace / behind / reached")
 * comes from fitting the metric's per-day trend and projecting it against the goal's deadline.
 */
export async function listGoals(orgSlug: string): Promise<GoalProgress[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return [];
  const [goals, snap] = await Promise.all([
    prisma.goal.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } }),
    fleetSnapshot(orgId),
  ]);
  const series = await metricSeries(orgId, new Set(goals.map((g) => g.metric)));
  const now = Date.now();
  return goals.map((g) => {
    const current = currentFor(g.metric, snap);
    const targetDate = g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null;
    const proj = projectGoal({ series: series[g.metric] ?? [], current, target: g.target, targetDate, nowMs: now });
    const below = snap.repos
      .map((r) => ({ fullName: r.fullName, name: r.name, value: repoValueFor(g.metric, r) }))
      .filter((r) => r.value < g.target)
      .sort((a, b) => a.value - b.value || a.fullName.localeCompare(b.fullName))
      .map((r) => ({ ...r, gap: g.target - r.value }));
    return {
      id: g.id,
      label: g.label,
      metric: g.metric,
      metricLabel: metricLabel(g.metric),
      target: g.target,
      current,
      pct: g.target > 0 ? Math.max(0, Math.min(100, Math.round((current / g.target) * 100))) : 100,
      achieved: current >= g.target,
      status: g.status,
      createdAt: g.createdAt.toISOString(),
      targetDate,
      pace: proj.pace,
      perWeek: proj.perWeek,
      trajectory: proj.trajectory,
      fitQuality: proj.fitQuality,
      etaDays: proj.etaDays,
      etaDate: proj.etaDate,
      requiredPerWeek: proj.requiredPerWeek,
      laggards: below.slice(0, 12),
      belowCount: below.length,
    };
  });
}

export async function updateGoal(
  id: string,
  data: { status?: string; target?: number; label?: string; targetDate?: string | null },
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  await getPrisma().goal.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(typeof data.target === "number" ? { target: Math.max(0, Math.min(100, Math.round(data.target))) } : {}),
      ...(data.label ? { label: data.label.slice(0, 200) } : {}),
      ...("targetDate" in data ? { targetDate: parseTargetDate(data.targetDate) } : {}),
    },
  });
  return true;
}

export async function deleteGoal(id: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  await getPrisma().goal.delete({ where: { id } });
  return true;
}

/** The owning org's slug for a goal id (for the per-row tenant gate on /api/org/goals/:id). Null = unknown id. */
export async function getGoalOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const g = await getPrisma().goal.findUnique({ where: { id }, select: { org: { select: { slug: true } } } });
  return g?.org.slug ?? null;
}

// ── Initiatives ──────────────────────────────────────────────────────────────

export interface InitiativeRow {
  id: string;
  title: string;
  dimId: string;
  dimLabel: string;
  practiceId: string | null;
  targetScore: number;
  repos: string[];
  status: string;
  /** GitHub login of the owner driving the work, or null when unassigned. */
  assigneeLogin: string | null;
  /** Due date (YYYY-MM-DD) the initiative is steered toward, or null when open-ended. */
  targetDate: string | null;
  /** Id of the steering Goal this initiative serves, or null when standalone. */
  goalId: string | null;
  /** Label of the linked Goal (resolved at read time), or null when unlinked / goal removed. */
  goalLabel: string | null;
  createdAt: string;
  /** Of the scoped repos, how many currently meet the target on this dimension. */
  progress: { atTarget: number; total: number };
}

function parseRepos(raw: string): string[] {
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function createInitiative(
  orgSlug: string,
  input: {
    title: string;
    dimId: DimensionId;
    practiceId?: string | null;
    targetScore?: number;
    repos: string[];
    assigneeLogin?: string | null;
    targetDate?: string | null;
    goalId?: string | null;
  },
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { slug: orgSlug, name: orgSlug === "public" ? "Public Scans" : orgSlug },
  });
  const created = await prisma.initiative.create({
    data: {
      orgId: org.id,
      title: input.title.slice(0, 200),
      dimId: input.dimId,
      practiceId: input.practiceId ?? null,
      targetScore: Math.max(0, Math.min(100, Math.round(input.targetScore ?? 70))),
      repos: JSON.stringify(input.repos.slice(0, 200)),
      assigneeLogin: input.assigneeLogin?.trim().slice(0, 100) || null,
      targetDate: parseTargetDate(input.targetDate),
      goalId: input.goalId ?? null,
    },
    select: { id: true },
  });
  return created;
}

export async function listInitiatives(orgSlug: string): Promise<InitiativeRow[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return [];
  const [rows, snap, goals] = await Promise.all([
    prisma.initiative.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } }),
    fleetSnapshot(orgId),
    prisma.goal.findMany({ where: { orgId }, select: { id: true, label: true } }),
  ]);
  const dimByRepo = new Map(snap.repos.map((r) => [r.fullName, r.dims]));
  const goalLabelById = new Map(goals.map((g) => [g.id, g.label]));
  return rows.map((i) => {
    const repos = parseRepos(i.repos);
    const atTarget = repos.filter((fn) => (dimByRepo.get(fn)?.[i.dimId] ?? 0) >= i.targetScore).length;
    return {
      id: i.id,
      title: i.title,
      dimId: i.dimId,
      dimLabel: DIMENSION_BY_ID[i.dimId as DimensionId]?.name ?? i.dimId,
      practiceId: i.practiceId,
      targetScore: i.targetScore,
      repos,
      status: i.status,
      assigneeLogin: i.assigneeLogin,
      targetDate: i.targetDate ? i.targetDate.toISOString().slice(0, 10) : null,
      goalId: i.goalId,
      // A linked goal that was since deleted resolves to null — the UI shows it as unlinked.
      goalLabel: i.goalId ? goalLabelById.get(i.goalId) ?? null : null,
      createdAt: i.createdAt.toISOString(),
      progress: { atTarget, total: repos.length },
    };
  });
}

/** Patch an initiative's status, owner, due date, or linked goal — only the provided fields move. */
export async function updateInitiative(
  id: string,
  patch: { status?: string; assigneeLogin?: string | null; targetDate?: string | null; goalId?: string | null },
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  await getPrisma().initiative.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...("assigneeLogin" in patch ? { assigneeLogin: patch.assigneeLogin?.trim().slice(0, 100) || null } : {}),
      ...("targetDate" in patch ? { targetDate: parseTargetDate(patch.targetDate) } : {}),
      ...("goalId" in patch ? { goalId: patch.goalId || null } : {}),
    },
  });
  return true;
}

/** The owning org's slug for an initiative id (per-row tenant gate on /api/org/initiatives/:id). Null = unknown id. */
export async function getInitiativeOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const i = await getPrisma().initiative.findUnique({ where: { id }, select: { org: { select: { slug: true } } } });
  return i?.org.slug ?? null;
}

// ── What-if simulator ──────────────────────────────────────────────────────

/**
 * Project the fleet impact of raising `dimId` to `target` across `repoFullNames` (empty = all
 * scanned repos). Returns null when persistence is off or the org has no scanned repos; otherwise
 * the pure FleetProjection (before/after fleet averages, per-repo deltas, promotions).
 */
export async function simulateOrgFix(
  orgSlug: string,
  dimId: DimensionId,
  target: number,
  repoFullNames: string[],
): Promise<FleetProjection | null> {
  return simulateOrgFixes(orgSlug, [{ dimId, target }], repoFullNames);
}

/**
 * Multi-dimension variant (SIM-2): project several `{dimId, target}` legs landing together across
 * the scope, so a leader can model a combined push ("raise Tests to 70 AND CI to 60 on these repos")
 * rather than one dimension at a time. Reuses the same pure simulateFleet projection.
 */
export async function simulateOrgFixes(
  orgSlug: string,
  fixes: SimFix[],
  repoFullNames: string[],
): Promise<FleetProjection | null> {
  if (!isDbConfigured()) return null;
  if (fixes.length === 0) return null;
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const snap = await fleetSnapshot(orgId);
  if (snap.repos.length === 0) return null;
  const scope = repoFullNames.length ? repoFullNames : snap.repos.map((r) => r.fullName);
  return simulateFleet(snap.repos, fixes, scope);
}

/** How a simulated scenario would move one active goal's ETA — the forecast coupled to the sim (SIM-4). */
export interface GoalImpact {
  id: string;
  label: string;
  metric: string;
  metricLabel: string;
  target: number;
  /** Today's fleet value on the metric, and the value after the simulated fix lands. */
  currentValue: number;
  simulatedValue: number;
  /** Projected target-crossing date at today's value vs. re-anchored at the simulated value. */
  currentEtaDate: string | null;
  simulatedEtaDate: string | null;
  /** The simulated value already meets the target (the goal is reached on landing). */
  reachedNow: boolean;
  /** Days the target is pulled forward by landing the fix (currentEta − simulatedEta), or null. */
  daysSooner: number | null;
}

/**
 * SIM-4 — couple the simulator to the goal forecast. For each active goal on an axis/overall metric,
 * re-anchor its trend at the *simulated* fleet value (keeping the fitted slope) and compare the ETA
 * to the one at today's value: "landing this fix reaches 'Reach L4' ~3 months sooner". Dimension-metric
 * goals are skipped (the projection's after-snapshot only carries the axis/overall averages). `before`
 * and `after` come straight from the FleetProjection, so no extra fleet query is needed.
 */
export async function goalImpactsForScenario(
  orgSlug: string,
  before: { avgOverall: number; avgAdoption: number; avgRigor: number },
  after: { avgOverall: number; avgAdoption: number; avgRigor: number },
): Promise<GoalImpact[] | null> {
  if (!isDbConfigured()) return null;
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const AXIS = new Set(["overall", "adoption", "rigor"]);
  const goals = (await getPrisma().goal.findMany({ where: { orgId, status: "active" } })).filter((g) => AXIS.has(g.metric));
  if (goals.length === 0) return [];
  const series = await metricSeries(orgId, new Set(goals.map((g) => g.metric)));
  const now = Date.now();
  const valueOf = (snap: { avgOverall: number; avgAdoption: number; avgRigor: number }, metric: string) =>
    metric === "adoption" ? snap.avgAdoption : metric === "rigor" ? snap.avgRigor : snap.avgOverall;

  const impacts: GoalImpact[] = [];
  for (const g of goals) {
    const cur = valueOf(before, g.metric);
    const sim = valueOf(after, g.metric);
    if (sim <= cur) continue; // the scenario doesn't move this metric — nothing to show
    const targetDate = g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null;
    const s = series[g.metric] ?? [];
    const curProj = projectGoal({ series: s, current: cur, target: g.target, targetDate, nowMs: now });
    const simProj = projectGoal({ series: s, current: sim, target: g.target, targetDate, nowMs: now });
    impacts.push({
      id: g.id,
      label: g.label,
      metric: g.metric,
      metricLabel: metricLabel(g.metric),
      target: g.target,
      currentValue: cur,
      simulatedValue: sim,
      currentEtaDate: curProj.etaDate,
      simulatedEtaDate: simProj.etaDate,
      reachedNow: sim >= g.target,
      daysSooner: curProj.etaDays != null && simProj.etaDays != null ? curProj.etaDays - simProj.etaDays : null,
    });
  }
  return impacts;
}

/**
 * Rank D1..D9 by the projected fleet lift from raising each to `target` across the scope (SIM-3) —
 * the "where should we invest?" recommendation, reusing the same pure projection as the manual sim.
 */
export async function rankOrgInvestments(
  orgSlug: string,
  target: number,
  repoFullNames: string[],
): Promise<InvestmentRank[] | null> {
  if (!isDbConfigured()) return null;
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const snap = await fleetSnapshot(orgId);
  if (snap.repos.length === 0) return null;
  const scope = repoFullNames.length ? repoFullNames : snap.repos.map((r) => r.fullName);
  return rankFleetInvestments(snap.repos, scope, target);
}
