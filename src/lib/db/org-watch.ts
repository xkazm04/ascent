// Enterprise org layer: watchlist + scan scheduling. All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { segmentScope } from "@/lib/db/org-shared";
import { withAuditSignature } from "@/lib/db/audit-integrity";
import type { Schedule } from "@/components/connect/installationRepoTypes";

// Keyed on the canonical Schedule vocabulary (installationRepoTypes) so the cadence set can't drift
// from the route validators / UI options — a missing or extra key is a compile error here.
const SCHEDULE_DAYS: Record<Schedule, number> = { off: 0, daily: 1, weekly: 7, monthly: 30 };

function nextScanFor(schedule: string): Date | null {
  // schedule arrives as a free string from the API; an unknown value falls through to 0 ("off").
  const d = SCHEDULE_DAYS[schedule as Schedule] ?? 0;
  return d > 0 ? new Date(Date.now() + d * 86_400_000) : null;
}

/** Is a repo watched (the gate for push-triggered re-scans)? False when DB off or repo unknown. */
export async function isRepoWatched(orgSlug: string, fullName: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
    select: { watched: true },
  });
  return Boolean(repo?.watched);
}

async function ensureOrg(slug: string) {
  return getPrisma().organization.upsert({
    where: { slug },
    update: {},
    // Plan is the canonical platform default ("free") — billing owns upgrades. This path used to
    // mint the legacy non-PlanId string "private" (which planFeatures resolved to the free tier
    // anyway); aligned with installations.ts/members.ts so first-touch order can't change the
    // stored plan (github-app-installation-webhooks #1).
    create: { slug, name: slug === "public" ? "Public Scans" : slug, plan: "free" },
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
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return;
  await prisma.repository.updateMany({
    where: { orgId, fullName },
    data: { scanSchedule: schedule, nextScanAt: nextScanFor(schedule) },
  });
}

/**
 * Set the autoscan cadence for the WHOLE watched set of an org in one write — optionally scoped to a
 * segment — so a fleet owner manages cadence as policy ("rescan the platform segment weekly") instead
 * of clicking every repo. Reuses the same segment where-fragment as the read aggregates, so a segment
 * id from another org matches nothing. Returns the fullNames of the repos that were updated, so the
 * caller can reconcile its optimistic UI against exactly what persisted (updateMany yields only a
 * count, which can't reveal that the client's watched set was larger than the DB's).
 */
export async function setWatchedSchedule(
  orgSlug: string,
  schedule: string,
  segmentId?: string | null,
): Promise<string[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return [];
  const where = { orgId: org.id, watched: true, ...segmentScope(segmentId) };
  // Capture which repos the update targets BEFORE writing (updateMany returns only a count), so the
  // caller learns the exact set the server actually scheduled — preventing "schedule success theater"
  // where a row shows a cadence the server never saved.
  const affected = await prisma.repository.findMany({ where, select: { fullName: true } });
  await prisma.repository.updateMany({
    where,
    data: { scanSchedule: schedule, nextScanAt: nextScanFor(schedule) },
  });
  return affected.map((r) => r.fullName);
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
    // Personal workspaces are excluded defensively: an autoscan would persist the scan UNDER the
    // personal org, forking the public repo's shared series (the individual-tier lens invariant).
    // The schedule APIs already refuse personal orgs (requireFleetOrg); this keeps a row that
    // slipped a schedule in anyway (legacy data, direct write) from ever burning cron budget on it.
    where: { watched: true, scanSchedule: { not: "off" }, nextScanAt: { lte: new Date() }, org: { kind: { not: "personal" } } },
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

// How far a claim leases a repo. Long enough to block an overlapping pass from re-claiming the same
// repo mid-run, short enough that a repo whose run DIED/timed out between claim and scan re-qualifies on
// the next cron pass rather than waiting a whole cadence (a month, for `monthly`).
const CLAIM_LEASE_MS = 15 * 60_000; // 15 min

/**
 * Atomically CLAIM a due repo BEFORE scanning it, so two overlapping cron runs (a long batch near the
 * 300s ceiling, a manual `?key=` retry, or a re-fired schedule) can't both pick up the same repo and
 * double-scan + double-bill it. The conditional `updateMany` advances `nextScanAt` by a SHORT LEASE
 * (not the full cadence) ONLY while the repo is still due (watched, scheduled, `nextScanAt` in the
 * past); the first run to win the DB-serialized update leases the repo out of the due window, so the
 * loser's update matches 0 rows and skips. Cross-instance safe (unlike the process-local
 * {@link withRepoLock}). Returns true iff this caller won the claim.
 *
 * The lease (not full cadence) is deliberate: if this run dies or times out between the claim and the
 * scan, the repo only waits the lease before becoming due again — instead of silently skipping a whole
 * cadence with no error. The caller MUST settle the lease: {@link advanceToFullCadence} on a successful
 * scan (or a deliberate cadence-skip like no-credit / broken-install), {@link advanceScheduleAfterFailure}
 * on a scan failure (a 6h backoff, longer than the lease, so it wins).
 */
export async function claimRescan(repoId: string, schedule: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  if (!nextScanFor(schedule)) return false; // "off"/unknown schedule isn't claimable (and listDueRescans excludes it)
  const res = await getPrisma().repository.updateMany({
    where: { id: repoId, watched: true, scanSchedule: { not: "off" }, nextScanAt: { lte: new Date() } },
    data: { nextScanAt: new Date(Date.now() + CLAIM_LEASE_MS) },
  });
  return res.count === 1;
}

/**
 * Settle a claimed repo to its FULL next cadence — call after a successful rescan, or a deliberate
 * cadence-relevant skip (out of credits, broken installation), so the repo waits the real cadence
 * rather than re-qualifying after the short {@link claimRescan} lease. A no-op for an off/unknown
 * schedule or when persistence is off. Keyed by repo id, like claimRescan.
 */
export async function advanceToFullCadence(repoId: string, schedule: string): Promise<void> {
  if (!isDbConfigured()) return;
  const next = nextScanFor(schedule);
  if (!next) return;
  await getPrisma().repository.update({
    where: { id: repoId },
    data: { nextScanAt: next },
  });
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

// ── Per-repo in-flight scan claim (advisory, process-local, TTL) ──────────────────────────────────
// The MANUAL scan (/api/org/scan) and import (/api/org/import) funnels have no equivalent of the
// cron's DB-serialized {@link claimRescan} lease, so two concurrent runs — two browser tabs, two org
// members, or a scan overlapping an import — would BOTH reserve a credit and run real LLM inference for
// the SAME repo whenever the balance is ample. The atomic per-credit reserve (reserveScanCredit) bounds
// TOTAL spend against the balance, NOT per-repo DUPLICATION: with credits to spare, each run debits a
// credit and burns tokens on every repo. That is the money defect this claim closes.
//
// Why NOT reuse claimRescan's DB lease here? It keys on `nextScanAt <= now` (a DUE repo). A manual
// rescan must run regardless of cadence (the repo usually isn't due), and the import funnel scans repos
// that have NO Repository row yet (they're created mid-scan by setRepoWatch), so there is nothing in the
// DB to conditionally-update — and bending `nextScanAt` into a lock would corrupt the autoscan schedule.
// A dedicated scan-lock column is out of scope (no migration). So this is the finding's stated
// alternative: a per-(org,repo) ADVISORY lock, mirroring the sibling rate-limiter (src/lib/rate-limit.ts).
//
// Mechanism: a module-global Map of "orgSlug\0fullName" → lease-expiry epoch-ms. claimRepoScan is an
// ATOMIC test-and-set — there is NO `await` between reading the current claim and writing the new one,
// so within a single Node instance two concurrent callers can never both win. It returns a fencing
// token (the expiry it wrote) iff no LIVE claim existed, else null. TTL-based, NOT a boolean: a run that
// dies between claim and release (serverless kill / 300s timeout — a process kill is not a thrown error,
// so a `finally` won't run) leaves a claim that SELF-HEALS when it expires. A leaked boolean lock would
// bar a repo from every future scan — a strictly WORSE bug than the duplicate it guards against.
//
// SCOPE / LIMITATION: process-local, exactly like rate-limit.ts. It fully covers same-instance
// concurrency (the dominant case in the finding: two tabs / two members hitting one instance); it is
// NOT a cross-instance distributed lock. The DB-serialized reserveScanCredit stays the hard money
// ceiling underneath; this is the dedup layer on top. A cross-instance guarantee would need the same
// Redis/Upstash the rate-limiter notes.
const SCAN_CLAIM_TTL_MS = 15 * 60_000; // 15 min — matches claimRescan's lease; longer than any real single-repo scan
const scanClaims = new Map<string, number>();
const scanClaimKey = (orgSlug: string, fullName: string) => `${orgSlug.toLowerCase()}\u0000${fullName.toLowerCase()}`;

/**
 * Try to CLAIM an in-flight scan of (orgSlug, fullName) BEFORE reserving a credit or scanning, so two
 * concurrent runs can't double-scan + double-charge the same repo. Returns a fencing TOKEN (the lease
 * expiry) iff the caller won the claim — the caller then OWNS it and MUST call {@link releaseRepoScan}
 * with that token on EVERY exit path (success, throw, early-return). Returns null when another in-flight
 * run holds a LIVE (unexpired) claim: the caller must SKIP the repo (no reserve, no scan) rather than
 * duplicate the billable work. An EXPIRED claim is treated as free and reclaimed (crash self-heal).
 * Atomic within a process: no await between the liveness check and the set.
 */
export function claimRepoScan(orgSlug: string, fullName: string, ttlMs = SCAN_CLAIM_TTL_MS): number | null {
  const key = scanClaimKey(orgSlug, fullName);
  const now = Date.now();
  const held = scanClaims.get(key);
  if (held !== undefined && held > now) return null; // a LIVE claim is held by another in-flight run
  const token = now + ttlMs;
  scanClaims.set(key, token);
  // Opportunistic sweep so the map can't grow unbounded across many one-shot import repos (mirrors the
  // rate-limiter's cleanup). Only runs once the map is already large, so it's cheap in the common case.
  if (scanClaims.size > 10_000) {
    for (const [k, v] of scanClaims) if (v <= now) scanClaims.delete(k);
  }
  return token;
}

/**
 * Release a claim taken by {@link claimRepoScan}. Pass the token it returned: the claim is cleared ONLY
 * if it still matches, so a holder whose lease already EXPIRED (and was reclaimed by another run in the
 * meantime) can't clobber the new owner's claim — the fencing-token guard against the classic
 * expired-lease self-release footgun. Idempotent and safe to call for a key you no longer own.
 */
export function releaseRepoScan(orgSlug: string, fullName: string, token: number): void {
  const key = scanClaimKey(orgSlug, fullName);
  if (scanClaims.get(key) === token) scanClaims.delete(key);
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
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return;
  await prisma.repository.updateMany({
    where: { orgId, fullName },
    data: {
      lastScanStatus: outcome.ok ? "ok" : "error",
      lastScanError: outcome.ok ? null : (outcome.error ?? "scan failed").slice(0, 500),
      lastScanAttemptAt: new Date(),
    },
  });
}

/** Outcome of a conformance ingest: `recorded` = the Repository row was updated; `stale` = the
 *  report was IGNORED because its headSha was already reported before a newer commit (a re-run of
 *  an old CI workflow must not clobber the newest score). */
export interface ConformanceOutcome {
  recorded: boolean;
  stale: boolean;
}

/**
 * Record a `.ai/` standard conformance report (from the repo's doctor) onto the Repository row, so
 * the adopt→verify→re-score loop closes in-app. No-op without a DB or when the repo isn't tracked
 * under this org (updateMany matches 0). Mirrors recordScanOutcome.
 *
 * Ordering (ai-native-standard #2): every accepted report is also appended to the AuditLog as a
 * `conformance.reported` row carrying the commit sha, and that ledger orders re-runs — an incoming
 * sha that was already reported BEFORE the repo's latest report is a stale CI re-run (a retried
 * 2-week-old workflow, a backport branch) and is skipped instead of clobbering the newest score.
 * Reports without a headSha (older doctors, non-CI runs) remain last-write-wins — the ledger can't
 * order what it can't identify; the trade-off is deliberate and visible via `sha: null` ledger rows.
 */
export async function recordConformance(
  orgSlug: string,
  fullName: string,
  c: { score: number; fails: number; warns: number; headSha?: string | null },
): Promise<ConformanceOutcome> {
  if (!isDbConfigured()) return { recorded: false, stale: false };
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return { recorded: false, stale: false };
  const headSha = c.headSha?.trim().toLowerCase() || null;
  // `meta` is a JSON string; these exact-fragment matches work because the ledger writer below
  // serializes with a stable key order and shas/fullNames contain no JSON-escapable characters.
  const repoTag = `"repo":${JSON.stringify(fullName)}`;
  if (headSha) {
    const latest = await prisma.auditLog.findFirst({
      where: { orgId, action: "conformance.reported", meta: { contains: repoTag } },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { meta: true },
    });
    let latestSha: string | null = null;
    try {
      latestSha = (JSON.parse(latest?.meta ?? "{}") as { sha?: string | null }).sha ?? null;
    } catch {
      latestSha = null;
    }
    if (latestSha && latestSha !== headSha) {
      const seenBefore = await prisma.auditLog.findFirst({
        where: {
          orgId,
          action: "conformance.reported",
          AND: [{ meta: { contains: repoTag } }, { meta: { contains: `"sha":"${headSha}"` } }],
        },
        select: { id: true },
      });
      if (seenBefore) return { recorded: false, stale: true };
    }
  }
  const clamp = (n: number) => Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
  const score = Math.min(100, clamp(c.score));
  const fails = clamp(c.fails);
  const warns = clamp(c.warns);
  const res = await prisma.repository.updateMany({
    where: { orgId, fullName },
    data: {
      aiConformance: score,
      aiConformanceFails: fails,
      aiConformanceWarns: warns,
      aiConformanceAt: new Date(),
    },
  });
  if (res.count > 0) {
    // Append to the ledger AFTER a successful row update, so untracked-repo reports (recorded:false)
    // never seed ordering state. Stable key order — the ordering reads above depend on it.
    // SIGNED like every other audit write. This path used to JSON.stringify the meta directly, so
    // conformance rows landed with no `_sig` and verified as "unsigned" — in the one table whose whole
    // purpose is tamper-evidence, and for the one action a customer reports FROM their own CI (i.e. the
    // rows most worth forging). `createdAt` is stamped explicitly so the value signed is the value
    // stored: the signature covers the timestamp, and letting the DB default it would sign a different
    // instant than the row carries, making every row verify as tampered.
    const createdAt = new Date();
    await prisma.auditLog.create({
      data: {
        orgId,
        actorId: null,
        at: createdAt,
        action: "conformance.reported",
        meta: JSON.stringify(
          withAuditSignature({
            action: "conformance.reported",
            orgId,
            actorId: null,
            createdAt: createdAt.toISOString(),
            meta: { repo: fullName, sha: headSha, score, fails, warns },
          }),
        ),
      },
    });
  }
  return { recorded: res.count > 0, stale: false };
}

/** Watched repos for an org (for bulk scan / cron). */
export async function listWatchedRepos(orgSlug: string): Promise<RepoRef[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const repos = await prisma.repository.findMany({
    where: { orgId, watched: true },
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

// ── Missing-from-GitHub reconciliation ────────────────────────────────────────────────────────────
// Import upserts on (orgId, fullName), so re-importing never duplicates a row — but nothing ever
// reconciled REMOVALS. A repo renamed, transferred, deleted or turned private on GitHub stayed
// watched forever: it kept winning a slot in the daily rescan cap (listDueRescans, 100/day), failed,
// took the 6h backoff (advanceScheduleAfterFailure), and repeated — invisibly. On any org that
// reorganizes, the watchlist silently rots.
//
// This is a FLAG, deliberately not an eviction. A rename is indistinguishable from a deletion at the
// listing level, and a repo can be temporarily unlistable, so auto-unwatching would silently drop
// live repos. The stamp + a visible date + a one-click manual cleanup is the answer. (The sibling
// reconcileWatchedRepos in installations.ts DOES unwatch, because an installation listing is an
// authoritative statement about ACCESS, not existence — different evidence, different remedy.)

export interface MissingRepoReconciliation {
  /** Watched repos absent from the listing that received a first-sight stamp. */
  marked: number;
  /** Previously-stamped repos that reappeared and had their stamp cleared. */
  cleared: number;
}

/** A watched repo currently flagged as absent from GitHub's listing. */
export interface MissingRepo {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  /** ISO timestamp of the first listing that came back without it. */
  missingSince: string;
}

/**
 * Reconcile an org's WATCHED set against a repo listing from GitHub.
 *
 * CALLER CONTRACT — absence is only evidence when the listing is COMPLETE. Call this ONLY with the
 * repos of a listing that (a) succeeded, (b) was not page-budget `truncated`, and (c) was not cut
 * short by the caller's `count` window. A failed, truncated or count-capped listing must mark
 * NOTHING: every repo past the cut would otherwise be flagged as vanished.
 *
 * Marks each absent watched repo with a first-sight `missingSince` (an existing stamp is never
 * refreshed, so the displayed date stays the date it actually went missing), and CLEARS the stamp of
 * any repo that reappears. Never unwatches, never deletes: scored history stays in the rollups, and
 * cleanup is an explicit user action.
 *
 * PRIVATE repos are excluded from marking: the public org listing is `type=public`, so a private repo
 * is structurally absent from it and its absence carries no information. Forks and archived repos are
 * filtered out of that listing too (isListableRepo), so a watched fork/archived repo CAN be flagged —
 * which is honest ("no longer in the org's listable repos") and is why the remedy is a dated flag the
 * user judges, not an automatic drop.
 */
export async function reconcileListedRepos(
  orgSlug: string,
  listedFullNames: string[],
): Promise<MissingRepoReconciliation> {
  const none = { marked: 0, cleared: 0 };
  if (!isDbConfigured()) return none;
  // Defense in depth against the contract above: an EMPTY listing would flag the entire watchlist,
  // and "zero repos" is far more often a broken listing than a genuinely emptied org.
  if (listedFullNames.length === 0) return none;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return none;
  const live = new Set(listedFullNames.map((n) => n.toLowerCase()));
  const rows = await prisma.repository.findMany({
    where: { orgId },
    select: { id: true, fullName: true, watched: true, isPrivate: true, missingSince: true },
  });
  const present = (r: { fullName: string }) => live.has(r.fullName.toLowerCase());
  const clearIds = rows.filter((r) => r.missingSince !== null && present(r)).map((r) => r.id);
  const markIds = rows
    .filter((r) => r.watched && !r.isPrivate && r.missingSince === null && !present(r))
    .map((r) => r.id);
  if (clearIds.length > 0) {
    await prisma.repository.updateMany({ where: { id: { in: clearIds } }, data: { missingSince: null } });
  }
  if (markIds.length > 0) {
    await prisma.repository.updateMany({ where: { id: { in: markIds } }, data: { missingSince: new Date() } });
  }
  return { marked: markIds.length, cleared: clearIds.length };
}

/** Watched repos flagged as missing from GitHub's listing — the repositories tab's cleanup surface. */
export async function listMissingRepos(orgSlug: string): Promise<MissingRepo[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await prisma.repository.findMany({
    where: { orgId, watched: true, missingSince: { not: null } },
    select: { owner: true, name: true, fullName: true, url: true, missingSince: true },
    orderBy: { missingSince: "asc" },
  });
  return rows.map((r) => ({
    owner: r.owner,
    name: r.name,
    fullName: r.fullName,
    url: r.url,
    missingSince: (r.missingSince as Date).toISOString(),
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
