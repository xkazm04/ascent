// Named PR-signal thresholds AND the published-rate contract (`QualifiedRate` below), shared by the
// analyzer and the report UI so the presentation layer can't silently drift from what the analyzer
// actually measures. Kept in this tiny standalone module (not pulls.ts) because the report panel is
// bundled client-side via ContributorsPanel, and pulls.ts drags in the server-only GitHub GraphQL
// client.

/**
 * A "small PR" is one with ≤ this many changed lines (additions + deletions). ~200 lines is the
 * common review-ergonomics ceiling (beyond it review quality measurably drops); the analyzer counts
 * `smallPrRate` against it and the scoring prompt/UI copy must quote the same number.
 */
export const SMALL_PR_MAX_LINES = 200;

/**
 * Revert rate (%) above which the report flags reverts as "elevated". The score itself penalizes
 * reverts on a continuous ramp (`100 - revertRate * 6` in pulls.ts) — this is a UI-only attention
 * threshold: past ~10% of recent PRs being reverts, instability is a pattern worth calling out,
 * not noise. Strictly-greater-than: 10% exactly is still unflagged.
 */
export const REVERT_RATE_ELEVATED = 10;

/**
 * Approvals landing within this many minutes of the PR opening are counted as "fast approvals"
 * (`fastApproval`) and reported SEPARATELY from review coverage.
 *
 * THE THRESHOLD IS THE WHOLE METRIC, so state the reasoning. 5 minutes replaced no metric at all —
 * time-to-first-review was collected per PR and thrown away after the median, so an org that had
 * automated its way to 100% coverage with instant approvals was indistinguishable from one doing
 * real review on the exact number leadership reads as a quality control. Candidates considered:
 *   60 seconds — reports ~zero everywhere, so it detects nothing and the metric dies unread;
 *   1 hour     — a genuinely fast review of a one-line fix lands well inside an hour, so most of
 *                what it flags is good practice, and the number becomes an accusation about people.
 * 5 minutes is the span in which no reviewer can have read a diff at the ≤200-line ceiling
 * `SMALL_PR_MAX_LINES` sets, while still being long enough for a real skim of a trivial change to
 * escape it. The trade-off accepted: a genuine one-character-typo approval inside 5 minutes IS
 * counted, which is why this ships as a signal carrying its own basis (see `RATE_BASIS.fastApproval`)
 * and never as a verdict, and why the numerator excludes self-approvals — those are already reported
 * by `selfApproved` and must not be counted as evidence twice.
 */
export const FAST_APPROVAL_MAX_MINUTES = 5;

/**
 * Minimum denominator before the review-integrity rates (`selfApproved`, `fastApproval`) are
 * published at all — the SAME >= 5 floor `reviewedRate` / `aiGovernedRate` enforce in pulls.ts, for
 * the same statistical reason: at 1–4 pull requests one PR swings the rate 25–100 points. Below it
 * `ratePercent` returns null ("not measurable"), never a fabricated 0 and never a "67% of this team
 * rubber-stamps" read off three pull requests.
 */
export const REVIEW_INTEGRITY_MIN_SAMPLE = 5;

// ── The published-rate contract ───────────────────────────────────────────────────────────────────
//
// A count travels with its predicate, or it will be reused for a claim it does not support. Rates
// used to ship out of the analyzer as bare percentages (`smallPrRate: 62`) with the denominator, the
// exclusions, the sample size and — for the multi-channel AI signal — the per-channel precision left
// behind in the module that computed them. "62%" then reaches a customer-facing report with no way
// for the reader to know it meant "62% of the 34 pull requests we could analyse, excluding
// bot-authored ones" and not "62% of everything this team shipped".
//
// The fix is structural, not documentary: `QualifiedRate` HAS NO PERCENT FIELD. There is nothing to
// render bare. The percentage exists only as the return of `ratePercent` / `rateReading`, which
// cannot be reached without the object carrying the basis — and which return null under the rate's
// own sample floor, so the floor travels with the number too.
//
// WHAT IS PERSISTED vs WHAT LIVES IN CODE: the wire object is `{ id, count, population, defVersion }`
// (~80 bytes) and the prose lives in `RATE_BASIS` here, because this module is already the shared
// analyzer↔UI contract every render site imports. `defVersion` is what keeps that split honest: a
// stored rate computed under an older definition renders with a stated warning rather than being
// silently re-described by today's prose. The version is deliberately GLOBAL — one predicate change
// marks every rate in that scan as "possibly an earlier definition", which over-warns rather than
// under-warns, and that is the direction to err in.
//
// ONE DELIBERATE EXCEPTION to that split: `channels` (per-channel counts AND their precision prose)
// IS persisted, ~400 bytes on the one multi-channel rate. A channel's precision is the qualifier a
// reader holding only the payload is least able to reconstruct and most likely to need — "31%
// AI-involved" of which 9 rest on a bare 🤖 in a body — and persisting it means it describes the
// channels as they were when the number was measured, rather than as they are defined today.

