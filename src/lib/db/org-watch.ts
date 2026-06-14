// Enterprise org layer: watchlist + scan scheduling. All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { segmentScope } from "@/lib/db/org-shared";

const SCHEDULE_DAYS: Record<string, number> = { off: 0, daily: 1, weekly: 7, monthly: 30 };

function nextScanFor(schedule: string): Date | null {
  const d = SCHEDULE_DAYS[schedule] ?? 0;
  return d > 0 ? new Date(Date.now() + d * 86_400_000) : null;
}

/** Is a repo watched (the gate for push-triggered re-scans)? False when DB off or repo unknown. */
export async function isRepoWatched(orgSlug: string, fullName: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return false;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId: org.id, fullName } },
    select: { watched: true },
  });
  return Boolean(repo?.watched);
}

async function ensureOrg(slug: string) {
  return getPrisma().organization.upsert({
    where: { slug },
    update: {},
    create: { slug, name: slug === "public" ? "Public Scans" : slug, plan: "private" },
  });
}

export interface RepoRef {
  owner: string;
  name: string;
  fullName: string;
  url?: string;
  isPrivate?: boolean;
  /** ISO of the repo's last scan, when known — lets a bulk scan skip still-fresh repos. */
  lastScanAt?: string | null;
}

/** Upsert a repo (from an installation listing) and set its watched flag. */
export async function setRepoWatch(orgSlug: string, repo: RepoRef, watched: boolean): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const org = await ensureOrg(orgSlug);
  await prisma.repository.upsert({
    where: { orgId_fullName: { orgId: org.id, fullName: repo.fullName } },
    update: { watched, url: repo.url ?? undefined, isPrivate: repo.isPrivate ?? undefined },
    create: {
      orgId: org.id,
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      url: repo.url ?? `https://github.com/${repo.fullName}`,
      isPrivate: repo.isPrivate ?? false,
      watched,
    },
  });
}

export async function setRepoSchedule(orgSlug: string, fullName: string, schedule: string): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return;
  await prisma.repository.updateMany({
    where: { orgId: org.id, fullName },
    data: { scanSchedule: schedule, nextScanAt: nextScanFor(schedule) },
  });
}

/**
 * Set the autoscan cadence for the WHOLE watched set of an org in one write — optionally scoped to a
 * segment — so a fleet owner manages cadence as policy ("rescan the platform segment weekly") instead
 * of clicking every repo. Reuses the same segment where-fragment as the read aggregates, so a segment
 * id from another org matches nothing. Returns how many repos were updated.
 */
export async function setWatchedSchedule(
  orgSlug: string,
  schedule: string,
  segmentId?: string | null,
): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return 0;
  const res = await prisma.repository.updateMany({
    where: { orgId: org.id, watched: true, ...segmentScope(segmentId) },
    data: { scanSchedule: schedule, nextScanAt: nextScanFor(schedule) },
  });
  return res.count;
}

/**
 * Pre-populate an org's watchlist from login-time auto-discovery: upsert each repo as WATCHED on a
 * weekly schedule, due immediately (nextScanAt = now) so the autoscan cron — or the dashboard's
 * "Scan all watched" — fills in scores on its next pass. This turns a brand-new user's blank org
 * view into one with a real fleet to act on (its rollup and trends populate once those seeded
 * repos are scanned).
 *
 * Idempotent and non-destructive: the upsert only WRITES on first sight (`update: {}`), so
 * re-running on each login never duplicates a repo and never overrides a watch/schedule the user
 * has since changed. Returns the number of repos processed; 0 (a no-op) when persistence is off or
 * no repos were supplied. Caller treats it as best-effort — a failure must not block sign-in.
 */
export async function seedWatchlist(orgSlug: string, repos: RepoRef[]): Promise<number> {
  if (!isDbConfigured() || repos.length === 0) return 0;
  const prisma = getPrisma();
  const org = await ensureOrg(orgSlug);
  const dueNow = new Date();
  let seeded = 0;
  for (const r of repos) {
    await prisma.repository.upsert({
      where: { orgId_fullName: { orgId: org.id, fullName: r.fullName } },
      update: {}, // respect any later user choice — only seed repos we've never recorded
      create: {
        orgId: org.id,
        owner: r.owner,
        name: r.name,
        fullName: r.fullName,
        url: r.url ?? `https://github.com/${r.fullName}`,
        isPrivate: r.isPrivate ?? false,
        watched: true,
        scanSchedule: "weekly",
        nextScanAt: dueNow,
      },
    });
    seeded += 1;
  }
  return seeded;
}

export interface DueRescan {
  orgSlug: string;
  fullName: string;
  repoId: string;
  scanSchedule: string;
}

/**
 * Repos whose autoscan is due (watched, scheduled, nextScanAt in the past), fairly interleaved
 * across orgs so one large fleet can't starve every other org within a single cron run.
 *
 * A pure `orderBy nextScanAt asc` + `take` lets the single most-overdue org monopolize each run, so
 * past `limit` due repos the back of the fleet never gets scanned. Instead we fetch a wider candidate
 * set (still oldest-due first), group by org, and round-robin across orgs — each run spreads work
 * fleet-wide while still preferring the most-overdue repo within each org.
 */
