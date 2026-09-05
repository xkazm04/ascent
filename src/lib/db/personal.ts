// Personal-workspace reads (Organization.kind === "personal") — the LENS over the shared public
// corpus. A personal org holds pointer Repository rows only (watched=true, never scanned under this
// org); a public repo's scan SERIES lives in the shared PUBLIC_ORG so every individual watching the
// same repo enriches ONE history (and commit-SHA dedup keeps working). These helpers join the two
// sides by fullName, clamp reads to the personal plan's retention window (the tier's advertised
// history, enforced non-destructively — see retentionCutoff), and fit the same forecastTrajectory
// the org rollup uses so the personal dashboard renders real trajectories without duplicating a
// single scan row.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { PUBLIC_ORG } from "@/lib/org-constants";
import { planAllowsMemory, planAllowsSkillsLibrary, retentionCutoff } from "@/lib/plans";
import { forecastTrajectory, type Forecast } from "@/lib/maturity/forecast";

// ── Free-with-limits caps (individual tier, decision 4) ───────────────────────────────────────────
// A personal workspace authors memory/skills for free, bounded by row counts instead of a plan gate.
// Enforced at the write APIs; Phase 4 centralizes these into one metered module with usage readouts.
export const PERSONAL_WATCH_LIMIT = 10;
export const PERSONAL_MEMORY_LIMIT = 100;
export const PERSONAL_SKILL_LIMIT = 10;

export interface PersonalScanPoint {
  at: string; // ISO scannedAt
  score: number;
  level: string;
  headSha: string | null;
}

export interface PersonalRepo {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  /** Scans visible within the plan's retention window (the series length). */
  scanCount: number;
  latest: PersonalScanPoint | null;
  /** Overall delta vs the previous visible scan; null with fewer than two scans. */
  delta: number | null;
  /** Overall-score series, oldest → newest, within the retention window. */
  series: PersonalScanPoint[];
  /** Straight-line trajectory over the series; null until two distinct scan days exist. */
  forecast: Forecast | null;
}

/** Is `slug` a personal workspace? False for real orgs, unknown slugs, or DB-off. */
export async function isPersonalOrg(slug: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const org = await getPrisma().organization.findUnique({
    where: { slug: slug.trim().toLowerCase() },
    select: { kind: true },
  });
  return org?.kind === "personal";
}

/**
 * May this workspace WRITE memory? Team+ plans always may (the org entitlement); a PERSONAL org may
 * on any plan — the individual tier's free-with-limits authoring (the caps above bound volume).
 * The plan is passed in because every caller already holds it (credit state).
 */
export async function workspaceAllowsMemory(slug: string, plan: string | null | undefined): Promise<boolean> {
  return planAllowsMemory(plan) || (await isPersonalOrg(slug));
}

/** Skills-library twin of {@link workspaceAllowsMemory}. */
export async function workspaceAllowsSkills(slug: string, plan: string | null | undefined): Promise<boolean> {
  return planAllowsSkillsLibrary(plan) || (await isPersonalOrg(slug));
}

/** Is the free personal MEMORY cap reached? False for orgs whose plan already allows memory (no cap). */
export async function personalMemoryCapReached(slug: string, plan: string | null | undefined): Promise<boolean> {
  if (planAllowsMemory(plan) || !isDbConfigured()) return false;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: slug.trim().toLowerCase() }, select: { id: true } });
  if (!org) return false;
  // Live rows only — archived/superseded memories don't count against the cap (corrections stay free).
  const n = await prisma.orgMemory.count({ where: { orgId: org.id, archived: false, supersededBy: null } });
  return n >= PERSONAL_MEMORY_LIMIT;
}

/** Is the free personal SKILL cap reached? False for orgs whose plan already allows the library. */
export async function personalSkillCapReached(slug: string, plan: string | null | undefined): Promise<boolean> {
  if (planAllowsSkillsLibrary(plan) || !isDbConfigured()) return false;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: slug.trim().toLowerCase() }, select: { id: true } });
  if (!org) return false;
  const n = await prisma.orgSkill.count({ where: { orgId: org.id, archived: false } });
  return n >= PERSONAL_SKILL_LIMIT;
}

