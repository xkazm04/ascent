// Adoption → outcome loop (ported from the Personas outcome pattern): did adopting a skill actually move
// the repo's readiness score? For every OrgSkillAdoption (skill, repo, adoptedAt) we pair the LATEST scan
// strictly BEFORE the adoption with the LATEST scan at-or-after it and report the overall-score delta
// (plus per-dimension deltas, which ride along free on the history read).
//
// The honesty rule is the whole design: when either side of the pair is missing — or when the two sides
// were not produced by the same instrument (`instrument-mismatch` / `instrument-unknown`, see D11 below)
// — the result is an explicit named status with NULL deltas. A skill adopted into a never-scanned repo,
// or adopted five minutes ago, has no measurable effect yet — inventing one (comparing to the org mean,
// to the first scan, to zero) would turn the library into a lie generator. Even a real delta is
// CORRELATION, not proof: other work lands in the same window. Label it as movement since adoption.
//
// Pairing is pure (pairScansAroundAdoption / skillOutcomesFor) and unit-tested; the DB half just feeds it
// getRepositoryHistory (src/lib/db/scans-read.ts) once per distinct repo.

// Dependency-free on purpose: this module is imported by client components, so it must never pull a
// runtime `@/lib/db` symbol into the browser bundle. Its inputs are structural types and every read
// lives in skill-outcomes-load.ts.

/**
 * `measured` = both sides exist AND both were produced by the same instrument. Everything else is an
 * honest gap, never a fabricated 0:
 *   no-before-scan / no-after-scan — one side of the pair does not exist
 *   instrument-mismatch           — both exist but were scored under different rubric/engine identities
 *   instrument-unknown            — at least one side does not record which instrument produced it
 */
export type OutcomeStatus =
  | "measured"
  | "no-before-scan"
  | "no-after-scan"
  | "instrument-mismatch"
  | "instrument-unknown";

/** The minimum a paired scan contributes — `HistoryPoint` satisfies it structurally. */
export interface OutcomeScan {
  id: string;
  scannedAt: string;
  overallScore: number;
  dimensions?: { dimId: string; score: number }[];
  /** SCORING_RUBRIC_VERSION active when this scan was scored (src/lib/maturity/model.ts). Optional
   *  because legacy rows genuinely do not carry it — absent is treated as UNKNOWN, never as "same". */
  rubricVersion?: string | null;
  /** The scoring engine family ("mock" for a deterministic-floor scan, else the LLM provider). */
  engineProvider?: string | null;
}

export interface DimensionDelta {
  dimId: string;
  before: number;
  after: number;
  delta: number;
}

export interface SkillOutcome {
  skillId: string;
  repoFullName: string;
  adoptedAt: string;
  status: OutcomeStatus;
  before: { id: string; scannedAt: string; overallScore: number } | null;
  after: { id: string; scannedAt: string; overallScore: number } | null;
  /** after − before overall score. Null unless `status === "measured"`. */
  overallDelta: number | null;
  /** Per-dimension movement for dimensions present on BOTH scans, biggest mover first. */
  dimensionDeltas: DimensionDelta[];
  /** Whole days from the "before" scan to the adoption instant (null when there is no before scan). */
  beforeGapDays: number | null;
  /** Whole days from the adoption instant to the "after" scan (null when there is no after scan). */
  afterGapDays: number | null;
  /** False when either gap exceeds the pairing bound — the delta is still reported, but a consumer that
   *  shows the number must show this beside it. Null when the pair is incomplete. */
  withinPairingBound: boolean | null;
  /** The instrument identity both sides had to agree on, when both sides declared one. */
  instrument: { rubricVersion: string; engineProvider: string } | null;
}