export async function listDueRescans(limit = 100): Promise<DueRescan[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const due = await prisma.repository.findMany({
    where: { watched: true, scanSchedule: { not: "off" }, nextScanAt: { lte: new Date() } },
    select: { id: true, fullName: true, scanSchedule: true, org: { select: { slug: true } } },
    orderBy: { nextScanAt: "asc" },
    take: limit * 4, // wider candidate pool to interleave; capped back to `limit` below
  });
  const byOrg = new Map<string, DueRescan[]>();
  for (const r of due) {
    const item: DueRescan = { orgSlug: r.org.slug, fullName: r.fullName, repoId: r.id, scanSchedule: r.scanSchedule };
    const q = byOrg.get(item.orgSlug);
    if (q) q.push(item);
    else byOrg.set(item.orgSlug, [item]);
  }
  const queues = [...byOrg.values()];
  const out: DueRescan[] = [];
  for (let i = 0; out.length < limit && queues.some((q) => q.length > 0); i++) {
    const next = queues[i % queues.length]!.shift(); // safe: i % queues.length is always a valid index
    if (next) out.push(next);
  }
  return out;
}

/** After a SUCCESSFUL autoscan, advance the repo's next due time by its full cadence. */
export async function advanceSchedule(repoId: string, schedule: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().repository.update({ where: { id: repoId }, data: { nextScanAt: nextScanFor(schedule) } });
}

/**
 * Atomically CLAIM a due repo BEFORE scanning it, so two overlapping cron runs (a long batch near the
 * 300s ceiling, a manual `?key=` retry, or a re-fired schedule) can't both pick up the same repo and
 * double-scan + double-bill it. The conditional `updateMany` advances `nextScanAt` to the next cadence
 * ONLY while the repo is still due (watched, scheduled, `nextScanAt` in the past); the first run to win
 * the DB-serialized update flips the repo out of the due window, so the loser's update matches 0 rows
 * and skips. This is cross-instance safe (unlike the process-local {@link withRepoLock}). Returns true
 * iff this caller won the claim. On a scan FAILURE the caller overrides this cadence with
 * {@link advanceScheduleAfterFailure}'s shorter backoff; on success the cadence set here stands, so a
 * separate post-success advance is unnecessary.
 */
export async function claimRescan(repoId: string, schedule: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const next = nextScanFor(schedule);
  if (!next) return false; // "off"/unknown schedule isn't claimable (and listDueRescans excludes it)
  const res = await getPrisma().repository.updateMany({
    where: { id: repoId, watched: true, scanSchedule: { not: "off" }, nextScanAt: { lte: new Date() } },
    data: { nextScanAt: next },
  });
  return res.count === 1;
}

/** Retry backoff after a FAILED autoscan. Critical for queue fairness: the schedule used to advance
 *  only on success, so a persistently-broken repo (revoked token, deleted repo) stayed permanently
 *  due at the front of the oldest-first queue and re-failed every run, crowding out healthy repos.
 *  Pushing nextScanAt a fixed backoff out moves it off the front and retries it on a later cron,
 *  without waiting the full cadence. */
const FAILED_RESCAN_BACKOFF_MS = 6 * 60 * 60_000; // 6h
export async function advanceScheduleAfterFailure(repoId: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().repository.update({
    where: { id: repoId },
    data: { nextScanAt: new Date(Date.now() + FAILED_RESCAN_BACKOFF_MS) },
  });
}

/**
 * Record the outcome of a scan ATTEMPT on a repo so the dashboard can tell "scanning is broken"
 * (revoked token, deleted repo, rate-limited) apart from "never scanned" — previously every bulk/cron
 * failure was only console-logged and thrown away, so a repo failing for weeks looked identical to one
 * never scanned. A success clears any prior error. Keyed by (orgSlug, fullName); a safe no-op when the
 * repo row doesn't exist yet. Best-effort: callers don't let a bookkeeping write fail the scan loop.
 */
export async function recordScanOutcome(
  orgSlug: string,
  fullName: string,
  outcome: { ok: boolean; error?: string },
): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return;
  await prisma.repository.updateMany({
    where: { orgId: org.id, fullName },
    data: {
      lastScanStatus: outcome.ok ? "ok" : "error",
      lastScanError: outcome.ok ? null : (outcome.error ?? "scan failed").slice(0, 500),
      lastScanAttemptAt: new Date(),
    },
  });
}

/**
 * Record a `.ai/` standard conformance report (from the repo's doctor) onto the Repository row, so
 * the adopt→verify→re-score loop closes in-app. No-op without a DB or when the repo isn't tracked
 * under this org (updateMany matches 0). Returns whether a row was updated. Mirrors recordScanOutcome.
 */
export async function recordConformance(
  orgSlug: string,
  fullName: string,
  c: { score: number; fails: number; warns: number },
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { id: true } });
  if (!org) return false;
  const clamp = (n: number) => Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
  const res = await prisma.repository.updateMany({
    where: { orgId: org.id, fullName },
    data: {
      aiConformance: Math.min(100, clamp(c.score)),
      aiConformanceFails: clamp(c.fails),
      aiConformanceWarns: clamp(c.warns),
      aiConformanceAt: new Date(),
    },
  });
  return res.count > 0;
}

/** Watched repos for an org (for bulk scan / cron). */
export async function listWatchedRepos(orgSlug: string): Promise<RepoRef[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return [];
  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, watched: true },
    select: { owner: true, name: true, fullName: true, url: true, isPrivate: true, lastScanAt: true },
    orderBy: { fullName: "asc" },
  });
  return repos.map((r) => ({
    owner: r.owner,
    name: r.name,
    fullName: r.fullName,
    url: r.url,
    isPrivate: r.isPrivate,
    lastScanAt: r.lastScanAt ? r.lastScanAt.toISOString() : null,
  }));
}

/** Org slugs with at least one watched repo — the fleets a scheduled digest should summarize. */
export async function listOrgsWithWatchedRepos(): Promise<string[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().repository.findMany({
    where: { watched: true },
    select: { org: { select: { slug: true } } },
    distinct: ["orgId"],
  });
  return [...new Set(rows.map((r) => r.org.slug))];
}
