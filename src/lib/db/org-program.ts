// The transition programme (W1c) — the org's named, dated commitment, and the state that outlives
// onboarding.
//
// Onboarding's checklist (src/lib/org/getting-started.ts) ends at "invite a teammate", which is
// exactly where the job starts. Everything after was stateless: the dashboard could say where the
// fleet stood, never "where are we IN something". A programme is that thread — one per org, with a
// target rung, a date and a review cadence — and `buildProgramStatus` turns it into the one line the
// shell prints on every tab.
//
// THE FROZEN BASELINE IS THE POINT. Port's AI-SDLC rule is "baseline before you turn anything on",
// and a baseline recomputed from today's data is not a baseline — it moves with the thing it is
// supposed to measure, so a programme could never report anything but zero progress. So the fleet
// snapshot is captured ONCE at creation and never rewritten; progress is always today's live rollup
// read against that fixed origin. A programme started before the org's first scan stores a NULL
// baseline (honest absent origin) rather than a zeroed one, which would make the first scan look
// like pure progress.
//
// Pure `buildProgramStatus` + thin async reads — the same split as getting-started.ts and
// nav-counts.ts, so every rule below is unit-testable without a database.

import { cache } from "react";

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { countInFlightPrs } from "@/lib/db/improvement";
import { getOrgImpactLedger } from "@/lib/db/org-impact";
import { getOrgHeaderSummary } from "@/lib/db/org-rollup";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { levelForScore, LEVELS } from "@/lib/maturity/model";
import type { LevelId } from "@/lib/types";

export type ProgramCadence = "weekly" | "biweekly" | "monthly";
export type ProgramStatus = "active" | "paused" | "achieved";

const CADENCES: ReadonlySet<string> = new Set<ProgramCadence>(["weekly", "biweekly", "monthly"]);
const STATUSES: ReadonlySet<string> = new Set<ProgramStatus>(["active", "paused", "achieved"]);
const LEVEL_IDS: ReadonlySet<string> = new Set(LEVELS.map((l) => l.id));

/** Days between reviews, per cadence — drives the "next review" read. */
const CADENCE_DAYS: Record<ProgramCadence, number> = { weekly: 7, biweekly: 14, monthly: 28 };

export function isProgramCadence(v: unknown): v is ProgramCadence {
  return typeof v === "string" && CADENCES.has(v);
}
export function isProgramStatus(v: unknown): v is ProgramStatus {
  return typeof v === "string" && STATUSES.has(v);
}
export function isLevelId(v: unknown): v is LevelId {
  return typeof v === "string" && LEVEL_IDS.has(v);
}

/** The fleet snapshot frozen at programme start. Null overall = no scanned repo at the time. */
export interface ProgramBaseline {
  overall: number | null;
  adoption: number | null;
  rigor: number | null;
  scannedCount: number;
  repoCount: number;
}

export interface TransitionProgramRow {
  id: string;
  name: string;
  targetLevel: LevelId;
  targetDate: string | null;
  cadence: ProgramCadence;
  baselineAt: string;
  baseline: ProgramBaseline | null;
  status: ProgramStatus;
  startedBy: string | null;
}

/** Today's live fleet read the programme is measured against. */
export interface ProgramNow {
  overall: number | null;
  scannedCount: number;
  /** Repos whose latest scan reaches the programme's target level. */
  atTarget: number;
  /** Improvement PRs open right now. */
  inFlightPrs: number;
  /** Verified dimension points bought since the programme started — NULL when nothing is verified. */
  pointsBought: number | null;
}

export interface ProgramStatusView {
  program: TransitionProgramRow;
  /** Whole weeks since `baselineAt`, 1-based — "Week 1" is the week it started. */
  week: number;
  /** Level the fleet is at now, or null with no scanned repo. */
  levelNow: LevelId | null;
  levelTarget: LevelId;
  /** Points of overall movement since the frozen baseline. Null when either end is unknown. */
  movedOverall: number | null;
  atTarget: number;
  scannedCount: number;
  inFlightPrs: number;
  /**
   * Verified points bought. NULL means "nothing verified yet", which the strip renders as absence —
   * never as 0. This is the W1d gate applied to the strip: the programme line may only make a
   * "bought" claim once the Impact Ledger has something real to back it.
   */
  pointsBought: number | null;
  /** Days until the next review, from the cadence. Null when the programme is not active. */
  daysToReview: number | null;
  /** Days remaining to `targetDate`; negative = overdue. Null when open-ended. */
  daysToTarget: number | null;
}

