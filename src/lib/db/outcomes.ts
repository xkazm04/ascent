// The intervention outcome ledger (moonshot #9) — the write/read half of `InterventionOutcome`.
//
// Four loops in this codebase already compute an honest before/after delta and then throw it away
// after rendering it once: a merged practice PR verified against its post-merge rescan, a skill
// adoption paired across the same instrument, a recommendation moved to `done`, and a sandbox
// scenario reconciled against a later scan. This table is where those four measurements land in ONE
// shape, so "this practice moves D2" can stop being a model label and start being a citation.
//
// ── The one rule that makes the table worth citing ───────────────────────────────────────────────
//
// IT HOLDS MEASURED FACTS ONLY. A row is written only when both bookends exist AND both agree on
// rubricVersion and engineProvider. Every unmeasured case keeps the named status its existing reader
// already computes (`OutcomeStatus` in src/lib/org/skill-outcomes.ts) and produces NO ROW — so an
// aggregate over this table can never be diluted by a fabricated zero. A stored 0 means "measured, and
// it moved nothing", which is a finding; an absent row means "not measured", which is not.
//
// Excluded on purpose: the mock-PR simulated merge (`mockPrsEnabled()`), whose "after" scan is the
// same standing the PR was opened against. Comparing a scan to itself is a ±0 by construction, and a
// demo artifact must never enter a fact table.
//
// ── Idempotency ──────────────────────────────────────────────────────────────────────────────────
//
// `@@unique([orgId, kind, identityKey, beforeScanId, afterScanId])` and every write is an upsert on
// it. Three of the four hooks sit on READ paths that re-run on every render, so "writes nothing new
// on a re-read" is a correctness requirement, not an optimization.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/scans-audit";
import { resolveOrgId } from "@/lib/db/scans-shared";
import { mapPool } from "@/lib/pool";
import { PAIRING_MAX_DISTANCE_DAYS } from "@/lib/org/skill-outcomes";
import type { OutcomeSample } from "@/lib/outcomes/aggregate";

/** Which loop measured this outcome. `identityKey` means something different under each. */
export type OutcomeKind = "practice" | "skill" | "recommendation" | "scenario";

const DAY_MS = 86_400_000;

/** How many outcome writes may be in flight at once. Matches HISTORY_CONCURRENCY's reasoning. */
export const OUTCOME_WRITE_CONCURRENCY = 6;

/** Upper bound on one backfill pass, so an operator action can't become an unbounded table walk. */
export const BACKFILL_MAX = 500;

/**
 * The wire shape. Every timestamp is a `string`: Prisma hands back `Date`, `NextResponse.json` sends
 * ISO strings, and a type that says `Date` on both sides lets `row.recordedAt.getTime()` type-check
 * and throw. Guarded by src/lib/db/wire-safe-dates.test.ts.
 */
export interface InterventionOutcomeRow {
  id: string;
  orgId: string;
  repoFullName: string;
  kind: string;
  identityKey: string;
  /** Honest null = a whole-scan outcome (a scenario), never "dimension 0". */
  dimId: string | null;
  beforeScanId: string;
  afterScanId: string;
  interventionAt: string;
  overallDelta: number;
  /** Null when `dimId` is null OR the dimension was absent on either bookend. Never read as 0. */
  dimDelta: number | null;
  rubricVersion: string;
  engineProvider: string;
  gapDays: number;
  withinBound: boolean;
  isPrivateRepo: boolean;
  sourceRowId: string | null;
  recordedAt: string;
  updatedAt: string;
}

/** A fully-formed measured fact. The caller has already established both bookends agree. */
export interface OutcomeInput {
  orgId: string;
  repoFullName: string;
  kind: OutcomeKind;
  identityKey: string;
  dimId: string | null;
  beforeScanId: string;
  afterScanId: string;
  interventionAt: Date;
  overallDelta: number;
  dimDelta: number | null;
  rubricVersion: string;
  engineProvider: string;
  gapDays: number;
  withinBound: boolean;
  sourceRowId?: string | null;
}

/** What a hook knows before the scans are read: the two ids and what the intervention was. */
export interface OutcomePairInput {
  orgId: string;
  repoFullName: string;
  kind: OutcomeKind;
  identityKey: string;
  dimId: string | null;
  beforeScanId: string | null | undefined;
  afterScanId: string | null | undefined;
  interventionAt: Date;
  sourceRowId?: string | null;
}

