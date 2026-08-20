// The "Plan" layer — the management surface over the fleet: maturity goals (targets the org is
// steering toward, progress derived live from the latest scans), initiatives (tracked, scoped
// programs of work — usually born from a fleet recommendation), and the org what-if simulator
// (project the fleet impact of landing a fix on a chosen repo set, via the pure simulateFleet).
//
// Every function is a no-op / null when DATABASE_URL is unset, like the rest of src/lib/db.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { retentionCutoff } from "@/lib/plans";
import { DEFAULT_INITIATIVE_TARGET, DIMENSION_BY_ID } from "@/lib/maturity/model";
import { meanPerDayKey, projectGoal, type GoalPace, type SeriesPoint, type Trajectory } from "@/lib/maturity/forecast";
import type { DimensionId, RepoArchetype } from "@/lib/types";

export type GoalMetric = "overall" | "adoption" | "rigor" | DimensionId;
const VALID_METRICS = new Set(["overall", "adoption", "rigor", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"]);

export function isGoalMetric(v: string): v is GoalMetric {
  return VALID_METRICS.has(v);
}

/**
 * Resolve-or-create the org row for a create path that must succeed even for a brand-new org slug
 * (unlike {@link getOrgId}, which only reads and returns null for an unknown slug). Shared by
 * createGoal and createInitiative, which previously repeated this identical upsert.
 */
async function ensureOrg(orgSlug: string): Promise<{ id: string }> {
  return getPrisma().organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { slug: orgSlug, name: orgSlug === "public" ? "Public Scans" : orgSlug },
  });
}

/** A human label for a goal's metric ("Overall", "Adoption", "Rigor", or a dimension name). */
export function metricLabel(metric: string): string {
  if (metric === "overall") return "Overall maturity";
  if (metric === "adoption") return "AI Adoption";
  if (metric === "rigor") return "Engineering Rigor";
  return DIMENSION_BY_ID[metric as DimensionId]?.name ?? metric;
}

/** A repo in the snapshot: its dims plus its headline scores (for goal laggards). The `dims` half
 *  used to be the retired simulator's `RepoDims` (src/lib/scoring/orgsim.ts); the shape is kept
 *  inline so the goal projector's laggard read is unchanged. */
type SnapshotRepo = {
  fullName: string;
  name: string;
  archetype: RepoArchetype;
  dims: Record<string, number>;
  overall: number;
  adoption: number;
  rigor: number;
};

