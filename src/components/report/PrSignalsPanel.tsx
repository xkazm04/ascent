import type { AiChangeRecord, ScanReport } from "@/lib/types";
import {
  FAST_APPROVAL_MAX_MINUTES,
  RATE_BASIS,
  rateReading,
  REVIEW_INTEGRITY_MIN_SAMPLE,
  REVERT_RATE_ELEVATED,
  SMALL_PR_MAX_LINES,
  type PrRateBook,
  type RateBasisId,
} from "@/lib/analyze/pr-thresholds";
import { scoreHex } from "@/lib/ui";
import { Kicker, Surface } from "@/components/ui";

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return "<1h";
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/** A figure as this panel renders it: the number, and the sentence that says what it is a share of. */
interface Reading {
  value: string;
  /** For the color ramp only; null = not measurable, which renders uncolored. */
  percent: number | null;
  hint: string;
  /** The full qualifier. Absent only for a pre-contract scan, where it is genuinely unknown. */
  basis?: string;
}

/**
 * Read one rate through the qualified contract (`rateReading`), which hands back the percentage and
 * its basis TOGETHER — the denominator, the exclusions, the sample floor and any caveat — so nothing
 * on this panel can render a percentage stripped of what it is a percentage OF. Below the rate's own
 * sample floor `rateReading` returns a null percent, and this shows "n/a", never a fabricated 0.
 *
 * `fallback` is the historical bare scalar, used ONLY when the scan predates the rate book
 * (`stats.rates` absent). Such a scan really has no recorded basis, so the tile shows the number with
 * the short static hint and no qualifier — that is the honest reading, and inventing a denominator
 * for it (e.g. assuming `analyzed`) is exactly the misreading the contract exists to prevent.
 */
function read(rates: PrRateBook | undefined, id: RateBasisId, hint: string, fallback: number | null): Reading {
  const rate = rates?.[id];
  if (!rate) return { value: fallback == null ? "n/a" : `${fallback}%`, percent: fallback, hint };
  const { percent, basis } = rateReading(rate);
  return {
    value: percent == null ? "n/a" : `${percent}%`,
    percent,
    hint: `${rate.count} of ${rate.population} · ${hint}`,
    basis,
  };
}

/**
 * Merge rate is still a scalar (decided = merged + closed-unmerged). Until it joins the rate book,
 * apply the same ≥5 floor as reviewedRate so a 1-of-1 100% cannot publish as a mature process.
 */
function mergeReading(stats: { merged: number; closedUnmerged: number; mergeRate: number }): Reading {
  const decided = stats.merged + stats.closedUnmerged;
  const floor = REVIEW_INTEGRITY_MIN_SAMPLE;
  if (decided < floor) {
    return {
      value: "n/a",
      percent: null,
      hint: `${stats.merged} of ${decided} · below the ${floor}-sample floor`,
      basis: `${stats.merged} of ${decided} decided pull requests (merged + closed unmerged), below the ${floor}-sample floor, so no percentage is published.`,
    };
  }
  return { value: `${stats.mergeRate}%`, percent: stats.mergeRate, hint: "vs closed unmerged" };
}

function PrMetric({
  label,
  value,
  color,
  hint,
  basis,
  elevated = false,
}: {
  label: string;
  value: string;
  color?: string;
  hint?: string;
  /** The rate's qualifier. Exposed on hover AND to assistive tech — never hover-only, since it is
   *  what makes the number readable rather than decoration. */
  basis?: string;
  /** Flags a metric whose value crossed a concerning threshold. The warn COLOR alone can't carry that
   *  signal (WCAG 1.4.1) — a colorblind or low-contrast reader gets no cue — so we render an explicit
   *  "▲ elevated" glyph+text marker in addition to the tint, never instead of it. */
  elevated?: boolean;
}) {
  return (
    <div className="rounded-xl border border-divider bg-slate-950/40 p-3" title={basis}>
      <Kicker tone="muted">{label}</Kicker>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono type-title font-bold tabular-nums" style={{ color: color ?? "#fff" }}>
          {value}
        </span>
        {elevated && (
          <span
            className="type-label font-semibold tracking-wide"
            style={{ color: "var(--color-warn)" }}
          >
            <span aria-hidden>▲ </span>elevated
          </span>
        )}
      </div>
      {hint && <div className="mt-0.5 type-body-sm text-slate-500">{hint}</div>}
      {basis && <span className="sr-only">{basis}</span>}
    </div>
  );
}

