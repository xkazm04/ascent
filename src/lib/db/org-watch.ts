// Enterprise org layer: watchlist + scan scheduling. All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { segmentScope } from "@/lib/db/org-shared";
// The ONE sentinel, from the dependency-free leaf that exists to stop it being re-typed per site.
import { PUBLIC_ORG } from "@/lib/org-constants";
import { withAuditSignature } from "@/lib/db/audit-integrity";
import { writeConformanceReport } from "@/lib/db/org-conformance";
import type { CheckLevel } from "@/lib/standard/check-ids";
import type { Schedule } from "@/lib/org/repo-schedule";
import { forgeFromWebUrl } from "@/lib/forge/registry";

// Keyed on the canonical Schedule vocabulary (installationRepoTypes) so the cadence set can't drift
// from the route validators / UI options — a missing or extra key is a compile error here.
const SCHEDULE_DAYS: Record<Schedule, number> = { off: 0, daily: 1, weekly: 7, monthly: 30 };

/**
 * The next autoscan slot for a cadence, or null for "off"/unknown (which is also the "not claimable"
 * signal — see claimRescan).
 *
 * "monthly" is CALENDAR arithmetic (same day-of-month next month), not a flat 30 days: a flat 30-day
 * step walks the scan date backwards through the calendar (the 31st → the 30th → the 29th …), so a
 * "monthly" report drifts off its slot and, over a year, fires 12.2 times instead of 12. Day-of-month
 * overflow clamps to the last day of the target month (Jan 31 → Feb 28/29), which is the same rule
 * users expect from every other monthly scheduler. `daily`/`weekly` stay exact-duration steps — DST
 * shifting a scan by an hour is irrelevant, and a fixed step is the cheaper, more predictable rule.
 *
 * This is the raw ONE-STEP function: it advances exactly one cadence from `from`. Callers that are
 * settling a repo go through {@link nextSlotFrom}, which anchors that step on the repo's INTENDED slot
 * (`Repository.scanSlotAt`) rather than on the wall clock — see G3-13 there.
 */
function nextScanFor(schedule: string, from: number = Date.now()): Date | null {
  // schedule arrives as a free string from the API; an unknown value falls through to 0 ("off").
  const d = SCHEDULE_DAYS[schedule as Schedule] ?? 0;
  if (d <= 0) return null;
  if (schedule === "monthly") {
    const next = new Date(from);
    const day = next.getUTCDate();
    next.setUTCDate(1); // step the month with no overflow into the month after next (e.g. Jan 31 + 1mo)
    next.setUTCMonth(next.getUTCMonth() + 1);
    // Clamp to the target month's length: day 0 of the FOLLOWING month is its last day.
    const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, daysInMonth));
    return next;
  }
  return new Date(from + d * 86_400_000);
}

/** Bound on the catch-up loop in {@link nextSlotFrom}. Generous (a `daily` repo dormant for ~27 years)
 *  but finite, so a pathological anchor can never spin the settle call forever. */
const MAX_SLOT_CATCHUP_STEPS = 10_000;

/**
 * The next autoscan slot, ANCHORED ON THE INTENDED ONE (G3-13).
 *
 * THE BUG THIS FIXES. `nextScanAt` is dual-purpose: it is the schedule, but {@link claimRescan} also
 * overwrites it with a 15-minute LEASE before the scan runs. So by the time {@link advanceToFullCadence}
 * settles the repo, the intended slot has already been destroyed and the old code computed the next one
 * from `Date.now()` — which is the moment the scan FINISHED, i.e. the intended slot plus the cron's
 * queue delay plus the scan's duration. That delta was added permanently, every single run, so a
 * "daily" repo scanned at 03:00 crept to 03:04, then 03:09, and a "weekly" one eventually changed
 * weekday. `Repository.scanSlotAt` is the separate persisted anchor that makes the intended slot
 * survive the lease.
 *
 * CATCH-UP, NOT BACKLOG. If the anchor is already in the past — the cron was down for a week, the repo
 * was paused — one step forward would schedule a slot in the past, and the repo would re-qualify
 * instantly and re-scan in a loop until it caught up, billing every intermediate step. So the slot is
 * stepped forward until it is genuinely in the future: missed occurrences are SKIPPED, and the repo
 * lands back on its original phase (03:00, or its day-of-month) instead of being re-phased to whenever
 * the outage ended.
 *
 * `anchor === null` is the legacy/never-anchored row: fall back to now-anchoring, which is exactly the
 * pre-migration behavior. The caller then stamps the anchor, so the row self-heals from its next cycle.
 * Returns null for an "off"/unknown schedule. Pure — the clock is an argument, so it is unit-testable.
 */