/** The fleet's latest-scan snapshot — averages, per-dimension averages, and per-repo dims. */
interface FleetSnapshot {
  avgOverall: number;
  avgAdoption: number;
  avgRigor: number;
  dimAvg: Record<string, number>;
  repos: SnapshotRepo[];
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

/** Collapse timestamped observations to one per-day mean — the shape forecastTrajectory fits. Shares
 *  the per-day-mean accumulation with forecastTrajectory via meanPerDayKey (keyed by ISO `YYYY-MM-DD`),
 *  then rounds each day's mean to an int. */
function dailyAvg(points: { at: Date; value: number }[]): SeriesPoint[] {
  const byDay = meanPerDayKey(points, (p) => p.at.toISOString().slice(0, 10));
  return [...byDay.keys()]
    .sort()
    .map((date) => ({ date, value: Math.round(byDay.get(date)!) })); // safe: date ∈ byDay.keys()
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

/**
 * What a goal's `pct` measures. Two goals on the same board can differ: a goal created since
 * `Goal.baselineValue` exists reports real progress; one created before it can only report standing.
 * The distinction is data, not a footnote — a consumer that renders `pct` without it is republishing
 * an attainment ratio as a progress bar, which is the defect this pair of fields exists to end.
 */
export type GoalPctBasis = "progress" | "attainment";

/** Meter captions, single-sourced so every surface says the same thing about the same number. */
export const GOAL_PCT_LABEL: Record<GoalPctBasis, string> = {
  progress: "Progress since this goal was set",
  attainment: "Current standing vs target (set before baselines were recorded — not progress)",
};

export interface GoalProgress {
  id: string;
  label: string;
  metric: string;
  metricLabel: string;
  target: number;
  current: number;
  /**
   * The meter, 0..100 — and `pctBasis` says WHICH QUESTION it answers, because two goals on one board
   * can legitimately answer different ones.
   *
   * `"progress"` (a goal created with a baseline): distance travelled from the baseline toward the
   * target, `(current − baseline) / (target − baseline)`. This is what a progress bar claims to mean.
   * A fresh goal reads 0 and fills as the fleet moves.
   *
   * `"attainment"` (a goal with NO stored baseline — created before Goal.baselineValue existed, or on
   * a scan-less fleet): current standing against the target, `current / target`. This is what the
   * meter ALWAYS meant before, and it is why the field is now labelled: a fleet at 45 targeting 50
   * shows a 90%-full bar on day one, which reads as "nearly done" and is systematically inflating
   * every goal report that reaches leadership. Old goals keep this number because a baseline invented
   * after the fact (the earliest scan on record, say) is a fabrication that can also make an in-flight
   * goal look regressed — a clearly-labelled true number beats a plausible false one. Render the label.
   *
   * Either way the pace/ETA fields are trend-derived and independent of the meter, so they remain the
   * better answer to "how much work remains". createGoal still rejects an already-met target so a goal
   * can never be BORN achieved (ambiguity-ui 07-16 goals #5).
   */
  pct: number;
  /** Which question `pct` answers — see above. Never omit this when rendering the meter. */
  pctBasis: GoalPctBasis;
  /** Ready-to-render caption for the meter, matching `pctBasis`. */
  pctLabel: string;
  /** The metric's fleet value when the goal was created, or null for a goal with no baseline. */
  baselineValue: number | null;
  /** When that baseline was captured (ISO), or null. */
  baselineAt: string | null;
  achieved: boolean;
  status: string;
  /** When the goal first reached its target (ISO date), or null while it's still in progress. */
  achievedAt: string | null;
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
  /**
   * The metric's per-day fleet-average trend — the SAME series the pace/ETA projection was fitted
   * on, exposed so the goal card can draw the trajectory toward the target instead of a
   * point-in-time meter. Display-clamped to the plan's retention floor (the projector still fits
   * the full series — behavior unchanged) and capped to the most recent 90 daily points.
   */
  series: SeriesPoint[];
}

/**
 * The goal meter, and the honest statement of which question it answers.
 *
 * PROGRESS needs three numbers — where we started, where we are, where we're going — and the first
 * one is only knowable at creation time. With a stored baseline the meter is the fraction of the
 * intended journey actually travelled; without one the best available answer is standing against the
 * target, which is a DIFFERENT question and must be labelled as such rather than dressed up as
 * progress (see GoalProgress.pct).
 *
 * Edges, all deliberate:
 * - `target <= baseline` — reachable by retargeting an existing goal downward past its baseline.
 *   The journey has no length, so progress is undefined; fall back to attainment rather than divide
 *   by zero or claim 100%.
 * - `current < baseline` (the fleet regressed below where it started) — clamped to 0. A negative
 *   meter has no rendering, and "no progress yet" is true; the pace/trajectory fields carry the
 *   backslide, and `achieved`/`status` still revert on a regression below target.
 * - `target === 0` — the pre-existing attainment edge, kept: everything is at or above 0, so 100.
 */
function goalMeter(
  current: number,
  target: number,
  baseline: number | null,
): { pct: number; basis: GoalPctBasis } {
  if (baseline !== null && target > baseline) {
    const travelled = (current - baseline) / (target - baseline);
    return { pct: Math.max(0, Math.min(100, Math.round(travelled * 100))), basis: "progress" };
  }
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 100;
  return { pct, basis: "attainment" };
}

export async function createGoal(
  orgSlug: string,
  input: { label: string; metric: GoalMetric; target: number; targetDate?: string | null },
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await ensureOrg(orgSlug);
  // A target at or below today's fleet value would be stamped "achieved" on the very next listGoals
  // pass, polluting the Met 🎉 history with a milestone that represents zero movement. Reject it at the
  // source with the number the user needs to pick better (ambiguity-ui 07-16 goals #5). Skipped for a
  // scan-less fleet, where every metric reads 0 and the guard would be meaningless.
  // The same read is also THE BASELINE: this is the one moment the metric's starting value is
  // knowable, so it is captured here (below) rather than reconstructed later from scan history.
  const snap = await fleetSnapshot(org.id);
  const current = currentFor(input.metric, snap);
  if (snap.repos.length > 0 && Math.round(input.target) <= current) {
    throw Object.assign(
      new Error(`The fleet is already at ${current} on this metric; pick a target above it.`),
      { code: "GOAL_ALREADY_MET" },
    );
  }
  // Baseline ONLY when the fleet has actually been measured. On a scan-less fleet `currentFor` returns
  // 0 as a placeholder, not as an observation, and storing that 0 would mint a fabricated measurement
  // that is indistinguishable from a real one for the rest of the goal's life. Null instead: the meter
  // renders as labelled attainment until — and only if — someone sets a goal against a measured fleet.
  const measured = snap.repos.length > 0;
  const goal = await prisma.goal.create({
    data: {
      orgId: org.id,
      label: input.label.slice(0, 200),
      metric: input.metric,
      target: Math.max(0, Math.min(100, Math.round(input.target))),
      targetDate: parseTargetDate(input.targetDate),
      ...(measured ? { baselineValue: current, baselineAt: new Date() } : {}),
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
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const [goals, snap, orgRow] = await Promise.all([
    prisma.goal.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } }),
    fleetSnapshot(orgId),
    prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } }),
  ]);
  const series = await metricSeries(orgId, new Set(goals.map((g) => g.metric)));
  const now = Date.now();
  // Display clamp for the per-goal trend series: entitlement-gated exactly like getOrgRollup's
  // trend (a Free org must not SEE history deeper than its retention floor). The projector keeps
  // fitting the full series — clamping what feeds pace/ETA would silently change verdicts.
  const retentionStart = retentionCutoff(orgRow?.plan, now);
  const cutoffKey = retentionStart ? retentionStart.toISOString().slice(0, 10) : null;
  const displaySeries = (metric: string): SeriesPoint[] => {
    const s = series[metric] ?? [];
    return (cutoffKey ? s.filter((p) => p.date >= cutoffKey) : s).slice(-90);
  };
  // GOAL-4: the achieved transition is SYMMETRIC. A goal that first reaches its target is stamped
  // achieved (status + achievedAt) exactly once; a goal already "achieved" whose live value has since
  // regressed below target is reverted to "active" (achievedAt cleared) so the board reflects the
  // backslide instead of latching a false "🎉 Achieved" forever. Both are collected here and
  // persisted (best-effort) after the map. Idempotent: an already-achieved goal still at/above target
  // triggers no write.
  const justAchieved: string[] = [];
  const justRegressed: string[] = [];
  const out = goals.map((g) => {
    const current = currentFor(g.metric, snap);
    const targetDate = g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null;
    const proj = projectGoal({ series: series[g.metric] ?? [], current, target: g.target, targetDate, nowMs: now });
    const below = snap.repos
      .map((r) => ({ fullName: r.fullName, name: r.name, value: repoValueFor(g.metric, r) }))
      .filter((r) => r.value < g.target)
      .sort((a, b) => a.value - b.value || a.fullName.localeCompare(b.fullName))
      .map((r) => ({ ...r, gap: g.target - r.value }));
    const reached = current >= g.target;
    const newlyAchieved = reached && g.status === "active";
    const regressed = !reached && g.status === "achieved";
    if (newlyAchieved) justAchieved.push(g.id);
    if (regressed) justRegressed.push(g.id);
    const status = newlyAchieved ? "achieved" : regressed ? "active" : g.status;
    const achievedAt = newlyAchieved
      ? new Date(now).toISOString()
      : regressed
        ? null
        : g.achievedAt
          ? g.achievedAt.toISOString()
          : null;
    // `baselineValue` is nullable on Goal (see prisma/schema.prisma): null = created before baselines
    // existed, or on a fleet with no scans. `?? null` normalizes the undefined a partial select /
    // pre-migration client can hand back, so the basis is decided on one value with one meaning.
    const baseline = g.baselineValue ?? null;
    const meter = goalMeter(current, g.target, baseline);
    return {
      id: g.id,
      label: g.label,
      metric: g.metric,
      metricLabel: metricLabel(g.metric),
      target: g.target,
      current,
      pct: meter.pct,
      pctBasis: meter.basis,
      pctLabel: GOAL_PCT_LABEL[meter.basis],
      baselineValue: baseline,
      baselineAt: g.baselineAt ? g.baselineAt.toISOString() : null,
      achieved: reached,
      status,
      achievedAt,
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
      series: displaySeries(g.metric),
    };
  });
  // Best-effort persistence of the transition (both directions) — a failed write just re-marks on the
  // next load.
  if (justAchieved.length || justRegressed.length) {
    const at = new Date(now);
    await Promise.all([
      ...justAchieved.map((id) => prisma.goal.update({ where: { id }, data: { status: "achieved", achievedAt: at } }).catch(() => {})),
      ...justRegressed.map((id) => prisma.goal.update({ where: { id }, data: { status: "active", achievedAt: null } }).catch(() => {})),
    ]);
  }
  return out;
}