/** Bump on ANY change to a numerator predicate, denominator population, exclusion or sample floor in
 *  `RATE_BASIS`. Stamped on every rate the analyzer emits; see the note above for why it is global. */
export const RATE_BASIS_VERSION = 1;

/** The rates the analyzer publishes through the qualified contract. */
export type RateBasisId =
  | "smallPr"
  | "botAuthored"
  | "aiInvolved"
  | "revert"
  | "reviewed"
  | "aiGoverned"
  | "selfApproved"
  | "fastApproval";

/** One detection channel behind a multi-channel numerator, with how far the reader should trust it. */
export interface RateChannel {
  /** Channel name, as the reader should see it. */
  name: string;
  /** Pull requests this channel contributed to the numerator. */
  count: number;
  /** `exact` — a machine-emitted artifact (a bot identity, a commit trailer). `heuristic` — a text
   *  match anyone can type, and which is absent from plenty of work that really was AI-assisted. */
  precision: "exact" | "heuristic";
  /** What the channel actually matches, so a reader can discount it themselves. */
  matches: string;
}

/** Everything a reader needs in order to read the number correctly. Static per rate id; not persisted. */
export interface RateBasis {
  /** What the numerator counts. */
  numerator: string;
  /** The population the denominator is drawn from, INCLUDING its window. */
  population: string;
  /** What that population deliberately leaves out. Empty = nothing is excluded, which is itself a
   *  statement the reader is entitled to. */
  exclusions: readonly string[];
  /** Denominator below which the rate is not published at all; null = no floor. */
  minSample: number | null;
  /** How far the number may be pushed — present on signals routinely misread as verdicts. */
  caveat?: string;
}

/**
 * A rate as it is published. No percent field by construction: see the contract note above.
 * `count`/`population` are the raw numerator and denominator, so a reader can always rebuild the
 * fraction and can always see how large the sample was.
 */
export interface QualifiedRate {
  id: RateBasisId;
  count: number;
  population: number;
  /** `RATE_BASIS_VERSION` as it stood when the rate was computed. */
  defVersion: number;
  /** Per-channel breakdown of a multi-channel numerator (today: `aiInvolved`). */
  channels?: RateChannel[];
}

const WINDOW = "in the scanned window";