type ScanBookend = {
  scannedAt: Date;
  overallScore: number;
  rubricVersion: string | null;
  engineProvider: string;
  dimensions: { dimId: string; score: number }[];
};

const BOOKEND_SELECT = {
  scannedAt: true,
  overallScore: true,
  rubricVersion: true,
  engineProvider: true,
  dimensions: { select: { dimId: true, score: true } },
} as const;

function toRow(r: {
  id: string;
  orgId: string;
  repoFullName: string;
  kind: string;
  identityKey: string;
  dimId: string | null;
  beforeScanId: string;
  afterScanId: string;
  interventionAt: Date;
  overallDelta: number;
  dimDelta: number | null;
  rubricVersion: string;
  engineProvider: string;
  gapDays: number;
  withinBound: boolean;
  isPrivateRepo: boolean;
  sourceRowId: string | null;
  recordedAt: Date;
  updatedAt: Date;
}): InterventionOutcomeRow {
  return {
    ...r,
    interventionAt: r.interventionAt.toISOString(),
    recordedAt: r.recordedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** A ledger row reduced to what `aggregateLift` is allowed to see. */
export function toOutcomeSample(row: InterventionOutcomeRow): OutcomeSample {
  return {
    orgId: row.orgId,
    identityKey: row.identityKey,
    dimId: row.dimId,
    overallDelta: row.overallDelta,
    dimDelta: row.dimDelta,
    rubricVersion: row.rubricVersion,
    engineProvider: row.engineProvider,
    isPrivateRepo: row.isPrivateRepo,
  };
}

/**
 * `Repository.isPrivate` at write time, copied onto the row. The corpus filter reads the COPY, never
 * a live lookup: a repo that was private when it was measured must not become corpus-eligible merely
 * because someone flipped it public afterwards. Unknown repo → `true`, the closed default.
 */
async function repoIsPrivate(orgId: string, fullName: string): Promise<boolean> {
  const repo = await getPrisma().repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
    select: { isPrivate: true },
  });
  return repo?.isPrivate ?? true;
}

/**
 * Upsert one measured fact. Best-effort by design: three of the four hooks sit on read paths, and a
 * ledger write must never be able to fail the page that produced the measurement.
 */
export async function recordOutcome(input: OutcomeInput): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    const isPrivateRepo = await repoIsPrivate(input.orgId, input.repoFullName);
    const { sourceRowId, ...rest } = input;
    const data = { ...rest, sourceRowId: sourceRowId ?? null, isPrivateRepo };
    await getPrisma().interventionOutcome.upsert({
      where: {
        orgId_kind_identityKey_beforeScanId_afterScanId: {
          orgId: input.orgId,
          kind: input.kind,
          identityKey: input.identityKey,
          beforeScanId: input.beforeScanId,
          afterScanId: input.afterScanId,
        },
      },
      // The bookends are part of the identity, so a re-run rewrites only what a re-measurement can
      // legitimately change: the deltas and the instrument the pair was read under.
      update: {
        overallDelta: data.overallDelta,
        dimDelta: data.dimDelta,
        rubricVersion: data.rubricVersion,
        engineProvider: data.engineProvider,
        gapDays: data.gapDays,
        withinBound: data.withinBound,
        isPrivateRepo: data.isPrivateRepo,
      },
      create: data,
    });
  } catch (err) {
    console.warn("[outcomes] record failed", err instanceof Error ? err.message : err);
  }
}

/** Bounded fan-out of {@link recordOutcome}. Never rejects — each write already swallows its own. */
export async function recordOutcomes(inputs: readonly OutcomeInput[]): Promise<void> {
  if (!inputs.length) return;
  await mapPool(inputs, OUTCOME_WRITE_CONCURRENCY, (i) => recordOutcome(i));
}

/**
 * Resolve a pair of scan ids into a measured fact and write it — the entry point for the three hooks
 * that hold two scan ids but not the scans.
 *
 * Returns `false`, having written nothing, whenever the pair is not measurable: an id is missing, a
 * scan is gone, or the two sides disagree on (or do not declare) the instrument. That refusal is the
 * table's whole value — see the header.
 */