/** Clamp a goal target into the stored 0..100 integer range (mirrors createGoal). */
function normTarget(t: number): number {
  return Math.max(0, Math.min(100, Math.round(t)));
}

/**
 * Patch a goal, guarding against LOST UPDATES with an optimistic compare-and-set (no `updateAt`/version
 * column exists on Goal and the schema is frozen here, so we can't do a whole-row version check — we
 * reuse updateRecommendation's value-compare guard instead). The update lands ONLY if each field this
 * patch writes still equals the value the editor last saw (`expected`), normalized the same way it is
 * stored. Two admins editing the SAME field: the second's conditional `updateMany` matches 0 rows →
 * GOAL_CONFLICT (the route surfaces 409) so a deliberate retarget/relabel is never silently clobbered;
 * editing DIFFERENT fields never conflicts. When the caller sends no `expected` value for a field we
 * fall back to the server pre-image, which still catches truly-overlapping writes (under READ COMMITTED
 * the second updateMany re-reads the row and won't match the changed field). Throws P2025 when the id
 * is unknown so the route 404s, matching the old `goal.update` behavior.
 */
export async function updateGoal(
  id: string,
  data: { status?: string; target?: number; label?: string; targetDate?: string | null },
  expected: { status?: string; target?: number; label?: string; targetDate?: string | null } = {},
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const write: Record<string, unknown> = {
    // Written verbatim — the PATCH route is the validation gate (GOAL_STATUSES in @/lib/types).
    ...(data.status ? { status: data.status } : {}),
    ...(typeof data.target === "number" ? { target: normTarget(data.target) } : {}),
    ...(data.label ? { label: data.label.slice(0, 200) } : {}),
    ...("targetDate" in data ? { targetDate: parseTargetDate(data.targetDate) } : {}),
  };
  const current = await prisma.goal.findUnique({
    where: { id },
    select: { status: true, target: true, label: true, targetDate: true },
  });
  if (!current) throw Object.assign(new Error("Goal not found."), { code: "P2025" });
  if (Object.keys(write).length === 0) return true; // no-op patch; existence already confirmed
  // Key the conditional update on the last-seen value of ONLY the fields being written (expected when
  // supplied, else the server pre-image) — guarding untouched fields would raise false conflicts.
  const where: Record<string, unknown> = { id };
  if ("status" in write) where.status = expected.status != null ? expected.status : current.status;
  if ("target" in write) where.target = typeof expected.target === "number" ? normTarget(expected.target) : current.target;
  if ("label" in write) where.label = typeof expected.label === "string" ? expected.label.slice(0, 200) : current.label;
  if ("targetDate" in write) where.targetDate = "targetDate" in expected ? parseTargetDate(expected.targetDate) : current.targetDate;
  const res = await prisma.goal.updateMany({ where, data: write });
  if (res.count === 0) {
    throw Object.assign(new Error("Goal changed concurrently; refresh and retry."), { code: "GOAL_CONFLICT" });
  }
  return true;
}