export function nextSlotFrom(schedule: string, anchor: Date | null, now: number = Date.now()): Date | null {
  const anchorMs = anchor && Number.isFinite(anchor.getTime()) ? anchor.getTime() : null;
  let slot = nextScanFor(schedule, anchorMs ?? now);
  if (!slot) return null;
  for (let i = 0; slot.getTime() <= now && i < MAX_SLOT_CATCHUP_STEPS; i++) {
    const stepped = nextScanFor(schedule, slot.getTime());
    // Defensive: a non-advancing step would loop forever on the guard alone. Can't happen for the
    // current cadences (every one is strictly increasing), but the settle path must not be able to hang.
    if (!stepped || stepped.getTime() <= slot.getTime()) break;
    slot = stepped;
  }
  return slot;
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
  // The funnel org carries BOTH halves of its identity, not just the name. `kind: "public"` is the
  // column the LLM usage ledger's skip decision actually reads (usage-events.ts UNMETERED_ORG_KIND,
  // UAT MC-B20: that decision used to be `orgSlug === "public"` as a string, and was moved onto the
  // ROW precisely so a slug could not stand in for a property of the org). `Organization.kind`
  // defaults to "org", so an unstamped funnel row is METERED — and this writer already knew the slug
  // was special enough to rename, which made it the one place that created that row half-formed.
  //
  // Six writers can materialize an Organization; ensureOrgId (scans-shared.ts, RC3-N1) stamps on
  // create AND repairs an existing row. The REPAIR deliberately stays there: it is the hot path
  // every scan goes through, so duplicating an updateMany here would add a write to every watch
  // toggle to fix a row the next scan fixes anyway. What this writer owes is not creating the
  // problem — a repo watched under the funnel before anything is scanned used to leave the org
  // flavored "org", and everything until the next scan was ledgered as a tenant's usage.
  const funnel = slug === PUBLIC_ORG;
  return getPrisma().organization.upsert({
    where: { slug },
    update: {},
    // Plan is the canonical platform default ("free") — billing owns upgrades. This path used to
    // mint the legacy non-PlanId string "private" (which planFeatures resolved to the free tier
    // anyway); aligned with installations.ts/members.ts so first-touch order can't change the
    // stored plan (github-app-installation-webhooks #1).
    create: { slug, name: funnel ? "Public Scans" : slug, plan: "free", ...(funnel ? { kind: PUBLIC_ORG } : {}) },
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
      // #4 — the forge this row lives on, inferred from the url the lister gave us. Anything not
      // positively identified persists as `github`, which is what the schema defaults to and what
      // every pre-#4 row already is.
      forge: forgeFromWebUrl(repo.url),
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
  // Setting a cadence (re)PHASES the repo: the slot the user just chose becomes both the next scan and
  // the anchor every later settle steps from. `off` clears both.
  const slot = nextScanFor(schedule);
  await prisma.repository.updateMany({
    where: { orgId, fullName },
    data: { scanSchedule: schedule, nextScanAt: slot, scanSlotAt: slot },
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
  const slot = nextScanFor(schedule);
  await prisma.repository.updateMany({
    where,
    // Same re-phasing rule as setRepoSchedule: the chosen slot is also the cadence anchor.
    data: { scanSchedule: schedule, nextScanAt: slot, scanSlotAt: slot },
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
        forge: forgeFromWebUrl(r.url), // #4 — see the note on the upsert above.
        owner: r.owner,
        name: r.name,
        fullName: r.fullName,
        url: r.url ?? `https://github.com/${r.fullName}`,
        isPrivate: r.isPrivate ?? false,
        watched: true,
        scanSchedule: "weekly",
        nextScanAt: dueNow,
        // Anchor the cadence on the seeded due time, so the repo's weekly slot is phased to when it was
        // discovered rather than to whenever the first cron happened to pick it up.
        scanSlotAt: dueNow,
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

/**
 * The SEEDER's read (moonshot #10): every repo whose autoscan is due, with no 100-per-pass cap.
 *
 * {@link listDueRescans} caps because it feeds a loop that must finish inside one 300s invocation —
 * past `limit`, the back of a big fleet never got scanned in that pass. The queue changes what the
 * cap is FOR: the seeder writes durable `ScanJob` rows and the drain takes what fits, so a 900-repo
 * org can seed in one pass and drain across as many as it needs. `limit` stays available (a caller
 * that wants a bounded seed can still pass one) but is OPTIONAL, and omitting it means "everything
 * due" rather than "the first hundred".
 *
 * Same due predicate and the same round-robin interleave, so seeding order still spreads across orgs.
 */
export async function listDueRescanCandidates(limit?: number): Promise<DueRescan[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const due = await prisma.repository.findMany({
    where: { watched: true, scanSchedule: { not: "off" }, nextScanAt: { lte: new Date() }, org: { kind: { not: "personal" } } },
    select: { id: true, fullName: true, scanSchedule: true, org: { select: { slug: true } } },
    orderBy: { nextScanAt: "asc" },
    ...(limit ? { take: limit * 4 } : {}),
  });
  const byOrg = new Map<string, DueRescan[]>();
  for (const r of due) {
    const item: DueRescan = { orgSlug: r.org.slug, fullName: r.fullName, repoId: r.id, scanSchedule: r.scanSchedule };
    const q = byOrg.get(item.orgSlug);
    if (q) q.push(item);
    else byOrg.set(item.orgSlug, [item]);
  }
  const queues = [...byOrg.values()];
  const cap = limit ?? due.length;
  const out: DueRescan[] = [];
  for (let i = 0; out.length < cap && queues.some((q) => q.length > 0); i++) {
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
    // ONLY nextScanAt. `scanSlotAt` is deliberately untouched here — the lease is a lock, not a
    // schedule, and preserving the intended slot across it is the entire point of that column (G3-13).
    data: { nextScanAt: new Date(Date.now() + CLAIM_LEASE_MS) },
  });
  return res.count === 1;
}

/**
 * Settle a claimed repo to its FULL next cadence — call after a successful rescan, or a deliberate
 * cadence-relevant skip (out of credits, broken installation), so the repo waits the real cadence
 * rather than re-qualifying after the short {@link claimRescan} lease. A no-op for an off/unknown
 * schedule or when persistence is off. Keyed by repo id, like claimRescan.
 *
 * The slot is computed from the repo's persisted ANCHOR (`scanSlotAt`), not from `Date.now()` — see
 * {@link nextSlotFrom} for why that is the whole fix for G3-13. Both columns are written: `nextScanAt`
 * so the cron re-qualifies the repo at the right time, and `scanSlotAt` so the NEXT settle has an anchor
 * to step from. A row with no anchor yet (every row that existed before the migration) falls back to
 * now-anchoring — identical to the old behavior — and is stamped here, so it self-heals from now on.
 */
export async function advanceToFullCadence(repoId: string, schedule: string): Promise<void> {
  if (!isDbConfigured()) return;
  // Cheap pre-check so an off/unknown schedule still costs no reads at all (the old short-circuit).
  if (!nextScanFor(schedule)) return;
  const prisma = getPrisma();
  const row = await prisma.repository.findUnique({ where: { id: repoId }, select: { scanSlotAt: true } });
  const next = nextSlotFrom(schedule, row?.scanSlotAt ?? null);
  if (!next) return;
  await prisma.repository.update({
    where: { id: repoId },
    data: { nextScanAt: next, scanSlotAt: next },
  });
}

/** Retry backoff after a FAILED autoscan. Critical for queue fairness: the schedule used to advance
 *  only on success, so a persistently-broken repo (revoked token, deleted repo) stayed permanently
 *  due at the front of the oldest-first queue and re-failed every run, crowding out healthy repos.
 *  Pushing nextScanAt a fixed backoff out moves it off the front and retries it on a later cron,
 *  without waiting the full cadence.
 *
 *  Like the claim lease, this writes ONLY `nextScanAt`: a backoff is a retry window, not a re-phasing.
 *  Leaving `scanSlotAt` alone means a repo that fails a few times and then recovers settles back onto
 *  its ORIGINAL slot instead of being permanently re-phased to whenever the failures stopped. */
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
  c: {
    score: number;
    fails: number;
    warns: number;
    headSha?: string | null;
    /** #16 — the run's SHAPE and the per-check findings. All optional: a doctor older than spec
     *  0.3.0 sends none of them, and its report is stored as `summaryOnly` rather than rejected. */
    unchecked?: number;
    scored?: number;
    specVersion?: string | null;
    runShape?: "plain" | "run";
    findings?: { check: string; level: CheckLevel; message?: string }[] | null;
  },
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
  const unchecked = clamp(c.unchecked ?? 0);
  const scored = clamp(c.scored ?? 0);
  const runShape = c.runShape === "run" ? "run" : "plain";
  // ONE transaction for all three writes. The denormalized Repository columns, the per-check ledger
  // and the signed audit row are three views of the same event, and a crash between them would leave
  // a dashboard number with no evidence behind it (or evidence for a number that was never applied).
  const res = await prisma.$transaction(async (tx) => {
    const updated = await tx.repository.updateMany({
      where: { orgId, fullName },
      data: {
        aiConformance: score,
        aiConformanceFails: fails,
        aiConformanceWarns: warns,
        aiConformanceAt: new Date(),
      },
    });
    if (updated.count > 0) {
      await writeConformanceReport(tx, orgId, {
        repoFullName: fullName,
        headSha,
        score,
        fails,
        warns,
        unchecked,
        scored,
        specVersion: c.specVersion ?? null,
        runShape,
        // `undefined` (no key) means the reporter sent no findings at all -> summaryOnly. An empty
        // ARRAY is a different statement (a run that judged nothing) and is stored as such.
        findings: c.findings === undefined ? null : c.findings,
      });
    }
    return updated;
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

/** One repo's autoscan cadence, or null when the row is gone / persistence is off. The queue worker's
 *  settle path needs it: a `ScanJob` carries the repo IDENTITY, and the cadence stays on the
 *  Repository row where the scheduling APIs own it, so it is read rather than copied into the job. */
export async function getRepoSchedule(repoId: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const row = await getPrisma().repository.findUnique({ where: { id: repoId }, select: { scanSchedule: true } });
  return row?.scanSchedule ?? null;
}

/**
 * Set or clear one repo's `missingSince` from a DIRECT observation (moonshot #10's probe lane).
 *
 * `reconcileListedRepos` above can only run for an org whose repos we can LIST, which the App-install
 * funnel never does — so a renamed/archived private repo kept burning a rescan slot forever with
 * nothing to notice it. The probe reads `GET /repos/{o}/{r}` per repo, and a 404 there is exactly the
 * observation this column exists to record. First-sight semantics are preserved: an existing stamp is
 * never overwritten (the flag records when it FIRST went missing), and a repo that reappears is
 * cleared. Never unwatches — cleanup stays an explicit user action, same as the reconcile path.
 */
export async function setRepoMissing(repoId: string, missing: boolean): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  if (!missing) {
    await prisma.repository.updateMany({ where: { id: repoId, missingSince: { not: null } }, data: { missingSince: null } });
    return;
  }
  await prisma.repository.updateMany({ where: { id: repoId, missingSince: null }, data: { missingSince: new Date() } });
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
