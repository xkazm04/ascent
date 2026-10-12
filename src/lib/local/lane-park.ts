// A LANE THAT COMMITTED NOTHING STILL PARKS WHAT IT COULD NOT DO (infinite-cycles block 002).
//
// THE PROMISE. The lane brief tells every agent that "a skip with a reason stops this item being
// re-dispatched next cycle" (lane-report.ts), and `openBatch` keeps it by reading the deferrals
// `recordLaneOutcomes` writes. But those are written only by `adjudicateLane`, after a rescan, and a
// lane that committed nothing never rescans (loop-lane.ts, "No commits, so no rescan"). So the one
// lane that most needs its skips recorded, the one whose session could do NONE of its batch, recorded
// none, and the next cycle was handed the same refusals again.
//
// MEASURED 2026-10-09, block 001 on xkazm04/personas: 3 gaps dispatched (D8 ai-conformance trigger,
// D9 action pinning, D9 SBOM/provenance). Each needs an edit to an existing `.github/workflows/*.yml`
// (voided for a lane) or network access to resolve action SHAs. The agent skipped all three with
// reasons in 56 s; nothing was recorded, `GET /api/org/loop/propose` still offered the same three, and
// the only other open gaps (D3, D4) are unmeasurable locally, so the craft ladder (five open rungs)
// was unreachable. Every round of the block would have been the same dry round.
//
// WHAT THIS WRITES, AND WHAT IT CANNOT. One `recordLaneOutcomes` call per DEFERRING verdict class
// (`skipped`, `needs_human`), each restricted to the batch ids the agent gave that verdict, with
// `closedIds: []`. Nothing is closed or stamped verified: with no `resolved` item in a call,
// `claimedTrailerIds` is empty for it (all-skipped, or no skip at all), so `closeBuiltCraftRungs`
// returns before it reads anything, and `verifiedAt` is set only for rescan-closed ids, of which there
// are none. A `resolved` claim from a session that committed nothing is NOT recorded: there is no work
// to stand behind it. The lessons go in as CANDIDATES for a human, never auto-kept: the guard's
// `verified` on a lane that changed nothing is vacuous.

import type { LaneReport, LaneVerdict } from "@/lib/local/lane-report";

/** The verdicts that park an item (`lane-outcomes.ts` DEFERRING), in the order they are written. */
export const PARKING_VERDICTS = ["skipped", "needs_human"] as const satisfies readonly LaneVerdict[];

export interface ParkingGroup {
  verdict: (typeof PARKING_VERDICTS)[number];
  /** Batch ids the agent gave exactly this verdict. */
  ids: string[];
  /** The report narrowed to those items, with no lessons (they are recorded separately). */
  report: LaneReport;
}

/**
 * Split a zero-commit lane's report into one group per parking verdict. Pure. Only ids that were in
 * the batch are kept, an id is grouped by its FIRST verdict in the report, and a group with no ids is
 * dropped. An unparsed or missing report parks nothing: its verdicts are unknown.
 */
export function parkingGroups(batchIds: readonly string[], report: LaneReport | null): ParkingGroup[] {
  if (!report?.parsed) return [];
  const armed = new Set(batchIds);
  const first = new Map<string, LaneReport["items"][number]>();
  for (const it of report.items) if (armed.has(it.recommendationId) && !first.has(it.recommendationId)) first.set(it.recommendationId, it);
  return PARKING_VERDICTS.map((verdict) => {
    const items = [...first.values()].filter((it) => it.verdict === verdict);
    return { verdict, ids: items.map((it) => it.recommendationId), report: { ...report, items, lessons: [] } };
  }).filter((g) => g.ids.length > 0);
}

export interface ParkDeps {
  recordLaneOutcomes: (input: {
    orgSlug: string;
    runId: string;
    laneId: string;
    repoFullName: string;
    cycle: number;
    batchIds: readonly string[];
    closedIds: readonly string[];
    report: LaneReport | null;
  }) => Promise<unknown>;
  recordLoopLessons: (org: string, repo: string, laneId: string, lessons: readonly string[], opts: { autoKeep?: boolean }) => Promise<readonly unknown[]>;
  log: (line: string) => Promise<unknown>;
}

/**
 * Record what a zero-commit lane's session could not do, and its lessons as candidates. Never throws:
 * a failure here costs the next cycle a re-dispatch, never this lane its exit.
 */
