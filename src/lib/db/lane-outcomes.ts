// PER-ITEM OUTCOMES — what happened to each row a lane was handed, and for how long a skip should
// stop the loop asking the same question again.
//
// THE PROBLEM THIS SOLVES. A lane dispatched five follow-ups and recorded one number: how many the
// rescan closed. An item the agent SKIPPED — because it needed a product decision, because the
// change was unsafe, because the repository had already solved it another way — was indistinguishable
// from one it simply failed at, so the next cycle picked it up again, spent another session on it,
// and skipped it again. The loop could not learn from a "no".
//
// A DEFERRAL IS NOT A DECISION ON THE ROW. `Recommendation.status` has four values
// (`open | in_progress | done | dismissed`) and none of them means "declined by an agent for now" —
// writing `dismissed` would be the loop closing a human's backlog item on an agent's say-so. So the
// deferral lives HERE, is advisory to `openBatch` alone, and every other surface still shows the item
// exactly as open as it is. The item's own timeline explains itself through a `RecommendationEvent`.
//
// THE RESCAN STILL WINS. `resolved` is written when the id is in the rescan's `closedIds`, whatever
// the agent claimed; the agent's verdict is only consulted for ids the rescan did not close.
//
// …AND `resolved` ALONE NEVER SAID WHICH ONE HAPPENED (UAT `PRIYA-L1-702`, 2026-08-31). The verdict
// column holds `resolved` for BOTH a row the rescan closed and a row the agent merely claimed
// resolved, and the cockpit labelled every one of them "closed by the rescan". So each row now
// carries `verified`: TRUE only when the id was in the rescan's adjudicated close set.
//
// …AND DERIVING IT AT READ TIME LET THE TAUTOLOGY BACK IN (UAT `RC-N4`, 2026-08-31). `verified` was
// first computed by joining the lane's `closedIdsJson` — correct for new rows, but every lane written
// BEFORE the split stored the raw commit-TRAILER set there, which is the agent's own claim. The
// recertification swept the only corpus that exists and found 36 of 36 historical rows still reading
// `verified: true`; not one rendered the new label. A read-time join cannot tell a claim from a
// verdict when the thing it joins against IS the claim.
//
// So the fact is now STAMPED WHERE IT HAPPENS: `LaneItemOutcome.verifiedAt` is written by
// `recordLaneOutcomes` from the rescan's adjudicated close set, and `listRunOutcomes` reads the
// column instead of joining. A historical row has no stamp, so it reads unverified — that is not a
// missing backfill, it IS the backfill: nothing adjudicated those closes and no migration can invent
// an adjudication that never happened. NULL IS NEVER VERIFIED, on every path.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
// The SAME identity `decideInProgress` / `isRestated` / the craft ledger carry status across a rescan
// with. A deferral that keys on anything else is a deferral the next rescan silently drops.
import { normalizeRecTitle } from "@/lib/report/compare";
import type { LaneReport, LaneVerdict } from "@/lib/local/lane-report";

/** How many cycles a skip holds before the loop is willing to try again. */
export const LANE_DEFER_CYCLES = 3;
/** Wall-clock ceiling on a deferral, so an item cannot be parked indefinitely by one bad session. */
export const LANE_DEFER_MAX_DAYS = 14;
/** Rough cycle length used to turn `LANE_DEFER_CYCLES` into a date. A cycle is a real working
 *  session; a day per cycle is the conservative reading and the cap bounds the error either way. */
const DEFER_DAYS_PER_CYCLE = 1;

/** The verdicts that park an item. An `attempted` or `absent` item is re-dispatchable immediately —
 *  nothing was learned that should stop the loop trying again. */
const DEFERRING: readonly LaneVerdict[] = ["skipped", "needs_human"];