export async function recordOutcomeForScanPair(input: OutcomePairInput): Promise<boolean> {
  const [ok] = await recordOutcomesForScanPairs([input]);
  return ok ?? false;
}

/**
 * The same measurement for MANY pairs, reading every bookend scan in ONE query.
 *
 * The per-pair entry point above is right for a hook holding a single pair, and wrong for a
 * reconcile tick: `reconcileRecommendationOutcomes` ran it in a loop, so a 50-candidate tick issued
 * 100 sequential `scan.findUnique` calls (two per candidate) on top of one `scan.findFirst` per
 * candidate to locate the "after" — ~150 round trips to measure 50 closes. The bookend set is known
 * up front, so it is read once; the refusals, the deltas and the upsert identity are byte-identical,
 * because both paths run the same `measurablePair` + `recordOutcome`.
 *
 * Returns one boolean per input, in order: `true` where a row was written, `false` for every pair the
 * table declines (missing id, self-pair, absent scan, instrument disagreement).
 */
export async function recordOutcomesForScanPairs(inputs: readonly OutcomePairInput[]): Promise<boolean[]> {
  if (!isDbConfigured() || inputs.length === 0) return inputs.map(() => false);
  try {
    const ids = new Set<string>();
    for (const i of inputs) {
      if (i.beforeScanId) ids.add(i.beforeScanId);
      if (i.afterScanId) ids.add(i.afterScanId);
    }
    if (ids.size === 0) return inputs.map(() => false);
    const rows = await getPrisma().scan.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, ...BOOKEND_SELECT },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const results = await mapPool(inputs, OUTCOME_WRITE_CONCURRENCY, async (input) => {
      const { beforeScanId, afterScanId } = input;
      if (!beforeScanId || !afterScanId || beforeScanId === afterScanId) return false;
      const before = byId.get(beforeScanId) ?? null;
      const after = byId.get(afterScanId) ?? null;
      const measured = measurablePair(before, after);
      if (!measured) return false;
      await recordOutcome({
        orgId: input.orgId,
        repoFullName: input.repoFullName,
        kind: input.kind,
        identityKey: input.identityKey,
        dimId: input.dimId,
        beforeScanId,
        afterScanId,
        interventionAt: input.interventionAt,
        sourceRowId: input.sourceRowId ?? null,
        ...measured,
        dimDelta: input.dimId ? dimDeltaFor(before!, after!, input.dimId) : null,
      });
      return true;
    });
    return results;
  } catch (err) {
    console.warn("[outcomes] pair read failed", err instanceof Error ? err.message : err);
    return inputs.map(() => false);
  }
}

/** The instrument agreement test, in one place. Null = not measurable, write nothing. */
function measurablePair(
  before: ScanBookend | null,
  after: ScanBookend | null,
): { overallDelta: number; rubricVersion: string; engineProvider: string; gapDays: number; withinBound: boolean } | null {
  if (!before || !after) return null;
  // An absent rubricVersion is UNKNOWN, never "the same" — a legacy row cannot be paired.
  if (!before.rubricVersion || !after.rubricVersion) return null;
  if (before.rubricVersion !== after.rubricVersion) return null;
  if (!before.engineProvider || before.engineProvider !== after.engineProvider) return null;
  const gapDays = Math.floor(Math.abs(after.scannedAt.getTime() - before.scannedAt.getTime()) / DAY_MS);
  return {
    overallDelta: after.overallScore - before.overallScore,
    rubricVersion: after.rubricVersion,
    engineProvider: after.engineProvider,
    gapDays,
    withinBound: gapDays <= PAIRING_MAX_DISTANCE_DAYS,
  };
}

/** Per-dimension movement, or null when the dimension is absent on either side — never 0. */
function dimDeltaFor(before: ScanBookend, after: ScanBookend, dimId: string): number | null {
  const b = before.dimensions.find((d) => d.dimId === dimId)?.score;
  const a = after.dimensions.find((d) => d.dimId === dimId)?.score;
  return b === undefined || a === undefined ? null : a - b;
}

export interface ListOutcomesOptions {
  kind?: OutcomeKind;
  dimId?: string;
  limit?: number;
}

/** Default read window. Wide enough to aggregate a year of a large fleet, bounded so it is a query. */
export const OUTCOME_LIST_LIMIT = 2000;