export async function parkWithoutCommits(
  a: { org: string; repo: string; runId: string; laneId: string; cycle: number; batchIds: readonly string[]; report: LaneReport | null },
  deps: ParkDeps,
): Promise<{ parked: string[]; lessons: number }> {
  const parked: string[] = [];
  let lessons = 0;
  try {
    for (const g of parkingGroups(a.batchIds, a.report)) {
      await deps.recordLaneOutcomes({
        orgSlug: a.org,
        runId: a.runId,
        laneId: a.laneId,
        repoFullName: a.repo,
        cycle: a.cycle,
        batchIds: g.ids,
        closedIds: [],
        report: g.report,
      });
      parked.push(...g.ids);
    }
    if (parked.length > 0) {
      await deps.log(
        `Parked ${parked.length} item(s) this session said it could not do (skipped / needs_human), although nothing was committed: ` +
          "the next cycle is offered other work instead of the same refusal. Nothing was closed or verified by this.",
      );
    }
    const list = a.report?.parsed ? a.report.lessons : [];
    if (list.length > 0) {
      const kept = await deps.recordLoopLessons(a.org, a.repo, a.laneId, list, { autoKeep: false });
      lessons = kept.length;
      if (lessons > 0) await deps.log(`${lessons} lesson candidate(s) recorded for review — nothing was written into memory.`);
    }
  } catch {
    /* best-effort by contract */
  }
  return { parked, lessons };
}

// A CONTAINMENT REFUSAL PARKS THE DIMENSION'S GAPS, NOT ONE TITLE (infinite-cycles block 003).
//
// THE LEAK. A deferral survives a rescan by identity, `dimId + normalizeRecTitle(title)`
// (lane-outcomes.ts `recIdentity`). The titles are written by the model on every scan, and the same
// gap comes back re-worded: block 002 on xkazm04/personas dispatched the four D9 workflow practices
// (SHA pins, token scopes, SBOM, provenance) under NINE different titles in five lanes ("Workflow
// actions float on tags and branches" -> "Action references float on tags and branches" -> "Release
// artifacts carry no provenance and actions are unpinned" -> ...). Every lane refused them for the
// same reason and parked them, and every rescan minted a title the park did not match. Three of the
// block's four dry rounds (4, 6, 7) were that re-offer, and the two back-to-back ended it on a 4 h
// dry-backoff at 7/10 rounds.
//
// WHY THE DIMENSION IS THE RIGHT KEY HERE, AND ONLY HERE. A containment refusal is a fact about the
// LANE, not about the wording: no lane session has a network, and none may edit an existing
// workflow or gate config without voiding its cycle. When a repository's gaps in one dimension have
// been refused for that reason at least `CONTAINMENT_PARK_MIN` times inside the deferral window, a
// re-worded gap in the same dimension is overwhelmingly the same refusal. A product-decision skip,
// an "already covered" skip or an unparsed report never qualifies; craft rungs never qualify (a rung
// is one face of an unbounded ladder, and one unworkable rung says nothing about the next); and the
// park still expires with the deferrals that justify it. Nothing here closes, verifies or hides a
// row: every surface still shows the gap open, and the human who can edit the workflow still sees it.

/** Distinct containment-refused GAP rows a dimension needs inside the deferral window before its
 *  re-worded gaps are parked as a dimension. Two: one confused session cannot park a dimension. */
export const CONTAINMENT_PARK_MIN = 2;

/**
 * The lane's own vocabulary for "this needs a capability I will never have". Each pattern is a
 * phrase the brief itself teaches (`LANE_CAPABILITY_RULE` in followups.ts: `needs a gate-surface
 * edit`, `needs network`, "WHAT VOIDS A WHOLE CYCLE"), so an agent applying the brief writes it.
 * Matched case-insensitively with whitespace collapsed.
 */
export const CONTAINMENT_PATTERNS: readonly RegExp[] = [
  /\bgate[- ]surface\b/,
  /\bvoids? (?:the|a|this|that) (?:\w+ )?cycle\b/,
  /\bneeds? (?:a |the )?network\b/,
  /\b(?:no|without|neither|nor) (?:a )?network\b/,
  /\b(?:no|without) (?:a )?shell\b/,
];

/** True when a skip's reason names a containment limit: network, shell, or a gate-surface edit. */
export function isContainmentRefusal(reason: string): boolean {
  if (!reason) return false;
  const s = reason.toLowerCase().replace(/\s+/g, " ");
  return CONTAINMENT_PATTERNS.some((p) => p.test(s));
}

/**
 * The dimensions whose GAPS are parked as a whole. Pure. `parked` is every active deferral joined to
 * the row it parked: only deferring verdicts on `gap` rows with a containment reason count, each row
 * at most once, and a dimension qualifies at `CONTAINMENT_PARK_MIN` distinct rows.
 */
export function containmentParkedDims(
  parked: readonly { recommendationId: string; verdict: string; reason: string; dimId: string | null; kind: string | null }[],
): Set<string> {
  const rows = new Map<string, Set<string>>();
  for (const p of parked) {
    if (!p.dimId || p.kind !== "gap") continue;
    if (!(PARKING_VERDICTS as readonly string[]).includes(p.verdict)) continue;
    if (!isContainmentRefusal(p.reason)) continue;
    const set = rows.get(p.dimId) ?? new Set<string>();
    set.add(p.recommendationId);
    rows.set(p.dimId, set);
  }
  return new Set([...rows].filter(([, ids]) => ids.size >= CONTAINMENT_PARK_MIN).map(([dim]) => dim));
}
