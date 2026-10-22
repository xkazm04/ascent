// Playbook lift, read through the latest-scan door (playbooks-0, challenge-2026-10-22e).
//
// The lift used to read EVERY scan of every adopting repo (no bound, no engine filter) to keep two
// points per application - the whole-history transfer the rollups door closed for every org-*.ts
// reader, reopened from a file its guard did not scan. This reads exactly the two scans the pairing
// rule (src/lib/org/playbookLiftModel.ts) needs, in a constant number of statements per round:
//
//   1. each repo's LATEST scan                      (latestScanAtPerRepo, one GROUP BY);
//   2. per application round (at most one application per repo per round):
//      a. a scan-stamped mark's LANDING scan - the latest at-or-before its appliedAt - which moves
//         the boundary back to that scan (one GROUP BY, skipped when the round has none);
//      b. the latest scan STRICTLY before the boundary (scanAtBeforePerRepo, one GROUP BY);
//   3. one pair fetch (atPairs) of those scans, selecting engineProvider and the playbook dimensions
//      only; ties at one instant collapse by the door's TIE RULE (latestFirst).
//
// No scan-column filter is applied to the pick (latestScanAtPerRepo's contract): a mock latest scan is
// fetched and classified "mock-reading", never swapped for an older live scan.

import type { getPrisma } from "@/lib/db/client";
import { atPairs, latestFirst, latestScanAtPerRepo, scanAtBeforePerRepo, type LatestScanAt } from "@/lib/db/org-rollup-latest-scans";
import { classifyPair, type LiftPair, type LiftReading } from "@/lib/org/playbookLiftModel";

type Db = ReturnType<typeof getPrisma>;

export interface LiftApplicationRow {
  /** The adopting repo's id; undefined when the repo is not (or no longer) tracked. */
  repoId: string | undefined;
  /** The playbook's dimension; undefined when the playbook row is gone. */
  dimId: string | undefined;
  appliedAt: Date;
  scanStamped: boolean;
}

const pairKey = (repoId: string, at: Date) => `${repoId}\u0000${at.getTime()}`;

/** Split applications into rounds holding at most one application per repo (so a GROUP BY repoId answers each). */
function rounds(apps: readonly { i: number; repoId: string }[]): { i: number; repoId: string }[][] {
  const out: { i: number; repoId: string }[][] = [];
  const depth = new Map<string, number>();
  for (const a of apps) {
    const k = depth.get(a.repoId) ?? 0;
    depth.set(a.repoId, k + 1);
    (out[k] ??= []).push(a);
  }
  return out;
}

/** One pair per application, in input order. */
export async function readPlaybookLiftPairs(prisma: Db, apps: readonly LiftApplicationRow[]): Promise<LiftPair[]> {
  const tracked = apps.flatMap((a, i) => (a.repoId && a.dimId ? [{ i, repoId: a.repoId }] : []));
  // Untracked: no repo row means no reading on either side; a playbook with no dimension cannot score one.
  const pairs: LiftPair[] = apps.map((a) =>
    a.dimId ? classifyPair(undefined, undefined) : { status: "no-dimension", before: null, after: null, delta: null },
  );
  if (tracked.length === 0) return pairs;

  const repoIds = [...new Set(tracked.map((t) => t.repoId))];
  const latestP = latestScanAtPerRepo(prisma, { OR: repoIds.map((repoId) => ({ repoId })) });
  const boundary = new Map<number, Date>();
  const beforeAt = new Map<number, Date>();
  await Promise.all(
    rounds(tracked).map(async (round) => {
      const stamped = round.filter((t) => apps[t.i]!.scanStamped);
      const landing = stamped.length
        ? await latestScanAtPerRepo(prisma, { OR: stamped.map((t) => ({ repoId: t.repoId, scannedAt: { lte: apps[t.i]!.appliedAt } })) })
        : [];
      const landingAt = new Map(landing.map((l) => [l.repoId, l.scannedAt]));
      for (const t of round) boundary.set(t.i, (apps[t.i]!.scanStamped ? landingAt.get(t.repoId) : undefined) ?? apps[t.i]!.appliedAt);
      const before = await scanAtBeforePerRepo(prisma, round.map((t) => ({ repoId: t.repoId, scannedAt: boundary.get(t.i)! })));
      const beforeByRepo = new Map(before.map((b) => [b.repoId, b.scannedAt]));
      for (const t of round) {
        const at = beforeByRepo.get(t.repoId);
        if (at) beforeAt.set(t.i, at);
      }
    }),
  );
  const latest = await latestP;
  const latestAt = new Map(latest.map((l) => [l.repoId, l.scannedAt]));

  const wanted = new Map<string, LatestScanAt>();
  for (const p of [...latest, ...tracked.flatMap((t) => (beforeAt.has(t.i) ? [{ repoId: t.repoId, scannedAt: beforeAt.get(t.i)! }] : []))]) {
    wanted.set(pairKey(p.repoId, p.scannedAt), p);
  }
  const dims = [...new Set(tracked.map((t) => apps[t.i]!.dimId!))];
  const rows = wanted.size
    ? await prisma.scan.findMany({
        where: atPairs([...wanted.values()]),
        select: { id: true, repoId: true, scannedAt: true, engineProvider: true, dimensions: { where: { dimId: { in: dims } }, select: { dimId: true, score: true } } },
      })
    : [];
  const byPair = new Map<string, (typeof rows)[number]>();
  for (const r of [...rows].sort(latestFirst)) {
    const k = pairKey(r.repoId, r.scannedAt);
    if (!byPair.has(k)) byPair.set(k, r);
  }

  const reading = (repoId: string, at: Date | undefined, dimId: string): LiftReading | undefined => {
    const row = at ? byPair.get(pairKey(repoId, at)) : undefined;
    if (!row) return undefined;
    return { at: row.scannedAt, engineProvider: row.engineProvider ?? null, score: row.dimensions.find((d) => d.dimId === dimId)?.score ?? null };
  };
  for (const t of tracked) {
    const dimId = apps[t.i]!.dimId!;
    const last = latestAt.get(t.repoId);
    const after = last && last.getTime() >= boundary.get(t.i)!.getTime() ? reading(t.repoId, last, dimId) : undefined;
    pairs[t.i] = classifyPair(reading(t.repoId, beforeAt.get(t.i), dimId), after);
  }
  return pairs;
}
