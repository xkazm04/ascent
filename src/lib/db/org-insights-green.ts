// ONE REPO'S LATEST DIMENSION SCORES — the read behind the loop's GREEN RESERVATION.
//
// A separate module, and a deliberately narrow one. `getOrgRollup` already produces this for the
// whole fleet, but the reservation is asked once per lane about one repository, and pulling every
// repo's latest scan to answer it would put a fleet-wide aggregate on the dispatch path. Everything
// else here is the same shape `org-insights-craft.ts` uses: org-scoped, latest scan only, and an
// empty answer on every degradation rather than a guess.
//
// EMPTY IS NOT GREEN. `isReservationGreen` (src/lib/local/lane-reservation.ts) reads a zero-length
// dimension list as "unscanned", which is not green — so a missing database, a missing org, a
// missing repo or a scan with no dimensions all land the lane on the gaps-only path it had before
// the reservation existed. That is the correct failure direction: the reservation spends a lane's
// slots on optional work, and it must never do that on an absence of evidence.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";

/** What `repoGreenness` needs per dimension. `signalScore`/`llmScore` ride along because the
 *  predicate's contested test reads them; a row missing either is simply never contested. */
export interface LatestDimScore {
  dimId: string;
  score: number;
  signalScore?: number;
  llmScore?: number;
}

/**
 * The repo's LATEST scan's dimension scores, or `[]` when there is no answer.
 *
 * The latest scan, deliberately, not the latest GitHub-side one — the same window
 * `getLatestUnmeasurableDims` reads, so the scores and the "which of these could not be measured"
 * list that is held out of them describe the same reading.
 */
export async function getLatestRepoDimScores(orgSlug: string, repoFullName: string): Promise<LatestDimScore[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId: org.id, fullName: repoFullName } },
    select: { id: true },
  });
  if (!repo) return [];
  const scan = await prisma.scan.findFirst({
    where: { repoId: repo.id },
    // Same tie-break chain the lane's own "latest scan" reads use: `scannedAt` is not unique, and a
    // bare desc sort would answer about a different scan than the one the lane bracketed against.
    orderBy: [{ scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { dimensions: { select: { dimId: true, score: true, signalScore: true, llmScore: true } } },
  });
  return scan?.dimensions ?? [];
}