const DAY_MS = 86_400_000;

/** Rung order, L1 → L5, so "at or above target" is an index comparison rather than string math. */
const LEVEL_ORDER: readonly string[] = LEVELS.map((l) => l.id);

/**
 * Repos at or ABOVE the target rung, from `getOrgHeaderSummary().levelCounts`. Pure.
 *
 * "At target" means reaching it, not landing exactly on it — an L5 repo has plainly met an L4 goal,
 * and counting only exact matches would make a fleet look like it was regressing as repos overshot.
 */
export function reposAtTarget(levelCounts: Record<string, number>, target: LevelId): number {
  const floor = LEVEL_ORDER.indexOf(target);
  if (floor < 0) return 0;
  return LEVEL_ORDER.slice(floor).reduce((n, id) => n + (levelCounts[id] ?? 0), 0);
}

/** Parse a stored baseline blob defensively — a malformed row degrades to "no baseline", never throws. */
export function parseBaseline(json: string | null): ProgramBaseline | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<ProgramBaseline>;
    if (!v || typeof v !== "object") return null;
    const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
    return {
      overall: num(v.overall),
      adoption: num(v.adoption),
      rigor: num(v.rigor),
      scannedCount: num(v.scannedCount) ?? 0,
      repoCount: num(v.repoCount) ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Fold a programme + today's fleet read into the strip's view model. Pure — `now` is passed in so the
 * whole thing is testable without a clock.
 *
 * Every derived field is nullable on purpose. A programme with no baseline, no scan, or nothing
 * verified still renders — it just says less. The alternative (hiding the programme until every
 * number exists) would make the thread invisible exactly when a new org most needs it.
 */
export function buildProgramStatus(program: TransitionProgramRow, live: ProgramNow, now: Date): ProgramStatusView {
  const started = new Date(program.baselineAt).getTime();
  const elapsedDays = Math.max(0, Math.floor((now.getTime() - started) / DAY_MS));
  const week = Math.floor(elapsedDays / 7) + 1;

  const baseOverall = program.baseline?.overall ?? null;
  const movedOverall = baseOverall != null && live.overall != null ? live.overall - baseOverall : null;

  // Next review: the cadence's period, counted from the start date. An achieved or paused programme
  // has no next review — printing one would invite a meeting about a thing that is finished.
  const period = CADENCE_DAYS[program.cadence];
  const daysToReview = program.status === "active" ? period - (elapsedDays % period) : null;

  const daysToTarget = program.targetDate
    ? Math.ceil((new Date(program.targetDate).getTime() - now.getTime()) / DAY_MS)
    : null;

  return {
    program,
    week,
    levelNow: live.overall != null ? (levelForScore(live.overall).id as LevelId) : null,
    levelTarget: program.targetLevel,
    movedOverall,
    atTarget: live.atTarget,
    scannedCount: live.scannedCount,
    inFlightPrs: live.inFlightPrs,
    pointsBought: live.pointsBought,
    daysToReview,
    daysToTarget,
  };
}

type ProgramDbRow = {
  id: string;
  name: string;
  targetLevel: string;
  targetDate: Date | null;
  cadence: string;
  baselineAt: Date;
  baselineJson: string | null;
  status: string;
  startedBy: string | null;
};

/** DB row → typed programme. Unknown enum values degrade to the defaults rather than throwing. */
export function toProgramRow(r: ProgramDbRow): TransitionProgramRow {
  return {
    id: r.id,
    name: r.name,
    targetLevel: isLevelId(r.targetLevel) ? r.targetLevel : "L4",
    targetDate: r.targetDate ? r.targetDate.toISOString() : null,
    cadence: isProgramCadence(r.cadence) ? r.cadence : "weekly",
    baselineAt: r.baselineAt.toISOString(),
    baseline: parseBaseline(r.baselineJson),
    status: isProgramStatus(r.status) ? r.status : "active",
    startedBy: r.startedBy,
  };
}

/**
 * The org's programme, or null. React-`cache()`d for the request — the shell reads it on every tab
 * render, so the layout's call and any page's call must collapse into one query.
 */
export const getOrgProgram = cache(async (orgSlug: string): Promise<TransitionProgramRow | null> => {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const row = await getPrisma().transitionProgram.findUnique({ where: { orgId: org.id } });
  return row ? toProgramRow(row) : null;
});

/**
 * The programme + today's numbers, assembled for the shell strip. Null when the org has no programme.
 *
 * Every input is either already in the shell's request cache (`getOrgHeaderSummary`,
 * `countInFlightPrs`) or one cheap indexed read (`getOrgImpactLedger` over merged rows since the
 * baseline), so mounting this on every tab does not reintroduce the rollup tax the shell spent
 * "Shell cost discipline" removing.
 */
export const getOrgProgramStatus = cache(async (orgSlug: string, now: Date = new Date()): Promise<ProgramStatusView | null> => {
  const program = await getOrgProgram(orgSlug);
  if (!program) return null;

  const [summary, inFlightPrs, ledger] = await Promise.all([
    getOrgHeaderSummary(orgSlug),
    countInFlightPrs(orgSlug).catch(() => 0),
    // Scoped to the programme's own window: what has this programme bought, not what the org ever did.
    getOrgImpactLedger(orgSlug, { start: new Date(program.baselineAt), end: null }).catch(() => null),
  ]);

  return buildProgramStatus(
    program,
    {
      overall: summary && summary.scannedCount > 0 ? summary.avgOverall : null,
      scannedCount: summary?.scannedCount ?? 0,
      atTarget: reposAtTarget(summary?.levelCounts ?? {}, program.targetLevel),
      inFlightPrs,
      // Already null-not-zero at the source (org-impact.ts rule 2) — carried through untouched.
      pointsBought: ledger?.dimPoints ?? null,
    },
    now,
  );
});

export interface StartProgramInput {
  name: string;
  targetLevel: LevelId;
  targetDate: Date | null;
  cadence: ProgramCadence;
  /** The fleet snapshot to freeze. Caller reads it ONCE, here, and it is never recomputed. */
  baseline: ProgramBaseline | null;
  startedBy: string | null;
}

/**
 * Create or re-target the org's programme.
 *
 * On an UPDATE the baseline and its timestamp are deliberately NOT touched: re-naming a programme or
 * moving its target date must not silently reset the origin every measurement is taken from. Only
 * `startProgram` on a fresh row captures a baseline — that is the whole contract of the column, and
 * `resetBaseline` is the explicit, separate action for when someone really does mean to re-baseline.
 */
export async function startProgram(orgSlug: string, input: StartProgramInput): Promise<TransitionProgramRow | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const row = await getPrisma().transitionProgram.upsert({
    where: { orgId: org.id },
    create: {
      orgId: org.id,
      name: input.name,
      targetLevel: input.targetLevel,
      targetDate: input.targetDate,
      cadence: input.cadence,
      baselineAt: new Date(),
      baselineJson: input.baseline ? JSON.stringify(input.baseline) : null,
      startedBy: input.startedBy,
    },
    update: {
      name: input.name,
      targetLevel: input.targetLevel,
      targetDate: input.targetDate,
      cadence: input.cadence,
      // baselineAt / baselineJson intentionally absent — see the doc comment above.
    },
  });
  return toProgramRow(row);
}

/** Move a programme through active → paused → achieved. */
export async function setProgramStatus(orgSlug: string, status: ProgramStatus): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return false;
  const done = await getPrisma().transitionProgram.updateMany({ where: { orgId: org.id }, data: { status } });
  return done.count > 0;
}

/** Delete the programme. The org keeps every scan, rec and PR — only the thread goes. */
export async function endProgram(orgSlug: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return false;
  const done = await getPrisma().transitionProgram.deleteMany({ where: { orgId: org.id } });
  return done.count > 0;
}