const AI_SIGNAL_LABEL: Record<AiChangeRecord["aiSignal"], string> = {
  authored: "agent-authored",
  marked: "AI-marked",
  trailer: "trailer",
};

function approvalPhrase(c: AiChangeRecord): string {
  if (c.approved) return c.approverLogin ? `approved by ${c.approverLogin}` : "approved";
  return c.reviewCount > 0 ? "unapproved" : "unreviewed";
}

export function PrSignalsPanel({
  stats,
  aiChanges,
}: {
  stats: NonNullable<ScanReport["prStats"]>;
  /** Evidence rows behind the AI rates. Undefined/empty = omit (never a fabricated 0). */
  aiChanges?: ScanReport["aiChanges"];
}) {
  const rates = stats.rates;
  const reviewed = read(rates, "reviewed", "human PRs reviewed", stats.reviewedRate);
  const merge = mergeReading(stats);
  const smallPr = read(rates, "smallPr", `≤${SMALL_PR_MAX_LINES} lines`, stats.smallPrRate);
  const revert = read(rates, "revert", "reverted PRs", stats.revertRate);
  const aiInvolved = read(rates, "aiInvolved", "AI-involved", stats.aiInvolvedRate);
  const aiGoverned = read(rates, "aiGoverned", "reviewed", stats.aiGovernedRate);
  // The two review-integrity signals exist only in the rate book (no scalar predates them), so an
  // older scan simply doesn't show them rather than showing a zero it never measured.
  const selfApproved = rates?.selfApproved;
  const fastApproval = rates?.fastApproval;
  const fastReading = fastApproval ? rateReading(fastApproval) : null;
  return (
    <Surface radius="2xl" className="p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="type-lede font-semibold text-white">Pull request signals</h2>
          <p className="mt-1 type-body text-slate-400">
            How systematically the team ships, based on the {stats.analyzed} most recent of {stats.totalCount} PRs.
          </p>
        </div>
        {(aiInvolved.percent ?? 0) > 0 && (
          <span
            className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 type-mono-sm text-accent"
            title={aiInvolved.basis}
          >
            {aiInvolved.value} AI-involved
            {aiGoverned.percent != null && ` · ${aiGoverned.value} reviewed`}
          </span>
        )}
      </div>
      {/* Rate metrics (review coverage / merge rate / small PRs) reuse scoreHex's L1–L5 maturity
          ramp purely as a good→bad color scale — a familiar red→green gradient, NOT a claim that
          e.g. a 60% small-PR rate is "Defined"-tier. The thresholds that actually move the score
          live in pulls.ts (prScore); this coloring is presentation only. */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <PrMetric
          label="Review coverage"
          value={reviewed.value}
          color={reviewed.percent == null ? undefined : scoreHex(reviewed.percent)}
          hint={reviewed.percent == null && !rates ? "no human-merged PRs" : reviewed.hint}
          basis={reviewed.basis}
        />
        {/* Merge rate has no qualified counterpart: its denominator is the DECIDED PRs
            (merged + closed-unmerged), not the analyzed window, and the analyzer publishes it only
            as a scalar. Until it joins the book, mergeReading still applies the same ≥5 floor. */}
        <PrMetric
          label="Merge rate"
          value={merge.value}
          color={merge.percent == null ? undefined : scoreHex(merge.percent)}
          hint={merge.hint}
          basis={merge.basis}
        />
        <PrMetric
          label="Small PRs"
          value={smallPr.value}
          color={smallPr.percent == null ? undefined : scoreHex(smallPr.percent)}
          hint={smallPr.hint}
          basis={smallPr.basis}
        />
        <PrMetric label="Time to merge" value={fmtHours(stats.medianHoursToMerge)} hint="median" />
        <PrMetric label="Time to review" value={fmtHours(stats.medianHoursToFirstReview)} hint="median 1st" />
        <PrMetric
          label="Revert rate"
          value={revert.value}
          color={revert.percent != null && revert.percent > REVERT_RATE_ELEVATED ? "var(--color-warn)" : "#fff"}
          elevated={revert.percent != null && revert.percent > REVERT_RATE_ELEVATED}
          hint={revert.hint}
          basis={revert.basis}
        />
      </div>
      {(selfApproved || fastApproval) && (
        <div className="mt-4">
          <Kicker tone="muted">Review integrity</Kicker>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {selfApproved && (
              // Rendered as a COUNT, not a rate, on purpose: it is the figure that makes the review
              // coverage above readable ("82% reviewed — of which 9 by the author"), and a percentage
              // invites "9% of this team rubber-stamps" off a handful of PRs.
              <PrMetric
                label="Self-approved"
                value={`${selfApproved.count}`}
                hint={`of ${selfApproved.population} human-merged PRs`}
                basis={rateReading(selfApproved).basis}
              />
            )}
            {fastReading && fastApproval && (
              <PrMetric
                label={`Approved <${FAST_APPROVAL_MAX_MINUTES}m`}
                value={fastReading.percent == null ? "n/a" : `${fastReading.percent}%`}
                hint={`${fastApproval.count} of ${fastApproval.population} approved PRs`}
                basis={fastReading.basis}
              />
            )}
          </div>
          {/* The caveats are rendered VISIBLY, not tucked into a tooltip: both signals read as
              accusations when quoted bare, and the panel that publishes them owns saying so. */}
          <ul className="mt-2 space-y-0.5 type-body-sm text-slate-500">
            {selfApproved && <li>{RATE_BASIS.selfApproved.caveat}</li>}
            {fastApproval && <li>{RATE_BASIS.fastApproval.caveat}</li>}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 type-mono-sm text-slate-500">
        <span>avg {stats.avgLineChanges} lines · {stats.avgChangedFiles} files</span>
        <span>{stats.avgReviews} reviews / {stats.avgComments} comments per PR</span>
        {stats.botAuthoredRate > 0 && <span>{stats.botAuthoredRate}% bot-authored</span>}
        {stats.tools.length > 0 && (
          <span className="flex items-center gap-1.5">
            tools:
            {stats.tools.map((t) => (
              <span key={t.name} className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300">
                {t.name} {t.count}
              </span>
            ))}
          </span>
        )}
      </div>
      {aiChanges && aiChanges.length > 0 && (
        <div className="mt-4">
          <Kicker tone="muted">AI-attributed changes</Kicker>
          <p className="mt-1 type-body-sm text-slate-500">
            The PRs behind the AI-involved rate, and who approved each one. A rate cannot name them.
          </p>
          <ul className="mt-2 space-y-1.5" aria-label="AI-attributed pull requests">
            {aiChanges.map((c) => (
              <li key={c.prNumber} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 type-body-sm">
                <span className="font-mono tabular-nums text-slate-400">#{c.prNumber}</span>
                <span className="text-slate-200">{c.title}</span>
                <span className="type-mono-sm text-slate-500">
                  {AI_SIGNAL_LABEL[c.aiSignal]}
                  {c.aiTools.length > 0 ? ` · ${c.aiTools.join(", ")}` : ""}
                  {` · ${approvalPhrase(c)}`}
                  {c.revertedByPr != null ? ` · reverted by #${c.revertedByPr}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Surface>
  );
}
