// THE CRAFT LADDER'S DB SIDE — the ONLY read path that returns `kind: "craft"` rows.
//
// It is a separate module on purpose. Every other recommendation query in this codebase is a DEBT
// query: the backlog, the nav badge, the personal backlog, the improvement-PR triage and the org
// rollup all filter `kind: "gap"` BY CONSTRUCTION (each says so at its `where`). Craft lives here so
// that "does craft leak into debt?" is answerable by grep rather than by review: if a debt surface is
// counting craft, it is because it imported THIS module, and no debt surface does.
//
// WHAT CRAFT IS. A craft entry is what would make an ALREADY-STRONG dimension exemplary — the next
// rung, not a shortfall. Since r12 it is DISPATCHABLE (the loop's craft lane works it exactly as a
// backlog lane works gaps), which is what stops the improvement loop dying the moment a repository
// reaches green. What r12 did NOT change: craft is never debt, never a badge, never an alert, never
// a gate input, and never any part of a score, a level or a projected gain.
//
// NOTE THE ASYMMETRY THAT MAKES THE LEDGER HONEST. Debt is a number that must be able to reach zero;
// the craft ledger is a number that only ever goes UP. That is the correct shape for work with no
// end: you cannot finish it, so the only truthful metric is how far you have climbed.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { parseStringArray } from "@/lib/db/scans-shared";
import { DIMENSION_BY_ID, isDimensionId } from "@/lib/maturity/model";
import { asCraftAxis, emptyAxisTally, type CraftAxis } from "@/lib/scoring/craft";
import type { CraftBuiltEntry } from "@/lib/llm/provider";
import type { FollowUpItem } from "@/lib/org/followups";
import { normalizeRecTitle } from "@/lib/report/compare";

/** How many craft rungs the prompt's CRAFT ALREADY BUILT block is fed. Newest first. */
const CRAFT_BUILT_LIMIT = 12;

/** How many recent per-item outcomes the claimed-rung read looks back over. A bound, not a policy: a
 *  lane writes one row per dispatched item, so this is roughly the last hundred dispatches — far more
 *  than the twelve titles the block can print, and cheap. */
const CLAIMED_OUTCOME_SCAN = 500;

/** Statuses that mean a craft rung was BUILT. The same vocabulary gaps use, adjudicated by the same
 *  machinery (the `Ascent-Resolves:` trailer via scans-persist) — a craft row is not a second
 *  lifecycle, only a second KIND. */
const BUILT = "done";

/** The org's repo row for `repoFullName`, or null. Kept local so every read here is org-scoped. */
async function repoOf(orgSlug: string, repoFullName: string) {
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  return getPrisma().repository.findUnique({
    where: { orgId_fullName: { orgId: org.id, fullName: repoFullName } },
    select: { id: true, fullName: true },
  });
}

/** The repo's most recent scan id, or null — the same "latest scan" window getOrgBacklog reads. */
async function latestScanId(repoId: string): Promise<string | null> {
  const scan = await getPrisma().scan.findFirst({
    where: { repoId },
    orderBy: { scannedAt: "desc" },
    select: { id: true },
  });
  return scan?.id ?? null;
}

/**
 * The repo's OPEN craft entries on its latest scan, newest-assessment first.
 *
 * Shaped as `FollowUpItem` so the loop's lane machinery — the fix prompt, the batch claim, the
 * `Ascent-Resolves:` trailer, the outcome ledger — works on craft with no second code path. Two
 * fields are deliberately different from a gap item:
 *   • `kind: "craft"`, so every caller can tell what it is holding;
 *   • `projectedPoints: null`, ALWAYS. A craft entry has no projected gain and must never be given
 *     one: pricing craft in score points would be the first step to it entering a score, and there
 *     is no honest number to put there — the dimension is already green.
 */
