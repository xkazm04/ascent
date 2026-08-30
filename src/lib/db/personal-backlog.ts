// Personal backlog — the individual tier's overlay on shared public-corpus recommendations
// (decision 3). A public repo's recommendations live on its latest scan in the shared "public" org;
// their status/assignee columns are a SHARED surface that a personal workspace must never mutate.
// Instead each viewer keeps sparse RecommendationOverlay rows under their PERSONAL org, keyed by the
// recommendation's STABLE identity (repoFullName + dimId + title — the same key matchRecommendations
// carries status across re-scans with), and reads merge the two at render time. Shared status is
// neither read nor written here: the personal view starts every item at "open" and reflects only the
// viewer's own standing, so one org's internal tracking never leaks into (or gets clobbered by) an
// individual's workspace.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { PUBLIC_ORG } from "@/lib/org-constants";
import { REC_STATUSES, type RecStatus } from "@/lib/types";

export interface PersonalBacklogItem {
  repoFullName: string;
  dimId: string;
  title: string;
  impact: string;
  effort: string;
  levelUnlock: string | null;
  /** The VIEWER's standing — overlay status, or "open" when untouched. Never the shared column. */
  status: RecStatus;
  /** Personal due date (ISO YYYY-MM-DD), or null. */
  targetDate: string | null;
  note: string;
}

export interface PersonalBacklogRepo {
  fullName: string;
  owner: string;
  name: string;
  /** ISO of the scan the items came from (the repo's latest public scan). */
  scannedAt: string;
  items: PersonalBacklogItem[];
}

export interface PersonalBacklog {
  repos: PersonalBacklogRepo[];
  /** Items across all repos, by the viewer's status. */
  counts: Record<RecStatus, number>;
  total: number;
}

export class OverlayRepoNotWatchedError extends Error {
  constructor(fullName: string) {
    super(`${fullName} is not on this watchlist.`);
    this.name = "OverlayRepoNotWatchedError";
  }
}

function isRecStatus(v: unknown): v is RecStatus {
  return typeof v === "string" && (REC_STATUSES as string[]).includes(v);
}

/**
 * The personal backlog read: each watched repo's latest PUBLIC-corpus scan recommendations, merged
 * with the viewer's overlay rows. Returns null when the DB is off or the personal org doesn't exist.
 * Deliberately unclamped by retention: this is the repo's CURRENT public report state, not history.
 */
