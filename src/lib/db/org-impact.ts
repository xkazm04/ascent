// The Impact Ledger (W1d) — what the improvement loop actually DELIVERED in a period.
//
// The loop (src/lib/db/improvement.ts) already carries an accepted direction all the way through
// PR → merge → post-merge rescan → measured impact, and stores the bookends on the ImprovementPr row
// (`impactDim` = the targeted dimension's delta, `impactOverall` = the repo's overall delta, both
// first-post-merge-scan vs the baseline scan taken when the PR opened). Until W1 those numbers were
// rendered only inside the war room, one row at a time. This module aggregates them into the answer
// to the fourth question the rail now asks: **what did the last period buy us?**
//
// HONESTY DISCIPLINE — the whole point of the ledger, and the same null-discipline as the Debt Ledger:
//
//   1. VERIFIED ONLY. A merged PR with no post-merge rescan contributes NOTHING to the point totals.
//      It is counted and named as "awaiting rescan" instead. A projection is not a purchase.
//   2. NO ZERO FOR "NOT MEASURED". With nothing verified, `dimPoints` is null, not 0 — "we delivered
//      0 points" and "we haven't measured yet" are different statements and the UI must not conflate
//      them.
//   3. SIGN-AWARE, NEVER NETTED AWAY. A verified change can move a dimension DOWN. `regressions`
//      counts those separately so a negative row can't hide inside a positive total (UAT DANA-L1-010:
//      do not print a regression under a heading that says "value").
//   4. NO CROSS-REPO OVERALL SUM. `impactOverall` is one repo's overall score delta; adding those
//      across repos would produce a number with no referent. It is reported PER ROW only. The fleet
//      total is stated in DIMENSION points, which is what each PR was actually aimed at.
//
// Pure `buildImpactLedger` + thin `getOrgImpactLedger` — the same db-facts / pure-assembly split as
// nav-counts.ts and getting-started.ts, so every rule above is unit-testable without a database.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { PRACTICES } from "@/lib/practices";

/** One merged loop PR, as the ledger sees it. */
export interface ImpactRow {
  repoFullName: string;
  repoName: string;
  dimId: string;
  practiceId: string;
  practiceLabel: string;
  prNumber: number;
  prUrl: string;
  mergedAt: string;
  /** The targeted dimension's delta. Null = no baseline scan (repo accepted before its first scan). */
  impactDim: number | null;
  /** This repo's overall delta. Reported per row only — never summed across repos (rule 4). */
  impactOverall: number | null;
  /** The post-merge rescan has landed. Only these contribute to the totals. */
  verified: boolean;
}

/** Per-dimension roll-up of verified movement. */
export interface ImpactByDim {
  dimId: string;
  /** Sum of `impactDim` over verified rows targeting this dimension. Sign-aware. */
  points: number;
  /** Verified PRs backing that number. */
  prs: number;
}

export interface ImpactLedger {
  /** Merged in the window, whatever their verification state. */
  mergedCount: number;
  /** Of those, the post-merge rescan has landed. */
  verifiedCount: number;
  /** Merged but not yet re-scanned — named, never silently dropped or counted as zero. */
  awaitingRescan: number;
  /** Verified but with no baseline to compare against, so measurable for neither total (rule 2). */
  unmeasurable: number;
  /** Distinct repos with at least one verified row. */
  reposMoved: number;
  /** Total verified dimension points. NULL when nothing is verified — never 0 (rule 2). */
  dimPoints: number | null;
  /** Verified rows whose targeted dimension moved DOWN. Surfaced separately (rule 3). */
  regressions: number;
  /** Biggest lift first. */
  byDim: ImpactByDim[];
  /** Newest merge first. */
  rows: ImpactRow[];
}

const PRACTICE_LABEL = new Map(PRACTICES.map((p) => [p.id, p.label]));

/** The raw shape the builder needs — exactly the ImprovementPr columns the ledger reads. */
export interface ImpactPrInput {
  repoFullName: string;
  dimId: string;
  practiceId: string;
  prNumber: number;
  prUrl: string;
  mergedAt: Date | null;
  impactDim: number | null;
  impactOverall: number | null;
  verifiedScanId: string | null;
}

/**
 * Fold merged loop PRs into the ledger. Pure.
 *
 * `verified` is `verifiedScanId != null` — the post-merge scan actually landed. A row can be verified
 * and still carry a null `impactDim` (no baseline), which is why `unmeasurable` exists: it is neither
 * a contribution nor an omission, it is a disclosed limit.
 */
export function buildImpactLedger(prs: ImpactPrInput[]): ImpactLedger {
  const rows: ImpactRow[] = prs
    .filter((p) => p.mergedAt != null)
    .sort((a, b) => (b.mergedAt as Date).getTime() - (a.mergedAt as Date).getTime())
    .map((p) => ({
      repoFullName: p.repoFullName,
      repoName: p.repoFullName.split("/").pop() ?? p.repoFullName,
      dimId: p.dimId,
      practiceId: p.practiceId,
      practiceLabel: PRACTICE_LABEL.get(p.practiceId) ?? p.practiceId,
      prNumber: p.prNumber,
      prUrl: p.prUrl,
      mergedAt: (p.mergedAt as Date).toISOString(),
      impactDim: p.impactDim,
      impactOverall: p.impactOverall,
      verified: p.verifiedScanId != null,
    }));

  const verified = rows.filter((r) => r.verified);
  const measured = verified.filter((r) => r.impactDim != null);

  const byDimMap = new Map<string, ImpactByDim>();
  for (const r of measured) {
    const entry = byDimMap.get(r.dimId) ?? { dimId: r.dimId, points: 0, prs: 0 };
    entry.points += r.impactDim as number;
    entry.prs += 1;
    byDimMap.set(r.dimId, entry);
  }

  return {
    mergedCount: rows.length,
    verifiedCount: verified.length,
    awaitingRescan: rows.length - verified.length,
    unmeasurable: verified.length - measured.length,
    reposMoved: new Set(verified.map((r) => r.repoFullName)).size,
    // Null, not 0, when nothing has been measured — the difference between "delivered nothing" and
    // "haven't measured yet" is the entire credibility of this panel.
    dimPoints: measured.length > 0 ? measured.reduce((n, r) => n + (r.impactDim as number), 0) : null,
    regressions: measured.filter((r) => (r.impactDim as number) < 0).length,
    byDim: [...byDimMap.values()].sort((a, b) => b.points - a.points || a.dimId.localeCompare(b.dimId)),
    rows,
  };
}

/**
 * The ledger for `orgSlug` over an optional merge window (the shared org period selector's bounds;
 * both null = all time). Reads only merged rows — an open PR is in flight, not bought.
 */
export async function getOrgImpactLedger(
  orgSlug: string,
  window?: { start: Date | null; end: Date | null },
): Promise<ImpactLedger | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const mergedAt: { gte?: Date; lte?: Date } = {};
  if (window?.start) mergedAt.gte = window.start;
  if (window?.end) mergedAt.lte = window.end;

  const prs = await getPrisma().improvementPr.findMany({
    where: {
      orgId: org.id,
      state: "merged",
      ...(mergedAt.gte || mergedAt.lte ? { mergedAt } : { mergedAt: { not: null } }),
    },
    orderBy: { mergedAt: "desc" },
    select: {
      repoFullName: true,
      dimId: true,
      practiceId: true,
      prNumber: true,
      prUrl: true,
      mergedAt: true,
      impactDim: true,
      impactOverall: true,
      verifiedScanId: true,
    },
  });

  return buildImpactLedger(prs);
}