/** Why a delta is missing (or how far apart the pair sits), in one line for the UI. */
export function outcomeStatusLabel(status: OutcomeStatus): string {
  switch (status) {
    case "measured":
      return "Scored before and after adoption, by the same instrument";
    case "no-before-scan":
      return "No scan before adoption, nothing to compare against";
    case "no-after-scan":
      return "No scan since adoption yet";
    case "instrument-mismatch":
      return "Scored under different rubric versions — the two scores are not comparable";
    case "instrument-unknown":
      return "One side does not record which rubric scored it — comparability unknown";
  }
}

// ── Instrument identity (D11) ────────────────────────────────────────────────────────────────────
// A before/after delta is only a statement about the PRACTICE if both scores came off the same
// instrument. SCORING_RUBRIC_VERSION has already moved r6→r7 (weights and detectors both changed), and
// a "mock" deterministic-floor scan and an LLM-scored one are not the same instrument either. Before
// this check, `overallDelta` subtracted them anyway: the library reported "adopting this practice moved
// the score +8" when some or all of the 8 was a re-weighting. (`dimensionDeltas` was always protected by
// its dimension intersection; the headline number was not.)
//
// UNKNOWN IS NOT "SAME". Legacy scans carry no `rubricVersion`, so most historical pairs now land in
// `instrument-unknown` rather than `measured`. That is the intended cost: silence about provenance is
// not evidence of comparability, and an honest named status is worth more than a number that is partly
// instrument drift. The pairing itself is unchanged, so the strip still renders the row with its reason.
//
// `engineModel` is deliberately NOT compared. Swapping sonnet→opus inside the same provider is real
// noise, but treating it as a mismatch would void nearly every pair for a signal the rubric version
// already dominates; provider is the coarse cut that separates mock from live scoring.

/**
 * Rubric versions declared score-comparable with each other. **Deliberately empty**: declaring
 * "r6 ≈ r7" requires evidence that the re-weighting did not move scores, and nobody has produced it.
 * An unjustified entry here would re-introduce exactly the silent error above under a legitimizing
 * label, so a version is comparable only with itself until an equivalence is earned.
 */
export const COMPARABLE_RUBRIC_GROUPS: readonly (readonly string[])[] = [];