/**
 * Every measured outcome for ONE org, newest first. Org-scoped by construction: there is no exported
 * read that spans `orgId`, and adding one is the open-benchmark-corpus decision, not a refactor.
 */
export async function listOrgOutcomes(
  orgSlug: string,
  opts: ListOutcomesOptions = {},
): Promise<InterventionOutcomeRow[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe(async () => {
    const orgId = await resolveOrgId(orgSlug);
    if (!orgId) return [];
    const rows = await getPrisma().interventionOutcome.findMany({
      where: { orgId, ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.dimId ? { dimId: opts.dimId } : {}) },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: Math.min(opts.limit ?? OUTCOME_LIST_LIMIT, OUTCOME_LIST_LIMIT),
    });
    return rows.map(toRow);
  }, []);
}

/**
 * Replay the history the four hooks would have written had this table existed: every verified
 * `ImprovementPr` and every `SandboxScenario` with a resolvable later scan. Idempotent by the unique
 * key — a second run writes nothing new and reports the same count, because the count is of rows the
 * replay COULD measure, not of rows it inserted.
 *
 * Audited (`outcomes.backfill`): this is an operator action over historical data, unlike the org-local
 * hook writes, which are derived measurement with no security, spend or publication effect.
 */
export async function backfillOutcomes(orgSlug: string): Promise<{ written: number }> {
  if (!isDbConfigured()) return { written: 0 };
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return { written: 0 };
  const prisma = getPrisma();

  const prs = await prisma.improvementPr.findMany({
    where: { orgId, state: "merged", NOT: { verifiedScanId: null } },
    orderBy: { updatedAt: "desc" },
    take: BACKFILL_MAX,
    select: {
      id: true,
      repoFullName: true,
      practiceId: true,
      dimId: true,
      mergedAt: true,
      baselineScanId: true,
      verifiedScanId: true,
    },
  });

  const scenarios = await prisma.sandboxScenario.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    take: BACKFILL_MAX,
    select: { id: true, repoFullName: true, itemKeysJson: true, baselineScanAt: true, updatedAt: true },
  });

  let written = 0;
  const bump = (ok: boolean) => {
    if (ok) written += 1;
  };

  await mapPool(prs, OUTCOME_WRITE_CONCURRENCY, async (row) => {
    if (!row.mergedAt) return;
    bump(
      await recordOutcomeForScanPair({
        orgId,
        repoFullName: row.repoFullName,
        kind: "practice",
        identityKey: row.practiceId,
        dimId: row.dimId,
        beforeScanId: row.baselineScanId,
        afterScanId: row.verifiedScanId,
        interventionAt: row.mergedAt,
        sourceRowId: row.id,
      }),
    );
  });

  await mapPool(scenarios, OUTCOME_WRITE_CONCURRENCY, async (row) => {
    const pair = await scenarioBookends(orgId, row.repoFullName, row.baselineScanAt);
    if (!pair) return;
    bump(
      await recordOutcomeForScanPair({
        orgId,
        repoFullName: row.repoFullName,
        kind: "scenario",
        identityKey: scenarioIdentityKey(row.itemKeysJson),
        dimId: null,
        beforeScanId: pair.beforeScanId,
        afterScanId: pair.afterScanId,
        interventionAt: row.updatedAt,
        sourceRowId: row.id,
      }),
    );
  });

  await recordAudit("outcomes.backfill", { orgSlug, written, prs: prs.length, scenarios: scenarios.length }, { orgId });
  return { written };
}

/** Upper bound on the done-recommendations one reconcile tick considers. */
export const RECONCILE_MAX = 50;

/**
 * One `done` recommendation with both bookends already located: the scan the gap was FOUND on (the
 * state before anyone closed it) and the first scan after the close. `null` dimension scores mean the
 * dimension was absent on that side — the caller classifies that, this function never invents a score.
 */
export interface DoneRecCandidate {
  recommendationId: string;
  repoFullName: string;
  dimId: string;
  title: string;
  doneAt: Date;
  beforeScanId: string;
  beforeDimScore: number | null;
  afterScanId: string | null;
  afterDimScore: number | null;
}

