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
  if (!isDbConfigured()) return false;
  const { beforeScanId, afterScanId } = input;
  if (!beforeScanId || !afterScanId || beforeScanId === afterScanId) return false;
  try {
    const prisma = getPrisma();
    const [before, after] = await Promise.all([
      prisma.scan.findUnique({ where: { id: beforeScanId }, select: BOOKEND_SELECT }),
      prisma.scan.findUnique({ where: { id: afterScanId }, select: BOOKEND_SELECT }),
    ]);
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
  } catch (err) {
    console.warn("[outcomes] pair read failed", err instanceof Error ? err.message : err);
    return false;
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
