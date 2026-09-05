// The unit-economics read (W3a): agent attempts joined to merged AI-attributed changes, at the only
// granularity where both sides are counted rather than guessed — repo × period.
//
// This is the thin orchestrator over the two pure halves: `getAgentAttempts` (AgentSession rows) and
// the merged-change denominator (AiChange rows). Kept out of agent-sessions.ts so that module stays
// a single-table concern and this one owns the join.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { buildUnitEconomics, getAgentAttempts, type AttemptRollup, type UnitEconomics } from "@/lib/db/agent-sessions";

export interface UnitEconomicsView {
  rollup: AttemptRollup;
  rows: UnitEconomics[];
  /** Fleet-wide, over repos that have BOTH sides — see the honesty note below. */
  fleet: {
    sessions: number;
    producedCode: number;
    producedRate: number | null;
    costCents: number;
    /** Cost ÷ sessions that produced code. Null when none did. */
    costPerProducingSession: number | null;
    /** Cost ÷ merged AI changes, over repos that had at least one. Null when no repo had one. */
    costPerMergedAiChange: number | null;
    mergedAiChanges: number;
    /** Repos with attempts but NO merged AI change — excluded from the ratio, and counted so the UI can say so. */
    reposWithoutDenominator: number;
  };
}

/**
 * Merged AI-attributed changes per repo (lower-cased full name) over the window — the denominator.
 * Counted from `AiChange`, the same population the evidence pack reports, so the ROI arithmetic and
 * the audit artifact can never disagree about how many AI changes shipped.
 */
async function mergedAiChangesByRepo(orgId: string, window: { start: Date | null; end: Date | null }): Promise<Map<string, number>> {
  const mergedAt: { gte?: Date; lte?: Date } = {};
  if (window.start) mergedAt.gte = window.start;
  if (window.end) mergedAt.lte = window.end;

  const rows = await getPrisma().aiChange.findMany({
    where: {
      orgId,
      state: "MERGED",
      ...(mergedAt.gte || mergedAt.lte ? { mergedAt } : { mergedAt: { not: null } }),
    },
    select: { repo: { select: { fullName: true } } },
  });

  const out = new Map<string, number>();
  for (const r of rows) {
    const k = r.repo.fullName.toLowerCase();
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/**
 * The unit-economics view for `orgSlug` over the window. Null when there is no DB / no org; a
 * present-but-empty view (no sessions) is a real answer and renders as "no attempts recorded".
 *
 * FLEET RATIO HONESTY. `costPerMergedAiChange` sums cost and merged changes over repos that have at
 * least one merged AI change, and reports how many repos were EXCLUDED for having none. Including a
 * repo's spend with a zero denominator would silently inflate the fleet figure toward infinity;
 * dropping those repos without saying so would understate what the org actually spent. The number
 * and its exclusion count travel together.
 */
export async function getUnitEconomics(
  orgSlug: string,
  window: { start: Date | null; end: Date | null },
): Promise<UnitEconomicsView | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const [rollup, merged] = await Promise.all([getAgentAttempts(orgSlug, window), mergedAiChangesByRepo(org.id, window)]);
  if (!rollup) return null;

  const rows = buildUnitEconomics(rollup, merged);
  const withDenominator = rows.filter((r) => r.mergedAiChanges > 0);
  const costWithDenominator = withDenominator.reduce((n, r) => n + r.costCents, 0);
  const mergedTotal = withDenominator.reduce((n, r) => n + r.mergedAiChanges, 0);
  const t = rollup.totals;

  return {
    rollup,
    rows,
    fleet: {
      sessions: t.sessions,
      producedCode: t.producedCode,
      producedRate: t.sessions > 0 ? Math.round((t.producedCode / t.sessions) * 100) : null,
      costCents: t.costCents,
      costPerProducingSession: t.producedCode > 0 ? Math.round(t.costCents / t.producedCode) : null,
      costPerMergedAiChange: mergedTotal > 0 ? Math.round(costWithDenominator / mergedTotal) : null,
      mergedAiChanges: mergedTotal,
      reposWithoutDenominator: rows.length - withDenominator.length,
    },
  };
}
