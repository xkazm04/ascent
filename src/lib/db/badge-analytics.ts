// Public README-badge reach analytics (USE-1). One tally row per (repo, embedding host), counted up
// fire-and-forget on each ORIGIN badge GET (src/app/api/badge/[owner]/[repo]/route.ts), read back as
// the "Badge reach" panel on /usage.
//
// DELIBERATELY APPROXIMATE — a lower bound, not true views. README badges are served through GitHub's
// camo image proxy and edge CDNs (the badge route sets s-maxage=600), so the overwhelming majority of
// real impressions are answered from cache and never reach the origin to be counted. The figure is
// useful for *where* badges are embedded and relative trend, not as an exact view count; the panel
// labels it as such. No-op / null when persistence is off, like the rest of src/lib/db.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { PUBLIC_ORG } from "@/lib/org-constants";

// A plausible hostname (labels of [a-z0-9-] joined by dots, optional :port). The referer host is
// attacker-controlled on this unauthenticated endpoint, so anything that isn't hostname-shaped is
// bucketed into a single "other" row rather than minting a fresh, arbitrary row per forged value.
const HOST_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/;
// Hard ceiling on DISTINCT hosts tallied per repo. Real embeds concentrate on a handful of hosts
// (github.com, gitlab.com, a few docs sites); past this cap, further NEW hosts fold into "other" so a
// forged-referer flood can't grow the table without bound. The panel is documented as a lower bound.
const MAX_HOSTS_PER_REPO = 50;

/** Best-effort: bump the (repo, host) tally. Swallows every error — analytics must never break a badge. */
export async function recordBadgeImpression(repoFullName: string, refererHost: string): Promise<void> {
  if (!isDbConfigured()) return;
  const repo = repoFullName.toLowerCase().slice(0, 200);
  if (!repo.includes("/")) return;
  const raw = (refererHost || "").toLowerCase().trim().slice(0, 100);
  // Normalize: empty → the "direct" sentinel; non-hostname junk → a single "other" bucket.
  const host = raw === "" ? "direct" : HOST_RE.test(raw) ? raw : "other";
  try {
    const prisma = getPrisma();
    // Cap distinct hosts per repo: if this exact (repo,host) pair is NEW and the repo already carries
    // MAX_HOSTS_PER_REPO rows, funnel the impression into the shared "other" bucket instead of creating
    // yet another row. Bounds row growth per repo against a forged-Referer flood while still counting it.
    let bucketHost = host;
    if (host !== "other") {
      const exists = await prisma.badgeImpression.findUnique({
        where: { repoFullName_refererHost: { repoFullName: repo, refererHost: host } },
        select: { repoFullName: true },
      });
      if (!exists && (await prisma.badgeImpression.count({ where: { repoFullName: repo } })) >= MAX_HOSTS_PER_REPO) {
        bucketHost = "other";
      }
    }
    await prisma.badgeImpression.upsert({
      where: { repoFullName_refererHost: { repoFullName: repo, refererHost: bucketHost } },
      update: { count: { increment: 1 }, lastSeen: new Date() },
      create: { repoFullName: repo, refererHost: bucketHost, count: 1 },
    });
  } catch {
    /* best-effort tally — never surface to the public badge path */
  }
}

export interface BadgeReach {
  /** Total counted origin impressions (lower bound — see module note). */
  totalImpressions: number;
  /** Distinct embedding hosts and distinct embedded repos seen. */
  distinctHosts: number;
  distinctRepos: number;
  topHosts: { host: string; impressions: number }[];
  topRepos: { fullName: string; impressions: number }[];
}

/**
 * Badge reach for an org. The shared public org aggregates ALL embeds; any other org aggregates the
 * embeds whose repo is owned by that org (`<slug>/…`) — badges only ever resolve for public repos
 * (the route serves a neutral "private" badge otherwise), so owner-prefix is the right "your badges"
 * scope. Returns null when persistence is off. All aggregation runs DB-side (groupBy), so it scales
 * with the number of distinct (repo,host) pairs rather than raw GETs.
 */
export async function getBadgeReach(orgSlug: string): Promise<BadgeReach | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const where =
    orgSlug.toLowerCase() === PUBLIC_ORG ? {} : { repoFullName: { startsWith: `${orgSlug.toLowerCase()}/` } };

  const [total, hostGroups, repoGroups] = await Promise.all([
    prisma.badgeImpression.aggregate({ where, _sum: { count: true } }),
    prisma.badgeImpression.groupBy({
      by: ["refererHost"],
      where,
      _sum: { count: true },
      orderBy: { _sum: { count: "desc" } },
      take: 6,
    }),
    prisma.badgeImpression.groupBy({
      by: ["repoFullName"],
      where,
      _sum: { count: true },
      orderBy: { _sum: { count: "desc" } },
      take: 6,
    }),
  ]);

  // Distinct counts: cheap distinct scans (bounded by host/repo cardinality, not raw GETs).
  const [hosts, repos] = await Promise.all([
    prisma.badgeImpression.findMany({ where, distinct: ["refererHost"], select: { refererHost: true } }),
    prisma.badgeImpression.findMany({ where, distinct: ["repoFullName"], select: { repoFullName: true } }),
  ]);

  return {
    totalImpressions: total._sum.count ?? 0,
    distinctHosts: hosts.length,
    distinctRepos: repos.length,
    topHosts: hostGroups.map((g) => ({ host: g.refererHost, impressions: g._sum.count ?? 0 })),
    topRepos: repoGroups.map((g) => ({ fullName: g.repoFullName, impressions: g._sum.count ?? 0 })),
  };
}