/**
 * A HEURISTIC over the AGENT'S OWN WORDS. Not a judgement about the change, not a re-read of the
 * diff — purely: did the sentence the agent wrote to justify `resolved` also admit that it could not
 * do the thing the item asked for?
 *
 * WHY. The lane agent has no shell and no network, and its measured failure mode is not giving up —
 * it is doing something *adjacent* and claiming the item. A real run wrote, under verdict `resolved`:
 * "resolving a tag to a commit SHA requires asking GitHub what it points at right now, this session
 * has neither network nor shell, and inventing a SHA breaks the workflow…". That claim then bought
 * no deferral, so the next cycle armed the same impossible item again — 40+ "closed" follow-ups
 * across three campaign runs with no sustained score movement. `buildFixPrompt`'s capability rule
 * asks the agent to say SKIPPED itself; this is the check for when it does not.
 *
 * KEPT NARROW ON PURPOSE. Every phrase names a capability this session provably lacks, or the one
 * act (fabricating a value it could not look up) that the rule exists to forbid. A vaguer list — a
 * bare "cannot", "unable", "blocked" — would downgrade honest resolves whose reason merely mentions
 * something the change now prevents. False negatives are cheap here (the rescan re-raises the gap
 * next cycle anyway); a false positive parks work that was genuinely done, for three cycles.
 *
 * Matched case-insensitively against the reason with whitespace collapsed, so a line-wrapped
 * sentence matches the same as a single-line one.
 */
export const INCAPACITY_PHRASES: readonly string[] = [
  // No shell / no network, in the phrasings agents actually write.
  "no shell",
  "nor shell",
  "without a shell",
  "no network",
  "nor network",
  "neither network",
  "without network",
  "no internet",
  "no network access",
  // Naming the missing act.
  "cannot run",
  "can't run",
  "cannot fetch",
  "unable to fetch",
  "would need to fetch",
  "requires asking github",
  "requires asking the",
  "cannot resolve the tag",
  // The forbidden substitute: making up a value it could not look up.
  "inventing a",
  "invented a",
  "would be inventing",
];

/**
 * True when the agent's own reason admits it lacked a capability the item needed. See
 * `INCAPACITY_PHRASES` — this is a heuristic over prose, never a verdict on the code.
 */
export function admitsIncapacity(reason: string): boolean {
  if (!reason) return false;
  const s = reason.toLowerCase().replace(/\s+/g, " ");
  return INCAPACITY_PHRASES.some((p) => s.includes(p));
}

/** One item's outcome, as a client reads it. Timestamps are STRINGS — see wire-safe.ts. */
export interface LaneOutcomeRow {
  id: string;
  runId: string;
  laneId: string;
  repoFullName: string;
  recommendationId: string;
  cycle: number;
  verdict: string;
  reason: string;
  /** True when the RESCAN adjudicated this id closed — the gap is no longer raised AND its dimension
   *  measurably moved (`decideInProgress`). False on every other row, including a `resolved` the
   *  AGENT claimed and the rescan did not confirm — and every row written before `verifiedAt`
   *  existed, whose close nothing adjudicated. Only a `verified` row may be rendered as closed. */
  verified: boolean;
  /** ISO string of the moment the rescan adjudicated this close, or null when nothing did. The
   *  STORED fact `verified` is read from; null is never verified. */
  verifiedAt: string | null;
  files: string[];
  /** ISO string, or null when this outcome parks nothing. */
  deferUntil: string | null;
  createdAt: string;
}

type OutcomeRow = {
  id: string;
  runId: string;
  laneId: string;
  repoFullName: string;
  recommendationId: string;
  cycle: number;
  verdict: string;
  reason: string;
  filesJson: string;
  deferUntil: Date | null;
  /** Optional in the TYPE, not in the schema: a database that has not yet applied the migration
   *  returns rows without it, and `undefined` must read the same as null — unverified. */
  verifiedAt?: Date | null;
  createdAt: Date;
};