/** One free-with-limits meter: how much of a capped resource the workspace has used. */
export interface PersonalMeter {
  used: number;
  limit: number;
}

export interface PersonalUsage {
  watched: PersonalMeter;
  memories: PersonalMeter;
  skills: PersonalMeter;
}

/**
 * The workspace's usage against every individual-tier cap, in one read — the readout behind the
 * overview's limits strip (and the honest counterpart to the 402s the write APIs return at the
 * caps). Counts LIVE rows only, mirroring the cap predicates. Null when the DB is off or the org
 * doesn't exist yet (a pre-bootstrap workspace has used nothing).
 */
export async function getPersonalUsage(slug: string): Promise<PersonalUsage | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: slug.trim().toLowerCase() },
    select: { id: true },
  });
  if (!org) return null;
  const [watched, memories, skills] = await Promise.all([
    prisma.repository.count({ where: { orgId: org.id, watched: true } }),
    prisma.orgMemory.count({ where: { orgId: org.id, archived: false, supersededBy: null } }),
    prisma.orgSkill.count({ where: { orgId: org.id, archived: false } }),
  ]);
  return {
    watched: { used: watched, limit: PERSONAL_WATCH_LIMIT },
    memories: { used: memories, limit: PERSONAL_MEMORY_LIMIT },
    skills: { used: skills, limit: PERSONAL_SKILL_LIMIT },
  };
}

/** Watched-pointer count for the watch API's PERSONAL_WATCH_LIMIT gate. 0 when the org doesn't exist yet. */
export async function countPersonalWatched(slug: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: slug.trim().toLowerCase() },
    select: { id: true },
  });
  if (!org) return 0;
  return prisma.repository.count({ where: { orgId: org.id, watched: true } });
}

/**
 * The personal dashboard's whole read: each watched repo joined to its PUBLIC-corpus scan series.
 * Returns null when the DB is off or the personal org doesn't exist, [] for an empty watchlist.
 * `nowMs` is injected for testability (retention clamp + forecast anchor share one clock).
 */
export async function getPersonalWatchlist(personalSlug: string, nowMs: number = Date.now()): Promise<PersonalRepo[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: personalSlug.trim().toLowerCase() },
    select: { id: true, plan: true },
  });
  if (!org) return null;

  const watched = await prisma.repository.findMany({
    where: { orgId: org.id, watched: true },
    select: { owner: true, name: true, fullName: true, url: true },
    orderBy: { fullName: "asc" },
  });
  if (watched.length === 0) return [];

  // The series lives under the shared public org — the lens. A missing public org (virgin DB) just
  // means every watched repo shows as unscanned.
  const pub = await prisma.organization.findUnique({ where: { slug: PUBLIC_ORG }, select: { id: true } });
  const cutoff = retentionCutoff(org.plan, nowMs);
  const scans = pub
    ? await prisma.scan.findMany({
        where: {
          repo: { orgId: pub.id, fullName: { in: watched.map((w) => w.fullName) } },
          ...(cutoff ? { scannedAt: { gte: cutoff } } : {}),
        },
        select: {
          overallScore: true,
          level: true,
          scannedAt: true,
          headSha: true,
          repo: { select: { fullName: true } },
        },
        orderBy: { scannedAt: "asc" },
      })
    : [];

  const byRepo = new Map<string, PersonalScanPoint[]>();
  for (const s of scans) {
    const point: PersonalScanPoint = {
      at: s.scannedAt.toISOString(),
      score: s.overallScore,
      level: s.level,
      headSha: s.headSha ?? null,
    };
    const list = byRepo.get(s.repo.fullName);
    if (list) list.push(point);
    else byRepo.set(s.repo.fullName, [point]);
  }

  return watched.map((w) => {
    const series = byRepo.get(w.fullName) ?? [];
    const latest = series[series.length - 1] ?? null;
    const prev = series[series.length - 2] ?? null;
    return {
      owner: w.owner,
      name: w.name,
      fullName: w.fullName,
      url: w.url,
      scanCount: series.length,
      latest,
      delta: latest && prev ? latest.score - prev.score : null,
      series,
      forecast: forecastTrajectory(
        series.map((p) => ({ date: p.at, value: p.score })),
        undefined,
        nowMs,
      ),
    };
  });
}