export async function getCraftItems(
  orgSlug: string,
  repoFullName: string,
  limit = 5,
): Promise<FollowUpItem[]> {
  if (!isDbConfigured()) return [];
  const repo = await repoOf(orgSlug, repoFullName);
  if (!repo) return [];
  const scanId = await latestScanId(repo.id);
  if (!scanId) return [];
  const rows = await getPrisma().recommendation.findMany({
    where: { scanId, kind: "craft", status: "open" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      dimId: true,
      impact: true,
      effort: true,
      rationale: true,
      explore: true,
      craftAxis: true,
    },
  });
  return rows.slice(0, Math.max(1, limit)).map((r) => ({
    id: r.id,
    repo: repo.fullName,
    title: r.title,
    dimId: r.dimId,
    dimLabel: isDimensionId(r.dimId) ? DIMENSION_BY_ID[r.dimId].name : r.dimId,
    impact: r.impact,
    effort: r.effort,
    rationale: r.rationale,
    explore: parseStringArray(r.explore),
    projectedPoints: null,
    kind: "craft" as const,
    craftAxis: asCraftAxis(r.craftAxis),
  }));
}

/** The craft odometer for one repository. `byAxis` always carries all six axes, at zero when unbuilt. */
export interface CraftLedger {
  total: number;
  byAxis: Record<CraftAxis, number>;
  /** Rungs whose axis predates the column (or which the model omitted). Counted in `total`, absent
   *  from `byAxis` — the honest place for "built, axis unknown". */
  unaxised: number;
}

/**
 * THE CRAFT LEDGER — how many craft rungs this repository has BUILT, by axis. The odometer.
 *
 * IT ONLY EVER INCREASES, and that is the point. Craft work has no completion state, so a burn-down
 * would be a lie; the only honest metric for unbounded work is distance travelled. A rung counts once
 * it reaches `done`, which happens through exactly the machinery a gap closes by — the
 * `Ascent-Resolves:` trailer honoured by the next scan (src/lib/org/followups.ts `decideInProgress`
 * / `resolutionNote`, applied in scans-persist.ts) or an explicit human resolve.
 *
 * THIS NUMBER MUST NEVER ENTER A SCORE, A LEVEL, OR A DEBT FIGURE. Not as a bonus, not as a
 * tiebreak, not as a weight, not as an adjustment to a projected gain. The moment craft pays score
 * points, the loop optimises for the odometer instead of the craft, and the reason craft can be
 * proposed freely — that it is never a fault and costs the repository nothing — is gone. It is read
 * by the ladder's own surfaces (the prompt's CRAFT ALREADY BUILT block, the lane's axis-coverage
 * ranking) and by nothing else. `src/lib/db/craft-ledger.score.test.ts` asserts it.
 *
 * Rows are DEDUPED on the recommendation's stable identity (`dimId` + normalized title, the same key
 * `matchRecommendations` carries status across re-scans with), because a rung re-raised by a later
 * assessment and closed again is one rung climbed, not two.
 */
