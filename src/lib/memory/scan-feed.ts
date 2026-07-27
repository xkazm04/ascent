// Auto-feed for Shared Org Memory: the scan pipeline writing what it OBSERVED into the org's memory
// store, without a human retyping it.
//
// THE GAP THIS CLOSES: OrgMemory was authored-only. Every durable fact the platform already computes —
// "this repo regressed", "this repo crossed from L3 into L4", "this gap was closed" — lived in an
// audit row or a Slack push and never reached the store an agent actually reads. So the memory an org
// accumulated was whatever someone remembered to type, while the intelligence the scans produced
// evaporated. These writers are the missing edge.
//
// THE SHAPE OF AN AUTO-FED MEMORY (deliberate, and uniform across all three writers):
//   kind        "episodic"   — every one of these is "what happened, on a date" (memory-kinds.ts).
//   source      "scan-pipeline" — provenance is the anti-poisoning control (design doc §3); a reader
//               must always be able to tell a machine observation from a colleague's claim.
//   confidence  1.0          — these are OBSERVED facts, not inferences. The high band, honestly.
//   namespace   the repo full name — so an auto-fed memory lands in the same bucket a human filing a
//               note about that repo would use, and the coverage instrument can key on it.
//   tags        [repoFullName, eventKind] — the secondary refinement the UI filters on.
//
// TWO CONTRACTS EVERY WRITER HERE HONORS:
//   1. NEVER THROWS. A memory write is decoration on a scan/API call that already succeeded; a failed
//      insert must log and return null, never fail the caller. Same posture as recordMemoryRecall.
//   2. IDEMPOTENT. The scan pipeline re-runs, a PATCH is retried, a user double-clicks "done". An
//      identical event must not stack duplicate rows, or the store degrades into noise precisely
//      where it is fed fastest. Dedup is deterministic (exact content, plus the token-overlap
//      prefilter from consolidation.ts) and scoped to (orgId, namespace) — never cross-tenant.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { levelForScore } from "@/lib/maturity/model";
import { overlapScore } from "@/lib/memory/consolidation";
import { SCAN_PIPELINE_SOURCE } from "@/lib/org/memory-kinds";
import type { RegressionVerdict } from "@/lib/alerts";
import type { MaturityLevel, ScanReport } from "@/lib/types";

// The `source` stamped on every auto-fed memory. Defined in memory-kinds (the client-safe taxonomy
// module) and re-exported here so server callers can keep importing it from the writer.
export { SCAN_PIPELINE_SOURCE };

/** The second tag on each row (the first is the repo), so the store can be filtered by event type. */
export type ScanMemoryEvent = "regression" | "level-change" | "recommendation-closed";

/**
 * Two memories count as the same event at/above this token overlap. Set high on purpose: these lines
 * are machine-generated from a fixed template, so a genuine repeat is ~1.0 while a real second event
 * on the same repo differs in the numbers that carry the meaning. Anything lower would swallow a
 * second, DIFFERENT regression as a duplicate — silently losing the event we most wanted to record.
 */
const DEDUP_OVERLAP = 0.95;

/** How many recent same-namespace auto-fed rows the dedup compares against. Bounds the read regardless
 *  of store size; a duplicate of something older than this is not a duplicate worth suppressing. */
const DEDUP_WINDOW = 25;

const isoDate = (at: Date) => at.toISOString().slice(0, 10);

/**
 * The single write path. Returns the new row's id, `null` when it was deduped, persistence is off, or
 * anything at all went wrong. Warn-only by contract — see the header.
 */