export async function getPersonalBacklog(personalSlug: string): Promise<PersonalBacklog | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: personalSlug.trim().toLowerCase() },
    select: { id: true },
  });
  if (!org) return null;

  const watched = await prisma.repository.findMany({
    where: { orgId: org.id, watched: true },
    select: { fullName: true },
    orderBy: { fullName: "asc" },
  });
  const empty: PersonalBacklog = {
    repos: [],
    counts: { open: 0, in_progress: 0, done: 0, dismissed: 0 },
    total: 0,
  };
  if (watched.length === 0) return empty;

  const pub = await prisma.organization.findUnique({ where: { slug: PUBLIC_ORG }, select: { id: true } });
  if (!pub) return empty;

  const [repos, overlays] = await Promise.all([
    prisma.repository.findMany({
      where: { orgId: pub.id, fullName: { in: watched.map((w) => w.fullName) } },
      select: {
        fullName: true,
        owner: true,
        name: true,
        scans: {
          orderBy: { scannedAt: "desc" },
          take: 1,
          select: {
            scannedAt: true,
            recommendations: {
              // `kind: "gap"` by construction — the personal backlog is a debt surface like the org
              // one, and a craft entry is not debt (r12). Craft is read only through
              // org-insights-craft.ts.
              where: { kind: "gap" },
              orderBy: { createdAt: "asc" },
              select: { dimId: true, title: true, impact: true, effort: true, levelUnlock: true },
            },
          },
        },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.recommendationOverlay.findMany({
      where: { orgId: org.id },
      select: { repoFullName: true, dimId: true, title: true, status: true, targetDate: true, note: true },
    }),
  ]);

  const overlayKey = (repo: string, dimId: string, title: string) => `${repo}\0${dimId}\0${title}`;
  const byKey = new Map(overlays.map((o) => [overlayKey(o.repoFullName, o.dimId, o.title), o]));

  const counts: Record<RecStatus, number> = { open: 0, in_progress: 0, done: 0, dismissed: 0 };
  const out: PersonalBacklogRepo[] = [];
  for (const r of repos) {
    const scan = r.scans[0];
    if (!scan || scan.recommendations.length === 0) continue;
    const items = scan.recommendations.map((rec): PersonalBacklogItem => {
      const o = byKey.get(overlayKey(r.fullName, rec.dimId, rec.title));
      const status: RecStatus = o && isRecStatus(o.status) ? o.status : "open";
      counts[status] += 1;
      return {
        repoFullName: r.fullName,
        dimId: rec.dimId,
        title: rec.title,
        impact: rec.impact,
        effort: rec.effort,
        levelUnlock: rec.levelUnlock ?? null,
        status,
        targetDate: o?.targetDate ? o.targetDate.toISOString().slice(0, 10) : null,
        note: o?.note ?? "",
      };
    });
    out.push({
      fullName: r.fullName,
      owner: r.owner,
      name: r.name,
      scannedAt: scan.scannedAt.toISOString(),
      items,
    });
  }
  return { repos: out, counts, total: counts.open + counts.in_progress + counts.done + counts.dismissed };
}

/**
 * Upsert the viewer's overlay on one recommendation. Guarded to WATCHED repos so overlays can't
 * accumulate for repos outside the workspace (throws OverlayRepoNotWatchedError otherwise — the API
 * maps it to a 404). Undefined patch fields leave the stored value untouched; status is validated
 * against the RecStatus vocabulary. Returns the stored row's merged view.
 */
export async function setPersonalOverlay(
  personalSlug: string,
  key: { repoFullName: string; dimId: string; title: string },
  patch: { status?: string; targetDate?: string | null; note?: string },
): Promise<{ status: RecStatus; targetDate: string | null; note: string } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: personalSlug.trim().toLowerCase() },
    select: { id: true },
  });
  if (!org) return null;

  const watched = await prisma.repository.findFirst({
    where: { orgId: org.id, fullName: key.repoFullName, watched: true },
    select: { id: true },
  });
  if (!watched) throw new OverlayRepoNotWatchedError(key.repoFullName);

  const status = patch.status !== undefined && isRecStatus(patch.status) ? patch.status : undefined;
  // targetDate: undefined = untouched, null = clear, "YYYY-MM-DD" = set. Invalid dates are ignored.
  let targetDate: Date | null | undefined;
  if (patch.targetDate === null) targetDate = null;
  else if (typeof patch.targetDate === "string") {
    const t = Date.parse(patch.targetDate);
    if (Number.isFinite(t)) targetDate = new Date(t);
  }
  const note = typeof patch.note === "string" ? patch.note.slice(0, 2000) : undefined;

  const row = await prisma.recommendationOverlay.upsert({
    where: {
      orgId_repoFullName_dimId_title: {
        orgId: org.id,
        repoFullName: key.repoFullName,
        dimId: key.dimId,
        title: key.title,
      },
    },
    update: {
      ...(status !== undefined ? { status } : {}),
      ...(targetDate !== undefined ? { targetDate } : {}),
      ...(note !== undefined ? { note } : {}),
    },
    create: {
      orgId: org.id,
      repoFullName: key.repoFullName,
      dimId: key.dimId,
      title: key.title,
      status: status ?? "open",
      targetDate: targetDate ?? null,
      note: note ?? "",
    },
    select: { status: true, targetDate: true, note: true },
  });
  return {
    status: isRecStatus(row.status) ? row.status : "open",
    targetDate: row.targetDate ? row.targetDate.toISOString().slice(0, 10) : null,
    note: row.note,
  };
}