export async function getCraftLedger(orgSlug: string, repoFullName: string): Promise<CraftLedger> {
  const empty: CraftLedger = { total: 0, byAxis: emptyAxisTally(), unaxised: 0 };
  if (!isDbConfigured()) return empty;
  const repo = await repoOf(orgSlug, repoFullName);
  if (!repo) return empty;
  const rows = await getPrisma().recommendation.findMany({
    where: { scan: { repoId: repo.id }, kind: "craft", status: BUILT },
    orderBy: { createdAt: "asc" },
    select: { dimId: true, title: true, craftAxis: true },
  });
  const seen = new Set<string>();
  const out: CraftLedger = { total: 0, byAxis: emptyAxisTally(), unaxised: 0 };
  for (const r of rows) {
    const key = `${r.dimId}::${normalizeRecTitle(r.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.total += 1;
    const axis = asCraftAxis(r.craftAxis);
    if (axis) out.byAxis[axis] += 1;
    else out.unaxised += 1;
  }
  return out;
}

/**
 * The rungs already built, newest first — the prompt's CRAFT ALREADY BUILT block.
 *
 * IT IS DELIBERATELY WIDER THAN THE ODOMETER (2026-09-01), and this is the one place the two reads
 * diverge. `getCraftLedger` counts only `done`, because a number that only ever increases must not
 * count a rung nothing adjudicated. This read also includes a rung an agent CLAIMED — a craft row
 * still `in_progress` whose id a lane recorded a `resolved` outcome for — because the two reads answer
 * different questions and the errors cost different amounts:
 *
 *   • the ledger asks "how far has this repository climbed?", where counting an unbuilt rung inflates
 *     a permanent number;
 *   • this read asks "what should the model NOT propose again?", where OMITTING a built rung is the
 *     expensive mistake. It was measured: 2757 `in_progress` craft rows over 186 titles, one title
 *     re-raised 61 times, and 37 of 136 campaign-5 agent verdicts opening with "Already covered" —
 *     the loop spending sessions to be told it had already done the work
 *     (docs/harness/reflection-2026-09-01.md, finding 5).
 *
 * A claimed-but-unbuilt rung shown here costs one un-proposed rung out of an unbounded supply; the
 * next scan simply proposes the rung above it. Deduped, like the ledger, on the recommendation's
 * stable identity (`dimId` + normalized title), so the 61 copies of one title collapse to one line.
 *
 * Threaded into `LlmScoreInput.craftBuilt` by scan-score-input.ts, exactly beside `orgDecisions`, and
 * rendered into the per-repo USER message (never the cached SYSTEM prefix).
 */
export async function getCraftBuilt(
  orgSlug: string,
  repoFullName: string,
  limit = CRAFT_BUILT_LIMIT,
): Promise<CraftBuiltEntry[]> {
  if (!isDbConfigured()) return [];
  const repo = await repoOf(orgSlug, repoFullName);
  if (!repo) return [];
  const prisma = getPrisma();
  const rows = await prisma.recommendation.findMany({
    where: { scan: { repoId: repo.id }, kind: "craft", status: BUILT },
    orderBy: { createdAt: "desc" },
    select: { dimId: true, title: true, craftAxis: true },
  });
  const claimed = await claimedCraftRows(prisma, repo.id, repoFullName);
  const seen = new Set<string>();
  const out: CraftBuiltEntry[] = [];
  for (const r of [...rows, ...claimed]) {
    const key = `${r.dimId}::${normalizeRecTitle(r.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: r.title, dimId: r.dimId, axis: asCraftAxis(r.craftAxis) });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Craft rows a lane recorded a `resolved` outcome for and that never reached `done` — the claimed
 * pile `getCraftBuilt` reads and `getCraftLedger` does not. Best-effort: this read is an improvement
 * on the built list, so a failure returns nothing rather than costing the caller the `done` rows.
 *
 * Bounded to the outcomes of THIS repository (`LaneItemOutcome.repoFullName`) and then to craft rows
 * on this repository's own scans, so neither side can reach across a repo or a tenant.
 */
async function claimedCraftRows(
  prisma: ReturnType<typeof getPrisma>,
  repoId: string,
  repoFullName: string,
): Promise<{ dimId: string; title: string; craftAxis: string | null }[]> {
  try {
    const outcomes = await prisma.laneItemOutcome.findMany({
      where: { repoFullName, verdict: "resolved" },
      orderBy: { createdAt: "desc" },
      select: { recommendationId: true },
      take: CLAIMED_OUTCOME_SCAN,
    });
    const ids = [...new Set(outcomes.map((o) => o.recommendationId))];
    if (ids.length === 0) return [];
    return await prisma.recommendation.findMany({
      where: { id: { in: ids }, kind: "craft", scan: { repoId } },
      orderBy: { createdAt: "desc" },
      select: { dimId: true, title: true, craftAxis: true },
    });
  } catch {
    return [];
  }
}