async function writeScanMemory(
  orgId: string,
  repo: string,
  event: ScanMemoryEvent,
  content: string,
): Promise<{ id: string } | null> {
  if (!isDbConfigured() || !orgId || !repo || !content.trim()) return null;
  try {
    const prisma = getPrisma();
    // Dedup candidates: this org, this repo's namespace, our own writes only, still live. Scoping to
    // `source` keeps a human's note about the same regression from suppressing the machine record (and
    // vice versa) — they are different provenance and both deserve to exist.
    const recent = await prisma.orgMemory.findMany({
      where: {
        orgId,
        namespace: repo,
        source: SCAN_PIPELINE_SOURCE,
        archived: false,
        supersededBy: null,
      },
      orderBy: { createdAt: "desc" },
      take: DEDUP_WINDOW,
      select: { id: true, content: true },
    });
    const dup = recent.find(
      (r) => r.content === content || overlapScore(content, r.content) >= DEDUP_OVERLAP,
    );
    if (dup) return null;

    return await prisma.orgMemory.create({
      data: {
        orgId,
        namespace: repo,
        content,
        kind: "episodic",
        visibility: "shared",
        source: SCAN_PIPELINE_SOURCE,
        confidence: 1.0,
        tags: JSON.stringify([repo, event]),
        createdBy: null,
      },
      select: { id: true },
    });
  } catch (err) {
    console.warn(
      `[memory/scan-feed] ${event} memory write failed (caller unaffected)`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ── Regression ───────────────────────────────────────────────────────────────────────────────

export interface RegressionMemoryInput {
  /** The verdict detectRegression produced — used for the severity/reason suffix. May be null. */
  verdict: RegressionVerdict | null;
  overallFrom: number;
  overallTo: number;
}

/**
 * "This repo got worse, here is by how much." Fired from the SAME place scan-finalize dispatches the
 * regression alert, so the memory and the Slack push can never disagree about whether it happened.
 */
export async function recordRegressionMemory(
  orgId: string,
  repo: string,
  input: RegressionMemoryInput,
  at: Date = new Date(),
): Promise<{ id: string } | null> {
  const codes = (input.verdict?.reasons ?? []).map((r) => r.code).join(", ");
  const severity = input.verdict?.severity;
  const suffix = severity ? ` — ${severity}${codes ? `: ${codes}` : ""}` : "";
  const content = `Regression detected on ${repo}: overall ${input.overallFrom}→${input.overallTo} (${isoDate(at)})${suffix}`;
  return writeScanMemory(orgId, repo, "regression", content);
}

// ── Maturity level change ────────────────────────────────────────────────────────────────────

export type LevelDirection = "promotion" | "demotion" | "none";

export interface LevelChange {
  changed: boolean;
  from: MaturityLevel;
  to: MaturityLevel;
  direction: LevelDirection;
}

/**
 * Did a scan cross a LEVELS band edge? Pure, and derived from levelForScore so the band edges are the
 * rubric's (L1 0-24 · L2 25-44 · L3 45-64 · L4 65-84 · L5 85-100) rather than a second copy that could
 * drift when the rubric is retuned. A move WITHIN a band (61 → 47) is not a level change, which is the
 * whole point: the memory records a band crossing, not score jitter.
 */
export function detectLevelChange(prevOverall: number, freshOverall: number): LevelChange {
  const from = levelForScore(prevOverall);
  const to = levelForScore(freshOverall);
  const changed = from.id !== to.id;
  return {
    changed,
    from,
    to,
    direction: !changed ? "none" : freshOverall > prevOverall ? "promotion" : "demotion",
  };
}

/**
 * "This repo changed maturity band." BOTH directions are recorded and the line SAYS which — a
 * promotion is the evidence a program worked, and a memory store that only remembers bad news is a
 * risk register, not a memory.
 */
export async function recordLevelChangeMemory(
  orgId: string,
  repo: string,
  fromLevel: MaturityLevel,
  toLevel: MaturityLevel,
  scores: { from: number; to: number },
  at: Date = new Date(),
): Promise<{ id: string } | null> {
  const promoted = scores.to > scores.from;
  const verb = promoted ? "promoted" : "demoted";
  const content =
    `Maturity ${verb} on ${repo}: ${fromLevel.id} ${fromLevel.name} → ${toLevel.id} ${toLevel.name} ` +
    `(overall ${scores.from}→${scores.to}) (${isoDate(at)})`;
  return writeScanMemory(orgId, repo, "level-change", content);
}

// ── Recommendation closed ────────────────────────────────────────────────────────────────────

/** Statuses that count as "closed" for the memory feed. `dismissed` is deliberately EXCLUDED: it means
 *  "we decided not to do this", which is a different fact from "this gap was closed" and would make
 *  the store read as if work happened that didn't. */
const CLOSED_STATUSES = new Set(["done"]);

export const isClosedRecStatus = (status: string | null | undefined): boolean =>
  CLOSED_STATUSES.has((status ?? "").trim());

/** "A gap was actually closed." The counterweight to the regression feed. */
export async function recordRecommendationClosedMemory(
  orgId: string,
  repo: string,
  rec: { title: string; dimension: string },
  at: Date = new Date(),
): Promise<{ id: string } | null> {
  const title = rec.title.trim().slice(0, 200);
  const content = `Recommendation closed on ${repo}: ${title} (${rec.dimension}) (${isoDate(at)})`;
  return writeScanMemory(orgId, repo, "recommendation-closed", content);
}

/**
 * Route-side adapter: resolve the owning org + repo from a recommendation id (the same
 * Recommendation → Scan → Repository chain updateRecommendation uses for its audit scope) and record
 * the close. Keeps the API route to ONE never-throwing call that needs no extra reads of its own.
 */
export async function recordRecommendationClose(
  recommendationId: string,
  rec: { title: string; dimension: string },
  at: Date = new Date(),
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  try {
    const row = await getPrisma().recommendation.findUnique({
      where: { id: recommendationId },
      select: { scan: { select: { repo: { select: { orgId: true, fullName: true } } } } },
    });
    const repo = row?.scan?.repo;
    if (!repo?.orgId || !repo.fullName) return null;
    return await recordRecommendationClosedMemory(repo.orgId, repo.fullName, rec, at);
  } catch (err) {
    console.warn(
      "[memory/scan-feed] recommendation-close memory failed (API call unaffected)",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ── The scan-finalize aggregate ──────────────────────────────────────────────────────────────

/**
 * The ONE call scan-finalize makes: record whatever this finalized scan observed. Regression and level
 * change are independent (a scan can do both, either, or neither), and the whole thing is
 * never-throwing so the hook site stays a single wrapped line.
 *
 * `regressed` comes from checkAndAlertRegression's outcome rather than being re-derived here, so the
 * memory fires on exactly the same condition the alert did (including the org's own thresholds).
 */
export async function recordScanMemories(
  orgId: string | undefined,
  prev: ScanReport | null,
  fresh: ScanReport,
  outcome: { regressed: boolean; verdict: RegressionVerdict | null },
  at: Date = new Date(),
): Promise<void> {
  if (!orgId || !prev) return;
  const repo = `${fresh.repo.owner}/${fresh.repo.name}`;
  const from = prev.overallScore;
  const to = fresh.overallScore;
  try {
    if (outcome.regressed) {
      await recordRegressionMemory(orgId, repo, { verdict: outcome.verdict, overallFrom: from, overallTo: to }, at);
    }
    const level = detectLevelChange(from, to);
    if (level.changed) {
      await recordLevelChangeMemory(orgId, repo, level.from, level.to, { from, to }, at);
    }
  } catch (err) {
    // Belt and braces: the writers above already swallow their own failures.
    console.warn(
      "[memory/scan-feed] scan memory feed failed (scan unaffected)",
      err instanceof Error ? err.message : err,
    );
  }
}