export async function deleteGoal(id: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  await getPrisma().goal.delete({ where: { id } });
  return true;
}

/**
 * Resolve the owning org's slug for a planning row via a delegate-specific findUnique thunk. Shared by
 * the goal/initiative per-row tenant gates so the "no DB ⇒ null / unknown id ⇒ null" contract is
 * single-sourced. Null = persistence unconfigured or id unknown.
 */
async function ownerOrgSlug(find: () => Promise<{ org: { slug: string } } | null>): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const row = await find();
  return row?.org.slug ?? null;
}

/** The owning org's slug for a goal id (for the per-row tenant gate on /api/org/goals/:id). Null = unknown id. */
export function getGoalOrgSlug(id: string): Promise<string | null> {
  return ownerOrgSlug(() => getPrisma().goal.findUnique({ where: { id }, select: { org: { select: { slug: true } } } }));
}

// The Initiatives and What-if simulator sections that used to follow (createInitiative, listInitiatives,
// updateInitiative, getInitiativeOrgSlug, simulateOrgFixes, goalImpactsForScenario, rankOrgInvestments)
// were retired with the Plan tab on 2026-08-17, along with src/lib/scoring/orgsim.ts and the
// /api/org/initiatives + /api/org/simulate routes. The follow-ups ledger (src/lib/org/followups.ts) is
// the mechanism that replaced them for the common case: gaps sized for one agent session, one fix
// prompt, closed by the next scan. Goals remain READ by the briefing, the live wall, the overview's
// fix-first band and the digest alerts; their management UI retired with the tab.