export const RATE_BASIS: Record<RateBasisId, RateBasis> = {
  smallPr: {
    numerator: `pull requests with at most ${SMALL_PR_MAX_LINES} changed lines (additions + deletions)`,
    population: `pull requests analysed ${WINDOW}`,
    exclusions: [],
    minSample: null,
  },
  botAuthored: {
    numerator: "pull requests opened by a GitHub App or bot account",
    population: `pull requests analysed ${WINDOW}`,
    exclusions: [],
    minSample: null,
  },
  aiInvolved: {
    numerator: "pull requests matched by any AI-involvement channel (see channels)",
    population: `pull requests analysed ${WINDOW}`,
    exclusions: [],
    minSample: null,
  },
  revert: {
    numerator: 'pull requests whose title starts with "Revert"',
    population: `pull requests analysed ${WINDOW}`,
    exclusions: [],
    minSample: null,
    caveat: "title-matched only — a renamed revert is missed, so this is a lower bound, not a census",
  },
  reviewed: {
    numerator: "pull requests that received an approving review",
    population: `human-authored merged pull requests ${WINDOW}`,
    exclusions: ["bot-authored pull requests (an auto-merge does not evidence review discipline)"],
    minSample: 5,
  },
  aiGoverned: {
    numerator: "AI-involved pull requests that received an approving review",
    population: `AI-involved pull requests ${WINDOW}`,
    exclusions: [],
    minSample: 5,
  },
  selfApproved: {
    numerator: "merged pull requests approved by their own author",
    population: `human-authored merged pull requests ${WINDOW}`,
    exclusions: [
      "bot-authored pull requests",
      "approvals from bot and AI-review accounts (a legitimate automerge app is not a self-approval)",
    ],
    minSample: REVIEW_INTEGRITY_MIN_SAMPLE,
    caveat:
      "self-approval is normal and legitimate in a single-maintainer repository — this is the count that makes a review-coverage rate readable, not a finding on its own",
  },
  fastApproval: {
    numerator: `merged pull requests whose first human approval landed within ${FAST_APPROVAL_MAX_MINUTES} minutes of opening`,
    population: `human-authored merged pull requests that received a human approval, ${WINDOW}`,
    exclusions: [
      "bot-authored pull requests",
      "approvals from bot and AI-review accounts (AI pre-review is measured by aiPreReviewedRate)",
      "self-approvals (already reported by selfApproved — one pull request must not be counted as evidence twice)",
    ],
    minSample: REVIEW_INTEGRITY_MIN_SAMPLE,
    caveat:
      "a fast approval is not proof of a rubber stamp — a one-line fix can be reviewed properly in a minute; read it as a share to ask about, not a verdict on reviewers",
  },
};

/** Build a rate at the current definition version. The only constructor, so nothing can emit a count
 *  without an id that resolves to its predicate. */
export function qualifiedRate(
  id: RateBasisId,
  count: number,
  population: number,
  channels?: RateChannel[],
): QualifiedRate {
  return { id, count, population, defVersion: RATE_BASIS_VERSION, ...(channels ? { channels } : {}) };
}

/**
 * The percentage — or null when it must not be published: an empty population, or one under the
 * rate's own sample floor. Null means "not measurable", never a fabricated 0, exactly as the
 * nullable scalar rates in pulls.ts already behave.
 */
export function ratePercent(rate: QualifiedRate | null | undefined): number | null {
  if (!rate || !Number.isFinite(rate.count) || !Number.isFinite(rate.population)) return null;
  const floor = Math.max(1, RATE_BASIS[rate.id]?.minSample ?? 1);
  if (rate.population < floor) return null;
  return Math.round((rate.count / rate.population) * 100);
}

/** The qualifier as one sentence, always carrying the real counts. */
export function rateBasisText(rate: QualifiedRate): string {
  const basis = RATE_BASIS[rate.id];
  const parts = [`${rate.count} of ${rate.population} ${basis.population} — ${basis.numerator}`];
  if (basis.exclusions.length) parts.push(`excludes ${basis.exclusions.join("; ")}`);
  if (rate.channels?.length) {
    parts.push(`channels: ${rate.channels.map((c) => `${c.name} ${c.count} (${c.precision}: ${c.matches})`).join("; ")}`);
  }
  if (basis.minSample != null && rate.population < basis.minSample) {
    parts.push(`below the ${basis.minSample}-sample floor, so no percentage is published`);
  }
  if (basis.caveat) parts.push(basis.caveat);
  if (rate.defVersion !== RATE_BASIS_VERSION) {
    parts.push("measured under an earlier definition of this rate, which may differ from the one described here");
  }
  return `${parts.join(". ")}.`;
}

/**
 * The one call a render site makes. Returns the number and its qualifier TOGETHER — a caller that
 * wants the figure necessarily holds the sentence qualifying it in the same object, and `label` is
 * the two already joined for the common case.
 */
export function rateReading(rate: QualifiedRate): { percent: number | null; basis: string; label: string } {
  const percent = ratePercent(rate);
  const basis = rateBasisText(rate);
  return { percent, basis, label: percent === null ? `not measurable — ${basis}` : `${percent}% (${basis})` };
}

/** Every qualified rate the analyzer publishes, keyed by id. Rides inside the existing `prStats`
 *  blob; absent on every scan written before this contract, which a consumer must render as an
 *  unknown population rather than inventing one from the bare scalar rate beside it. */
export type PrRateBook = Partial<Record<RateBasisId, QualifiedRate>>;