/**
 * How many unreconciled closes beyond this tick's own take are counted, so `remaining` is a real
 * number instead of a boolean. Past it the count is a FLOOR and `truncated` says so — the ledger
 * would rather report "at least 200 waiting" than guess a total.
 */
export const RECONCILE_REMAINING_PROBE = 200;

/** Ledgered closes read to build the skip set. A tick past this many measured closes still makes
 *  progress: the extras are simply re-examined and re-upserted onto their own identity. */
const RECONCILED_ID_CAP = 5_000;

/** Scans read in the ONE query that locates every candidate's "after" bookend. A candidate whose
 *  after-scan falls outside the window is reported as awaiting a rescan — no row, retried next
 *  tick — never as a measurement taken against the wrong scan. */
const AFTER_SCAN_WINDOW = 500;

/** One tick's worth of candidates, with what it could NOT reach stated beside them. */
export interface DoneRecCandidatePage {
  candidates: DoneRecCandidate[];
  /** Unreconciled closes this tick did not take. A FLOOR when `truncated`. */
  remaining: number;
  /** More than {@link RECONCILE_REMAINING_PROBE} were waiting behind the take, so `remaining` is a
   *  floor rather than a total. */
  truncated: boolean;
}

/**
 * The durable `done` events for an org, resolved into scan pairs.
 *
 * Driven off `RecommendationEvent` — the append-only status log — rather than the render-time diff in
 * report/compare.ts. That diff (`reconcileDoneRec`, `diffScans`) is PURE and client-imported: it runs
 * inside a page render and has no write seam, and adding one there would mean a page render writing to
 * a fact table. The events are the same fact, durably, on the server.
 *
 * Newest event wins per recommendation: a row toggled done → open → done was closed at the LAST close,
 * and that is the intervention instant a later scan should be measured against.
 *
 * ── Two things this read got wrong, and why they mattered ────────────────────────────────────────
 *
 * It took the 50 newest `done` EVENTS and deduped to one per recommendation AFTERWARDS, so a row
 * toggled done → open → done consumed three of the fifty slots and a tick could measure far fewer
 * closes than it claimed to consider. The dedupe now happens in the DATABASE — one group per
 * recommendation, ordered by its last close — so the take is fifty recommendations, always.
 *
 * And the window never moved: ordering by `createdAt desc` with no cursor meant an org past fifty
 * closes reconciled the same newest fifty on every tick, forever. Its older closes could never become
 * ledger rows and therefore could never count toward `OUTCOME_MIN_SAMPLES`, and nothing said so. The
 * watermark is the LEDGER ITSELF: a close already carrying an `InterventionOutcome` row
 * (`sourceRowId`) is excluded in the query, so each tick advances into the tail. A close that is not
 * yet measurable (no rescan since) writes no row and is deliberately NOT excluded — it must be
 * re-examined once the rescan lands — which is exactly the population `remaining` discloses.
 */
