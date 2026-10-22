// Playbook lift as a before/after pair with a NAMED status for every application (playbooks-0,
// challenge-2026-10-22e). Pure: no db, no clock, safe on either side of the client boundary.
//
// Registry: software-engineering / adoption-measurement, technique before-after-outcome-pairing.
//   - The boundary resolves toward AFTER. A reading AT the adoption instant is after-side: it was
//     taken of a tree the adoption may already have shaped. For a mark a rescan stamped (appliedBy
//     "scan"), the instant is the LANDING scan itself, not the stamp's own `appliedAt` (written a few
//     seconds after that scan persisted, by the reconciler that read it): that scan already carries the
//     playbook file, so it is the first AFTER reading, never the baseline.
//   - Compare only what both sides scored: the playbook's dimension present on both, neither a mock.
//     A mock reading is reported as such and never replaced by an older live scan (the latest-scan
//     door's drop-not-swap rule).
//   - Every application gets a status, and the unpaired population travels beside the delta, so an
//     unmeasurable application is reported and never shown as a 0 lift.
//
// This deliberately flips one boundary the old reader held: a scan exactly at `appliedAt` used to be
// the BASELINE (`p.at <= appliedAt`); it is now after-side.

/** The engine name a degraded or keyless scan carries (mirrors maturity/attribution.ts MOCK_ENGINE). */
const MOCK_ENGINE = "mock";

export type LiftStatus = "paired" | "no-before" | "no-after" | "mock-reading" | "no-dimension";

/** One scan as the lift reads it: when, which engine, and the playbook dimension's score (null = absent). */
export interface LiftReading {
  at: Date;
  engineProvider: string | null;
  score: number | null;
}

export interface LiftApplication {
  appliedAt: Date;
  /** The mark was stamped by the rescan that found the playbook file landed (appliedBy "scan"). */
  scanStamped: boolean;
}

export interface LiftPair {
  status: LiftStatus;
  before: number | null;
  after: number | null;
  delta: number | null;
}

/** Why the applications without a number have none. */
export interface LiftUnpaired {
  noBefore: number;
  noAfter: number;
  mock: number;
  noDimension: number;
}

export const NO_UNPAIRED: LiftUnpaired = { noBefore: 0, noAfter: 0, mock: 0, noDimension: 0 };

const unpairedPair = (status: Exclude<LiftStatus, "paired">): LiftPair => ({ status, before: null, after: null, delta: null });

/**
 * Classify one application from its two readings: the latest strictly BEFORE the boundary and the
 * latest overall when it is at-or-after the boundary. Precedence: a missing side first, then a mock
 * on either side, then a missing dimension.
 */
export function classifyPair(before: LiftReading | undefined, after: LiftReading | undefined): LiftPair {
  if (!before) return unpairedPair("no-before");
  if (!after) return unpairedPair("no-after");
  if (before.engineProvider === MOCK_ENGINE || after.engineProvider === MOCK_ENGINE) return unpairedPair("mock-reading");
  if (before.score == null || after.score == null) return unpairedPair("no-dimension");
  return { status: "paired", before: before.score, after: after.score, delta: after.score - before.score };
}

const newestFirst = (rs: readonly LiftReading[]) => [...rs].sort((a, b) => b.at.getTime() - a.at.getTime());

/** The adoption boundary: `appliedAt`, or for a scan-stamped mark the landing scan (latest reading at-or-before it). */
export function boundaryInstant(app: LiftApplication, readings: readonly LiftReading[]): Date {
  if (!app.scanStamped) return app.appliedAt;
  const landing = newestFirst(readings).find((r) => r.at.getTime() <= app.appliedAt.getTime());
  return landing?.at ?? app.appliedAt;
}

/** The pairing rule over a repo's whole series (the statement the db door realizes in two reads). */
export function pair(app: LiftApplication, readings: readonly LiftReading[]): LiftPair {
  const t = boundaryInstant(app, readings).getTime();
  const sorted = newestFirst(readings);
  const before = sorted.find((r) => r.at.getTime() < t);
  const latest = sorted[0];
  const after = latest && latest.at.getTime() >= t ? latest : undefined;
  return classifyPair(before, after);
}

/** Fold the per-application pairs: the rounded mean of the paired deltas, and the unpaired count by reason. */
export function foldLift(pairs: readonly LiftPair[]): { lift: number | null; measured: number; unpaired: LiftUnpaired } {
  const unpaired = { ...NO_UNPAIRED };
  let sum = 0;
  let measured = 0;
  for (const p of pairs) {
    if (p.status === "paired") {
      sum += p.delta ?? 0;
      measured += 1;
    } else if (p.status === "no-before") unpaired.noBefore += 1;
    else if (p.status === "no-after") unpaired.noAfter += 1;
    else if (p.status === "mock-reading") unpaired.mock += 1;
    else unpaired.noDimension += 1;
  }
  return { lift: measured > 0 ? Math.round(sum / measured) : null, measured, unpaired };
}

/** The sample beside the number, as one line: the measured share, then every non-empty unpaired reason. */
export function liftSampleNote({ measured, repos, unpaired = NO_UNPAIRED }: { measured: number; repos: number; unpaired?: LiftUnpaired }): string {
  const parts = [`measured in ${measured} of ${repos}`];
  if (unpaired.noAfter > 0) parts.push(`${unpaired.noAfter} not re-scanned since`);
  if (unpaired.noBefore > 0) parts.push(`${unpaired.noBefore} adopted before their first scan`);
  if (unpaired.mock > 0) parts.push(`${unpaired.mock} mock scan${unpaired.mock === 1 ? "" : "s"} excluded`);
  if (unpaired.noDimension > 0) parts.push(`${unpaired.noDimension} without the dimension scored`);
  return parts.join(" · ");
}
