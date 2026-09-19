// Fleet-level REWORK signals from each repo's latest scan's prStats blob (W5) — the read behind the
// Debt Ledger's "interest / write-offs / exposure" half. Mirrors org-signals.ts exactly: latest scan
// per repo, num()-guarded blob fields (a pre-W5 blob simply lacks the keys → null, never a fabricated
// 0), analyzed-PR-weighted fleet aggregates. Split into a PURE builder + a thin Prisma wrapper so the
// legacy-blob and weighting discipline are unit-testable without a DB (the buildDeliveryTrend pattern).

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug, segmentScope, techGroupScope } from "@/lib/db/org-shared";
import type { PrStats } from "@/lib/types";

/** One repo's rework row. All rates are 0..100 whole percents, or null = "no sample". */
export interface RepoReworkRow {
  fullName: string;
  name: string;
  analyzed: number;
  merged: number;
  /** % of analyzed PRs titled `Revert…` (W1a) — the write-off rate. Null on a pre-W1a blob. */
  revertRate: number | null;
  /** % of MERGED PRs later reverted by a matched revert in the window (W5) — a LOWER BOUND (renamed
   *  reverts and cross-window reverts escape the matcher). Null under the ≥5 merged floor or on a
   *  pre-W5 blob. */
  reworkRate: number | null;
  /** The same, over AI-involved merged PRs only (W5). Null unless both sample floors hold. */
  aiReworkRate: number | null;
  /** % of merged PRs carrying an AI attribution trailer (W2) — the trailer-GROUNDED exposure. */
  aiTrailerRate: number | null;
  /** % of analyzed PRs with any AI involvement — the broader exposure fallback (always measured). */
  aiInvolvedRate: number;
  /** True when the stored blob carries the W5 rework keys at all. False = the latest scan PREDATES
   *  rework tracking — surface "re-scan to measure", never a zero. */
  measured: boolean;
}

export interface OrgRework {
  repos: number; // repos with PR data
  totalPrs: number;
  /** Repos whose latest blob carries the W5 keys — the "how much of the fleet is measured" denominator. */
  measuredRepos: number;
  /** Analyzed-weighted fleet rates; null when NO repo carries a sample (same discipline as org-signals). */
  avgReworkRate: number | null;
  avgAiReworkRate: number | null;
  avgRevertRate: number | null;
  avgAiTrailerRate: number | null;
  avgAiInvolvedRate: number;
  perRepo: RepoReworkRow[]; // sorted worst rework first; unmeasured rows last
}

/** Latest-scan blob per repo, reduced to what the builder reads. Exported for tests. */
export interface ReworkScanRow {
  fullName: string;
  name: string;
  prStats: string | null;
}

/** A finite number, or null — a drifted/garbage blob field must never enter a weighted mean. */
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Fold latest-scan rows into the fleet rework read. PURE — no Prisma — so the legacy-blob semantics
 * (pre-W5 blob → measured:false + null rates, below-floor W5 blob → measured:true + null rates) and
 * the analyzed-weighting are pinned by unit tests.
 */
export function buildOrgRework(rows: readonly ReworkScanRow[]): OrgRework | null {
  const stats: PrStats[] = [];
  const perRepo: RepoReworkRow[] = [];
  for (const r of rows) {
    if (!r.prStats) continue;
    try {
      const p = JSON.parse(r.prStats) as PrStats;
      if (!((num(p.analyzed) ?? 0) > 0)) continue;
      stats.push(p);
      perRepo.push({
        fullName: r.fullName,
        name: r.name,
        analyzed: p.analyzed,
        merged: num(p.merged) ?? 0,
        revertRate: num(p.revertRate),
        reworkRate: num(p.reworkRate),
        aiReworkRate: num(p.aiReworkRate),
        aiTrailerRate: num(p.aiTrailerRate),
        aiInvolvedRate: num(p.aiInvolvedRate) ?? 0,
        // Key-presence, not value: a W5 blob below the sample floor stores an explicit null (measured,
        // no sample); a pre-W5 blob lacks the key entirely (scan predates rework tracking).
        measured: "reworkRate" in p,
      });
    } catch {
      /* malformed blob — skip, never throw */
    }
  }
  if (!perRepo.length) return null;

  // Worst rework first; "no sample" (null) sorts after every measured rate — absence is not risk 0,
  // and it must not masquerade as the fleet's best row either. Unmeasured (pre-W5) rows go last.
  perRepo.sort(
    (a, b) =>
      Number(b.measured) - Number(a.measured) ||
      (b.reworkRate ?? -1) - (a.reworkRate ?? -1) ||
      (b.revertRate ?? -1) - (a.revertRate ?? -1),
  );

  // Analyzed-PR-weighted fleet rates — identical machinery to getOrgPrSignals: a nullable rate
  // contributes only where present and stays null when NO repo carries it.
  const weightedRate = (pick: (s: PrStats) => number | null): number | null => {
    let wsum = 0;
    let sum = 0;
    for (const s of stats) {
      const v = pick(s);
      if (v == null) continue; // "no sample" — not a measured 0
      wsum += s.analyzed;
      sum += v * s.analyzed;
    }
    return wsum > 0 ? Math.round(sum / wsum) : null;
  };

  return {
    repos: perRepo.length,
    totalPrs: perRepo.reduce((a, r) => a + r.analyzed, 0),
    measuredRepos: perRepo.filter((r) => r.measured).length,
    avgReworkRate: weightedRate((s) => num(s.reworkRate)),
    avgAiReworkRate: weightedRate((s) => num(s.aiReworkRate)),
    avgRevertRate: weightedRate((s) => num(s.revertRate)),
    avgAiTrailerRate: weightedRate((s) => num(s.aiTrailerRate)),
    avgAiInvolvedRate: weightedRate((s) => num(s.aiInvolvedRate)) ?? 0,
    perRepo,
  };
}

/** Fleet rework signals — each repo's latest scan, segment/tech-group scoped like every sibling read.
 *  Null when the DB is off, the org is unknown, or no repo has PR data. */
export async function getOrgRework(
  orgSlug: string,
  segmentId?: string | null,
  techGroupId?: string | null,
): Promise<OrgRework | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
    select: { fullName: true, name: true, scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { prStats: true } } },
  });

  return buildOrgRework(repos.map((r) => ({ fullName: r.fullName, name: r.name, prStats: r.scans[0]?.prStats ?? null })));
}