export async function listDoneRecCandidates(orgId: string, limit = RECONCILE_MAX): Promise<DoneRecCandidatePage> {
  const empty: DoneRecCandidatePage = { candidates: [], remaining: 0, truncated: false };
  if (!isDbConfigured()) return empty;
  return dbReadSafe(async () => {
    const prisma = getPrisma();
    // 1 — the watermark, derived from the ledger rather than from a column this schema doesn't have.
    const ledgered = await prisma.interventionOutcome.findMany({
      where: { orgId, kind: "recommendation", sourceRowId: { not: null } },
      select: { sourceRowId: true },
      take: RECONCILED_ID_CAP,
    });
    const reconciled = ledgered.map((r) => r.sourceRowId).filter((id): id is string => Boolean(id));

    // 2 — one group per RECOMMENDATION (the dedupe, in the database, before the take), ordered by the
    // last close, and skipping what the ledger already holds.
    const groups = await prisma.recommendationEvent.groupBy({
      by: ["recommendationId"],
      where: {
        kind: "status",
        toValue: "done",
        recommendation: { scan: { repo: { orgId } } },
        ...(reconciled.length ? { recommendationId: { notIn: reconciled } } : {}),
      },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      take: limit + RECONCILE_REMAINING_PROBE,
    });
    const page = groups.slice(0, limit);
    const remaining = groups.length - page.length;
    const truncated = groups.length >= limit + RECONCILE_REMAINING_PROBE;
    if (page.length === 0) return { candidates: [], remaining, truncated };

    // 3 — the rows behind those ids, in one query.
    const recs = await prisma.recommendation.findMany({
      where: { id: { in: page.map((g) => g.recommendationId) } },
      select: {
        id: true,
        dimId: true,
        title: true,
        scanId: true,
        scan: {
          select: {
            repoId: true,
            repo: { select: { fullName: true } },
            dimensions: { select: { dimId: true, score: true } },
          },
        },
      },
    });
    const recById = new Map(recs.map((r) => [r.id, r]));

    const closes = page
      .map((g) => ({ rec: recById.get(g.recommendationId), doneAt: g._max.createdAt }))
      .filter((c): c is { rec: NonNullable<ReturnType<typeof recById.get>>; doneAt: Date } => Boolean(c.rec && c.doneAt));
    if (closes.length === 0) return { candidates: [], remaining, truncated };

    // 4 — every candidate's "after" bookend in ONE query: the repos involved, from the earliest close
    // forward, in the same order the per-candidate findFirst used, so each candidate still picks the
    // FIRST scan after its own close.
    const earliest = closes.reduce((min, c) => (c.doneAt < min ? c.doneAt : min), closes[0]!.doneAt);
    const repoIds = [...new Set(closes.map((c) => c.rec.scan.repoId))];
    const laterScans = await prisma.scan.findMany({
      where: { repoId: { in: repoIds }, scannedAt: { gt: earliest } },
      orderBy: [{ scannedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: AFTER_SCAN_WINDOW,
      select: { id: true, repoId: true, scannedAt: true, dimensions: { select: { dimId: true, score: true } } },
    });

    const candidates = closes.map(({ rec, doneAt }) => {
      const after = laterScans.find((s) => s.repoId === rec.scan.repoId && s.scannedAt > doneAt) ?? null;
      return {
        recommendationId: rec.id,
        repoFullName: rec.scan.repo.fullName,
        dimId: rec.dimId,
        title: rec.title,
        doneAt,
        beforeScanId: rec.scanId,
        beforeDimScore: rec.scan.dimensions.find((d) => d.dimId === rec.dimId)?.score ?? null,
        afterScanId: after?.id ?? null,
        afterDimScore: after?.dimensions.find((d) => d.dimId === rec.dimId)?.score ?? null,
      };
    });
    return { candidates, remaining, truncated };
  }, empty);
}

/**
 * A scenario's identity: the sorted set of roadmap items it modeled, hashed. Sorted so the same
 * selection made in a different click order is the same scenario, and hashed so an unbounded key list
 * cannot become an unbounded index key. An empty selection has no identity worth aggregating.
 */
export function scenarioIdentityKey(itemKeysJson: string): string {
  let keys: string[] = [];
  try {
    const raw: unknown = JSON.parse(itemKeysJson);
    if (Array.isArray(raw)) keys = raw.filter((k): k is string => typeof k === "string");
  } catch {
    keys = [];
  }
  return `scenario:${fnv1aLocal([...keys].sort().join("|"))}`;
}

// A local copy of the 32-bit FNV-1a in src/lib/org/findings.ts. Imported rather than copied would be
// better, but findings.ts is a wide org-analytics module and the data layer should not depend on it;
// this is six lines with a fixed, tested definition.
function fnv1aLocal(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The two scans a saved scenario is measured between: the latest scan at-or-before the modeled
 * baseline instant, and the earliest scan after it. Null while nothing newer has landed — reporting a
 * scenario against the very scan it was modeled on is a ±0 dressed as a measurement.
 */
export async function scenarioBookends(
  orgId: string,
  repoFullName: string,
  baselineScanAt: Date,
): Promise<{ beforeScanId: string; afterScanId: string } | null> {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName: repoFullName } },
    select: { id: true },
  });
  if (!repo) return null;
  const [before, after] = await Promise.all([
    prisma.scan.findFirst({
      where: { repoId: repo.id, scannedAt: { lte: baselineScanAt } },
      orderBy: [{ scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
    prisma.scan.findFirst({
      where: { repoId: repo.id, scannedAt: { gt: baselineScanAt } },
      orderBy: [{ scannedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
  ]);
  if (!before || !after) return null;
  return { beforeScanId: before.id, afterScanId: after.id };
}