function toRow(row: OutcomeRow): LaneOutcomeRow {
  // The stamp is the only source of verification. A missing column, a null, a row from before the
  // migration — all three are "nothing adjudicated this", which is the safe direction for a trust
  // flag. The `verdict` guard keeps the pair coherent even if a stamp ever outlived its verdict.
  const verifiedAt = row.verifiedAt ?? null;
  let files: string[] = [];
  try {
    const v: unknown = JSON.parse(row.filesJson || "[]");
    files = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    files = [];
  }
  return {
    id: row.id,
    runId: row.runId,
    laneId: row.laneId,
    repoFullName: row.repoFullName,
    recommendationId: row.recommendationId,
    cycle: row.cycle,
    verdict: row.verdict,
    reason: row.reason,
    verified: row.verdict === "resolved" && verifiedAt !== null,
    verifiedAt: verifiedAt ? verifiedAt.toISOString() : null,
    files,
    deferUntil: row.deferUntil ? row.deferUntil.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The date a deferring verdict parks an item until, bounded. */
export function deferUntilFor(now: Date, cycles: number = LANE_DEFER_CYCLES): Date {
  const days = Math.min(LANE_DEFER_MAX_DAYS, Math.max(1, cycles * DEFER_DAYS_PER_CYCLE));
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export interface RecordOutcomesInput {
  orgSlug: string;
  runId: string;
  laneId: string;
  repoFullName: string;
  cycle: number;
  /** Every id the lane dispatched — the set the outcomes are written for, and nothing outside it. */
  batchIds: readonly string[];
  /** Ids the RESCAN ADJUDICATED closed — `persistScanReport`'s `closedFollowUpIds`, which have been
   *  through `decideInProgress`'s movement witness. NOT the commit-trailer set: a trailer is the
   *  agent's claim, and passing it here is what made the loop certify its own homework
   *  (UAT `PRIYA-L1-702`). These are `resolved` AND `verified` whatever the agent said. */
  closedIds: readonly string[];
  /** The agent's own report, or null when it wrote none. */
  report: LaneReport | null;
  now?: Date;
}

/**
 * Write one outcome per dispatched id. Idempotent on `(laneId, recommendationId)`, so re-parsing a
 * report — a retry, a re-read after a crash — updates rather than duplicates.
 *
 * The precedence is deliberate and is the whole rule:
 *   1. the RESCAN closed it → `resolved`. The verifier outranks the claim, always.
 *   2. the AGENT said something about it → that verdict, with its own words as the reason.
 *   3. neither → `absent`. Nobody accounted for this id, which is a fact worth recording rather than
 *      a gap to fill with a guess.
 * and then one correction on top of (2) alone: an unverified `resolved` whose own reason admits the
 * session lacked a needed capability becomes `needs_human` (`admitsIncapacity`), so it defers instead
 * of being re-armed next cycle.
 */
export async function recordLaneOutcomes(input: RecordOutcomesInput): Promise<LaneOutcomeRow[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(input.orgSlug).catch(() => null);
  if (!org) return [];
  const prisma = getPrisma();
  const now = input.now ?? new Date();
  const closed = new Set(input.closedIds);
  const byId = new Map((input.report?.items ?? []).map((i) => [i.recommendationId, i]));
  const written: LaneOutcomeRow[] = [];

  for (const id of new Set(input.batchIds)) {
    const claim = byId.get(id);
    const rescanClosed = closed.has(id);
    const claimed: LaneVerdict = rescanClosed ? "resolved" : (claim?.verdict ?? "absent");
    // THE SUBSTITUTION CHECK. A `resolved` the agent claimed on its own — the rescan did NOT close it
    // — whose reason admits the session could not do the thing (no shell, no network, "inventing a
    // SHA") is downgraded to `needs_human`, which defers through the ordinary DEFERRING path so the
    // next cycle works something else instead of re-arming an item this grant cannot close.
    //
    // ONLY the unverified claim. A rescan-closed id is never touched: the verifier outranks the
    // claim in both directions, and that invariant is older and stronger than this heuristic — an
    // agent can write a muddled reason about work that demonstrably landed.
    const downgraded = !rescanClosed && claimed === "resolved" && admitsIncapacity(claim?.reason ?? "");
    const verdict: LaneVerdict = downgraded ? "needs_human" : claimed;
    // A resolved item is never deferred: it is done, and the next cycle will not see it anyway.
    const deferUntil = DEFERRING.includes(verdict) ? deferUntilFor(now) : null;
    const data = {
      orgId: org.id,
      runId: input.runId,
      laneId: input.laneId,
      repoFullName: input.repoFullName,
      recommendationId: id,
      cycle: input.cycle,
      verdict,
      // The agent's OWN words, or "" — never a sentence written on its behalf.
      reason: claim?.reason ?? "",
      filesJson: JSON.stringify(claim?.files ?? []),
      deferUntil,
      // THE VERIFICATION STAMP, written at adjudication time. `rescanClosed` is membership in
      // `input.closedIds` — the set that went through `decideInProgress` — so the stamp records the
      // one moment a verifier ruled, and can never be re-derived from something the agent wrote.
      //
      // It moves with the verdict on an update rather than being sticky, because both are read from
      // the SAME input on every call: a re-parse that no longer sees the id closed would also stop
      // writing `resolved`, and a stamp left behind would then contradict its own row. Two facts
      // from one input stay coherent only if they are written together.
      verifiedAt: rescanClosed ? now : null,
    };
    const row = await prisma.laneItemOutcome
      .upsert({
        where: { laneId_recommendationId: { laneId: input.laneId, recommendationId: id } },
        create: data,
        update: { verdict, reason: data.reason, filesJson: data.filesJson, deferUntil, verifiedAt: data.verifiedAt },
      })
      .catch(() => null);
    if (row) written.push(toRow(row as OutcomeRow));
    // The item's own timeline explains itself: without this a reader of the backlog row sees it go
    // in_progress and come back open with no account of why.
    await prisma.recommendationEvent
      .create({
        data: {
          recommendationId: id,
          actor: "autopilot",
          kind: "lane_verdict",
          toValue: verdict,
          // The row's `reason` stays the agent's own words, always. Only the TIMELINE note says a
          // downgrade happened — otherwise a reader sees a claim of `resolved` become `needs_human`
          // with nothing accounting for it.
          note: downgraded
            ? `Claimed resolved, but the session's own reason says it lacked a capability the item needs — recorded as needs_human. ${claim?.reason ?? ""}`.slice(0, 500)
            : claim?.reason
              ? claim.reason.slice(0, 500)
              : `Loop cycle ${input.cycle}: ${verdict}`,
        },
      })
      .catch(() => null);
  }
  // THE CRAFT RUNGS THIS LANE ACTUALLY BUILT. Best-effort and last: a failure here must not cost the
  // outcome ledger the rows it just wrote.
  await closeBuiltCraftRungs({
    orgId: org.id,
    laneId: input.laneId,
    cycle: input.cycle,
    ids: claimedTrailerIds(input.batchIds, input.report),
    now,
  }).catch(() => []);
  return written;
}

/**
 * The ids this lane's commit carried an `Ascent-Resolves:` trailer for — mirroring `trailerIds` in
 * lane-commit.ts, which is the code that actually wrote them. Named RESOLVED ids win; a session that
 * named only skips trails the rest ("I did not do these four" accounts for the fifth); a session that
 * named nothing claims nothing.
 *
 * Pure, and deliberately a re-statement rather than an import: lane-commit.ts reaches for `runGit`,
 * and this module is on the db side of the wall.
 */
export function claimedTrailerIds(batchIds: readonly string[], report: LaneReport | null): string[] {
  const armed = [...new Set(batchIds)];
  const items = report?.items ?? [];
  const resolved = armed.filter((id) => items.some((i) => i.recommendationId === id && i.verdict === "resolved"));
  if (resolved.length > 0) return resolved;
  const skipped = new Set(items.filter((i) => i.verdict === "skipped").map((i) => i.recommendationId));
  if (skipped.size > 0) return armed.filter((id) => !skipped.has(id));
  return [];
}

/**
 * A CRAFT RUNG CLOSES ON THE TRAILER OF A VERIFIED LANE — the adjudication craft never had.
 *
 * WHY IT WAS MISSING. `decideInProgress` already holds the craft rule: movement cannot witness a
 * ceiling raise, so a craft row closes on its trailer and on nothing else — but it is only ever ASKED
 * when the next scan stops restating the row. A craft entry is the model's answer to an unbounded
 * question, re-derived from scratch every scan, so it IS restated almost every time and the question
 * is never reached. Measured on 2026-09-01: 2757 `in_progress` craft rows over 186 titles in one
 * repository, one title re-raised 61 times, and 37 of 136 agent verdicts opening with "Already
 * covered" because the loop kept handing back rungs it had already built.
 *
 * SO THE CLOSE HAPPENS AT LANE END, WHERE THE EVIDENCE IS. Two conditions, both required:
 *   • the lane's own A/B degradation guard returned `verified` — the repository's check passed before
 *     the session and passed again after it, so the work is on the branch and is not a regression; and
 *   • the commit carried this row's `Ascent-Resolves:` trailer — the session's own claim that THIS
 *     rung is what it built.
 * A `rejected` lane never reaches this code at all (its edits are discarded and its claims released);
 * a `skipped`, `baseline-red` or unknown verdict reaches it and closes nothing, because an unverified
 * lane's claim is exactly the self-certification the trailer rules exist to refuse.
 *
 * GAPS ARE UNTOUCHED. A gap still closes only through the rescan's "no longer raised AND the dimension
 * moved" witness. This is the craft asymmetry `decideInProgress` already documents, applied at the one
 * moment both facts are in hand.
 */
async function closeBuiltCraftRungs(input: { orgId: string; laneId: string; cycle: number; ids: readonly string[]; now: Date }): Promise<string[]> {
  if (input.ids.length === 0) return [];
  const prisma = getPrisma();
  const lane = await prisma.loopRunLane.findUnique({ where: { id: input.laneId }, select: { verifyVerdict: true } }).catch(() => null);
  if (!lane || lane.verifyVerdict !== "verified") return [];
  const rows: { id: string }[] = await prisma.recommendation
    .findMany({ where: { id: { in: [...input.ids] }, kind: "craft", status: { not: "done" } }, select: { id: true } })
    .catch(() => []);
  const closed: string[] = [];
  for (const row of rows) {
    const done = await prisma.recommendation.update({ where: { id: row.id }, data: { status: "done" } }).catch(() => null);
    if (!done) continue;
    closed.push(row.id);
    await prisma.recommendationEvent
      .create({
        data: {
          recommendationId: row.id,
          actor: "autopilot",
          kind: "status",
          toValue: "done",
          note: `Craft rung BUILT in loop cycle ${input.cycle}: the lane's commit carried this row's Ascent-Resolves trailer and the degradation guard verified the cycle. A craft rung has no score for a rescan to confirm, so it closes on the trailer of a verified lane — which is also what stops it being proposed again.`.slice(
            0,
            500,
          ),
        },
      })
      .catch(() => null);
  }
  return closed;
}

/** The stable identity of a recommendation — `dimId` + normalized title. The key `matchRecommendations`
 *  carries status across re-scans with, and now the key a deferral survives a rescan by. */
export const recIdentity = (r: { dimId: string; title: string }): string => `${r.dimId}::${normalizeRecTitle(r.title)}`;

/**
 * Recommendation ids this repo should NOT be re-offered yet, because a lane parked them.
 *
 * Org- AND repo-scoped: a deferral is a fact about one repository's item, and a cross-tenant read
 * here would let one org's skip suppress another's backlog.
 *
 * A DEFERRAL IS ON THE ITEM, NOT ON THE ROW (2026-09-01). It used to be a set of recommendation IDS,
 * and every rescan re-derives a repository's recommendations as NEW ROWS WITH NEW IDS — so a deferral
 * expired the moment the next scan ran, which on this loop is minutes later. The measurement: D9's
 * "pin actions to a commit SHA" was dispatched and skipped for "no network" in 8 of 8 campaign-5 runs,
 * burning a batch slot every time, while 529 `in_progress` rows for it piled up
 * (docs/harness/reflection-2026-09-01.md, finding 5). The park was real and it never applied twice.
 *
 * So the parked ids are widened to the parked ITEMS: the deferred rows' `dimId + normalizeRecTitle`
 * identities, matched against this repository's current rows. A re-derived row carrying the same
 * identity is still parked; a genuinely new title is not, and neither is anything in another repo or
 * another org. The expansion is bounded to the repository's LATEST scan — the window `openBatch`
 * itself reads — so the extra read is one indexed query, not a history sweep.
 */
export async function getActiveDeferrals(orgSlug: string, repoFullName: string, now: Date = new Date()): Promise<Set<string>> {
  if (!isDbConfigured()) return new Set();
  return dbReadSafe<Set<string>>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return new Set();
    const prisma = getPrisma();
    const rows = await prisma.laneItemOutcome.findMany({
      where: { orgId: org.id, repoFullName, deferUntil: { gt: now } },
      select: { recommendationId: true },
    });
    const ids = new Set(rows.map((r) => r.recommendationId));
    if (ids.size === 0) return ids;
    try {
      return await expandToIdentities(prisma, org.id, repoFullName, ids);
    } catch {
      // The widening is an IMPROVEMENT on the id set, never a precondition for it. If any of its
      // reads fails the caller still gets every id a lane actually parked — the old behaviour — rather
      // than an empty set from `dbReadSafe`'s fallback, which would un-park everything.
      return ids;
    }
  }, new Set());
}

/** The identity expansion behind `getActiveDeferrals`. Split out so its failure cannot cost the
 *  caller the ids it already has. */
async function expandToIdentities(
  prisma: ReturnType<typeof getPrisma>,
  orgId: string,
  repoFullName: string,
  ids: Set<string>,
): Promise<Set<string>> {
  // What those parked rows WERE, by identity. A row that has since been purged simply contributes
  // no identity — the id itself stays parked, which is the pre-2026-09-01 behaviour.
  const parked = await prisma.recommendation.findMany({
    where: { id: { in: [...ids] } },
    select: { dimId: true, title: true },
  });
  const keys = new Set(parked.map(recIdentity));
  if (keys.size === 0) return ids;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId: orgId, fullName: repoFullName } },
    select: { id: true },
  });
  if (!repo) return ids;
  const scan = await prisma.scan.findFirst({ where: { repoId: repo.id }, orderBy: { scannedAt: "desc" }, select: { id: true } });
  if (!scan) return ids;
  const current = await prisma.recommendation.findMany({
    where: { scanId: scan.id, status: { in: ["open", "in_progress"] } },
    select: { id: true, dimId: true, title: true },
  });
  for (const r of current) if (keys.has(recIdentity(r))) ids.add(r.id);
  return ids;
}

/**
 * Every outcome of one run, newest lane first — the per-item ledger the cockpit renders.
 *
 * ONE READ, NO JOIN. `verified` comes from the row's own `verifiedAt` stamp, written when the rescan
 * adjudicated the close. It used to be joined from the lane's `closedIdsJson`, which was the very set
 * this whole split exists to distrust on historical lanes — the recertification measured 36 of 36 old
 * rows coming back verified through that join (UAT `RC-N4`). A row with no stamp is unverified, and
 * that includes every row written before the column existed: nothing adjudicated those closes.
 */
export async function listRunOutcomes(runId: string): Promise<LaneOutcomeRow[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<LaneOutcomeRow[]>(async () => {
    const rows = await getPrisma().laneItemOutcome.findMany({
      where: { runId },
      orderBy: [{ createdAt: "desc" }, { recommendationId: "asc" }],
    });
    return (rows as OutcomeRow[]).map(toRow);
  }, []);
}
