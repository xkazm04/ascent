// Memory coverage — the instrument that answers "how much of this fleet does our shared memory
// actually cover, and where is it going stale?"
//
// WHY IT EXISTS: a memory store with 400 rows looks healthy on the list page and can still be blind to
// half the fleet, because rows cluster on the repos someone happens to care about. The list surface
// can only ever show what IS there; it structurally cannot show the absence. So the denominator here
// is EVERY repo the org tracks — not the repos that already have rows.
//
// HONEST ZEROS, stated plainly:
//   • a repo with NO memory at all is a stale repo (lastMemoryAt: null), not an omission;
//   • coveragePct is over ALL tracked repos, so an org with 2 covered repos out of 40 reads 5%, not 100%;
//   • an org with no repos reads 0% over 0 — never a flattering "100% of nothing".
//
// "Fresh" = at least one ACTIVE (non-archived, non-superseded, unexpired) memory whose `namespace` is
// the repo's full name and which was updated within the window. Namespace is the join key because that
// is exactly what the scan feed (src/lib/memory/scan-feed.ts) and a human filing a repo note both set.
//
// DB reads live HERE on purpose (not in src/lib/db/org-memory.ts): this is an instrument over the
// store, not part of its CRUD surface, and keeping it self-contained means the memory data layer keeps
// one job.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { normalizeOrgSlug } from "@/lib/db/org-shared";

/** Default freshness window. 30 days ≈ a monthly scan cadence — a repo scanned monthly that produced
 *  no memory in a month has genuinely gone quiet, which is the signal worth surfacing. */
export const FRESH_WINDOW_DAYS = 30;

export interface StaleRepo {
  fullName: string;
  /** ISO timestamp of the newest ACTIVE memory for this repo, or null when it has never had one. */
  lastMemoryAt: string | null;
}

export interface MemoryCoverage {
  reposWithFreshMemory: number;
  totalTrackedRepos: number;
  /** 0..100, rounded. 0 when the org tracks no repos (an honest zero, never a vacuous 100). */
  coveragePct: number;
  /** Every repo that is NOT fresh, never-covered first, then oldest-memory first. */
  staleRepos: StaleRepo[];
  /** The window the freshness verdict used, echoed so a UI never has to hard-code it. */
  windowDays: number;
}

const empty = (windowDays: number): MemoryCoverage => ({
  reposWithFreshMemory: 0,
  totalTrackedRepos: 0,
  coveragePct: 0,
  staleRepos: [],
  windowDays,
});

/**
 * Pure core: fold the repo list and the per-namespace newest-memory timestamps into the coverage
 * verdict. Split out from the query so the honest-zero math is testable without a database.
 */
export function computeCoverage(
  repoFullNames: string[],
  lastMemoryByNamespace: Map<string, Date>,
  now: Date,
  windowDays: number = FRESH_WINDOW_DAYS,
): MemoryCoverage {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  // De-duplicate defensively: a fullName appearing twice must not inflate the denominator.
  const repos = [...new Set(repoFullNames.filter((n) => typeof n === "string" && n.trim()))];

  let fresh = 0;
  const stale: StaleRepo[] = [];
  for (const fullName of repos) {
    const last = lastMemoryByNamespace.get(fullName) ?? null;
    if (last && last.getTime() >= cutoff) fresh++;
    else stale.push({ fullName, lastMemoryAt: last ? last.toISOString() : null });
  }

  // Never-covered repos first (the loudest gap), then the longest-quiet ones.
  stale.sort((a, b) => {
    if (a.lastMemoryAt === b.lastMemoryAt) return a.fullName.localeCompare(b.fullName);
    if (!a.lastMemoryAt) return -1;
    if (!b.lastMemoryAt) return 1;
    return a.lastMemoryAt.localeCompare(b.lastMemoryAt);
  });

  return {
    reposWithFreshMemory: fresh,
    totalTrackedRepos: repos.length,
    coveragePct: repos.length === 0 ? 0 : Math.round((fresh / repos.length) * 100),
    staleRepos: stale,
    windowDays,
  };
}

/**
 * Coverage for one org. Returns honest zeros (not null) when persistence is off or the slug is
 * unknown, so every caller renders the same shape and a missing DB can never read as full coverage.
 */
export async function getMemoryCoverage(
  orgSlug: string,
  opts: { windowDays?: number; now?: Date } = {},
): Promise<MemoryCoverage> {
  const windowDays = opts.windowDays ?? FRESH_WINDOW_DAYS;
  const now = opts.now ?? new Date();
  if (!isDbConfigured()) return empty(windowDays);

  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: normalizeOrgSlug(orgSlug) },
    select: { id: true },
  });
  if (!org) return empty(windowDays);

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: { fullName: true },
  });
  const names = repos.map((r) => r.fullName);
  if (names.length === 0) return empty(windowDays);

  // One grouped read for the newest ACTIVE memory per namespace — bounded by the number of distinct
  // namespaces, not by the store size, and it can't miss an old row the way a `take` on the raw rows
  // could (which would fabricate "never covered" for a repo that simply has quiet, older memories).
  const grouped = await prisma.orgMemory.groupBy({
    by: ["namespace"],
    where: {
      orgId: org.id,
      archived: false,
      supersededBy: null,
      namespace: { in: names },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    _max: { updatedAt: true },
  });

  const lastByNs = new Map<string, Date>();
  for (const g of grouped) {
    const ns = g.namespace;
    const at = g._max.updatedAt;
    if (ns && at) lastByNs.set(ns, at);
  }

  return computeCoverage(names, lastByNs, now, windowDays);
}