function rubricsComparable(a: string, b: string): boolean {
  if (a === b) return true;
  return COMPARABLE_RUBRIC_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

/** `true` = same instrument, `false` = provably different, `null` = at least one side is silent. */
function sameInstrument(before: OutcomeScan, after: OutcomeScan): boolean | null {
  const br = before.rubricVersion;
  const ar = after.rubricVersion;
  const bp = before.engineProvider;
  const ap = after.engineProvider;
  if (!br || !ar || !bp || !ap) return null;
  return rubricsComparable(br, ar) && bp === ap;
}

/**
 * Maximum distance, in days, between the adoption instant and either scan of a pair. 180 days = two
 * quarters, chosen as the longest span over which a repo's engineering context is still recognisably
 * the same one; it replaces NO bound at all, where an eighteen-month-old "before" scan was selected as
 * readily as last week's and a year and a half of unrelated work was attributed to one practice.
 *
 * Trade-off taken deliberately: this FLAGS, it does not filter. Filtering on a bound this repo has no
 * calibration data for would empty the outcomes view in one commit, so the honest first step is to make
 * the distances travel beside the number. Override per call via `skillOutcomeFor(..., { maxPairingDistanceDays })`.
 */
export const PAIRING_MAX_DISTANCE_DAYS = 180;

const DAY_MS = 86_400_000;
const daysApart = (a: number, b: number) => Math.floor(Math.abs(a - b) / DAY_MS);

const scanTime = (s: { scannedAt: string }) => Date.parse(s.scannedAt);

/**
 * Latest scan strictly before `adoptedAt`, and the latest scan at-or-after it. Input order does not
 * matter (history comes back newest-first; tests feed either). A scan taken at the exact adoption
 * instant counts as AFTER — the adoption is the boundary, and the "before" side must be a state the
 * skill provably could not have influenced.
 */
export function pairScansAroundAdoption<T extends OutcomeScan>(
  scans: T[],
  adoptedAt: string,
): { before: T | null; after: T | null } {
  const at = Date.parse(adoptedAt);
  if (!Number.isFinite(at)) return { before: null, after: null };
  let before: T | null = null;
  let after: T | null = null;
  for (const s of scans) {
    const t = scanTime(s);
    if (!Number.isFinite(t)) continue;
    if (t < at) {
      if (!before || scanTime(before) < t) before = s;
    } else if (!after || scanTime(after) < t) after = s;
  }
  return { before, after };
}

/** Per-dimension movement for dimensions scored on both sides, largest absolute move first. */
function dimensionDeltas(before: OutcomeScan, after: OutcomeScan): DimensionDelta[] {
  const b = new Map((before.dimensions ?? []).map((d) => [d.dimId, d.score]));
  const out: DimensionDelta[] = [];
  for (const d of after.dimensions ?? []) {
    const prev = b.get(d.dimId);
    if (prev === undefined) continue; // a dimension only one side scored isn't a movement
    out.push({ dimId: d.dimId, before: prev, after: d.score, delta: d.score - prev });
  }
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

const lite = (s: OutcomeScan) => ({ id: s.id, scannedAt: s.scannedAt, overallScore: s.overallScore });

export interface OutcomeOptions {
  /** Override for {@link PAIRING_MAX_DISTANCE_DAYS} — see that constant for the basis of the default. */
  maxPairingDistanceDays?: number;
}

/** The pure core: one adoption + that repo's scan history → an outcome (or an honest gap). */
export function skillOutcomeFor(
  adoption: { skillId: string; repoFullName: string; adoptedAt: string },
  scans: OutcomeScan[],
  opts: OutcomeOptions = {},
): SkillOutcome {
  const { before, after } = pairScansAroundAdoption(scans, adoption.adoptedAt);
  const at = Date.parse(adoption.adoptedAt);
  const bound = opts.maxPairingDistanceDays ?? PAIRING_MAX_DISTANCE_DAYS;
  const gap = (s: OutcomeScan | null) =>
    s && Number.isFinite(at) && Number.isFinite(scanTime(s)) ? daysApart(scanTime(s), at) : null;
  const beforeGapDays = gap(before);
  const afterGapDays = gap(after);

  const same = before && after ? sameInstrument(before, after) : null;
  const status: OutcomeStatus = !before
    ? "no-before-scan"
    : !after
      ? "no-after-scan"
      : same === null
        ? "instrument-unknown"
        : !same
          ? "instrument-mismatch"
          : "measured";
  const comparable = status === "measured" && before !== null && after !== null;
  return {
    ...adoption,
    status,
    before: before ? lite(before) : null,
    after: after ? lite(after) : null,
    // Both deltas are gated on the SAME comparability test: a mismatched instrument invalidates the
    // per-dimension movement for exactly the reason it invalidates the headline (a re-weighted or
    // re-detected dimension is a different measurement, not a change in the repo).
    overallDelta: comparable ? after!.overallScore - before!.overallScore : null,
    dimensionDeltas: comparable ? dimensionDeltas(before!, after!) : [],
    beforeGapDays,
    afterGapDays,
    withinPairingBound:
      beforeGapDays === null || afterGapDays === null ? null : beforeGapDays <= bound && afterGapDays <= bound,
    instrument:
      comparable && after!.rubricVersion && after!.engineProvider
        ? { rubricVersion: after!.rubricVersion, engineProvider: after!.engineProvider }
        : null,
  };
}

/** Fold a whole org's adoptions against a repo→scans lookup. Pure — the fetching is the caller's. */
export function skillOutcomesFor(
  adoptions: { skillId: string; repoFullName: string; adoptedAt: string }[],
  scansByRepo: Map<string, OutcomeScan[]>,
  opts: OutcomeOptions = {},
): Record<string, SkillOutcome[]> {
  const out: Record<string, SkillOutcome[]> = {};
  for (const a of adoptions) {
    const outcome = skillOutcomeFor(a, scansByRepo.get(a.repoFullName) ?? [], opts);
    (out[a.skillId] ??= []).push(outcome);
  }
  return out;
}

/** The single headline an org card wants: the measured outcomes for a skill, best movement first. */
export function measuredOutcomes(outcomes: SkillOutcome[] | undefined): SkillOutcome[] {
  return (outcomes ?? [])
    .filter((o) => o.status === "measured" && o.overallDelta !== null)
    .sort((a, b) => (b.overallDelta ?? 0) - (a.overallDelta ?? 0));
}

// ── Aggregation (D34) ────────────────────────────────────────────────────────────────────────────
// A mean delta over the adoptions that HAPPENED to be re-scanned is where selection bias enters the
// summary: if the repos that got a scan after adoption are the ones already being actively worked, the
// mean measures engagement, not the practice. The excluded population is therefore not an optional
// footnote — `meanDelta` lives INSIDE this object and is reachable no other way, so a consumer cannot
// obtain the number without also holding the counts that qualify it. `coverageLabel` renders them as
// COVERAGE ("11 of 54 adoptions measured"), never as a confidence score.

export interface OutcomeAggregate {
  /** Mean of `overallDelta` over comparable pairs only. Null when nothing is comparable. */
  meanDelta: number | null;
  /** Adoptions the mean is computed over. */
  measured: number;
  /** Adoptions the mean EXCLUDED, and why. */
  unpaired: number;
  byStatus: Record<OutcomeStatus, number>;
  /** Every adoption considered — `measured + unpaired`. */
  total: number;
  /** Measured pairs whose scans sit further from the adoption than the pairing bound allows. */
  outsidePairingBound: number;
}

const EMPTY_BY_STATUS = (): Record<OutcomeStatus, number> => ({
  measured: 0,
  "no-before-scan": 0,
  "no-after-scan": 0,
  "instrument-mismatch": 0,
  "instrument-unknown": 0,
});

/** Mean movement across a set of adoptions, carrying the population it could not measure. */
export function aggregateOutcomes(outcomes: SkillOutcome[] | undefined): OutcomeAggregate {
  const all = outcomes ?? [];
  const byStatus = EMPTY_BY_STATUS();
  let sum = 0;
  let measured = 0;
  let outsidePairingBound = 0;
  for (const o of all) {
    byStatus[o.status] += 1;
    if (o.status === "measured" && o.overallDelta !== null) {
      sum += o.overallDelta;
      measured += 1;
      if (o.withinPairingBound === false) outsidePairingBound += 1;
    }
  }
  return {
    meanDelta: measured > 0 ? Math.round((sum / measured) * 10) / 10 : null,
    measured,
    unpaired: all.length - measured,
    byStatus,
    total: all.length,
    outsidePairingBound,
  };
}

/** The coverage sentence that must appear wherever `meanDelta` appears. */
export function coverageLabel(a: OutcomeAggregate): string {
  if (a.total === 0) return "No adoptions to measure yet";
  const gaps: string[] = [];
  if (a.byStatus["no-after-scan"]) gaps.push(`${a.byStatus["no-after-scan"]} with no scan since adoption`);
  if (a.byStatus["no-before-scan"]) gaps.push(`${a.byStatus["no-before-scan"]} with no scan before it`);
  const instrument = a.byStatus["instrument-unknown"] + a.byStatus["instrument-mismatch"];
  if (instrument) gaps.push(`${instrument} not comparable across rubric versions`);
  return `${a.measured} of ${a.total} adoptions measured${gaps.length ? ` — ${gaps.join(", ")}` : ""}`;
}

/** The mean and its coverage as ONE string, so neither can be rendered without the other. */
export function meanDeltaLine(a: OutcomeAggregate): string {
  const head = a.meanDelta === null ? "No comparable before/after pair" : `${a.meanDelta > 0 ? "+" : ""}${a.meanDelta} pts mean`;
  return `${head} · ${coverageLabel(a)}`;
}
