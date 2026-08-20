import type { ScanReport } from "@/lib/types";
import {
  FAST_APPROVAL_MAX_MINUTES,
  RATE_BASIS,
  rateReading,
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
        <span className="font-mono text-xl font-bold tabular-nums" style={{ color: color ?? "#fff" }}>
          {value}
        </span>
        {elevated && (
          <span
            className="font-mono text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--color-warn)" }}
          >
            <span aria-hidden>▲ </span>elevated
          </span>
        )}
      </div>
      {hint && <div className="mt-0.5 text-sm text-slate-500">{hint}</div>}
      {basis && <span className="sr-only">{basis}</span>}
    </div>
  );
}

export function PrSignalsPanel({ stats }: { stats: NonNullable<ScanReport["prStats"]> }) {
  const rates = stats.rates;
  const reviewed = read(rates, "reviewed", "human PRs reviewed", stats.reviewedRate);
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
          <h2 className="text-lg font-semibold text-white">Pull request signals</h2>
          <p className="mt-1 text-base text-slate-400">
            How systematically the team ships, based on the {stats.analyzed} most recent of {stats.totalCount} PRs.
          </p>
        </div>
        {(aiInvolved.percent ?? 0) > 0 && (
          <span
            className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-sm text-accent"
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
            as a scalar. It renders from the scalar with its static hint until it joins the book. */}
        <PrMetric label="Merge rate" value={`${stats.mergeRate}%`} color={scoreHex(stats.mergeRate)} hint="vs closed unmerged" />
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
          <ul className="mt-2 space-y-0.5 text-sm text-slate-500">
            {selfApproved && <li>{RATE_BASIS.selfApproved.caveat}</li>}
            {fastApproval && <li>{RATE_BASIS.fastApproval.caveat}</li>}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-sm text-slate-500">
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
    </Surface>
  );
}
