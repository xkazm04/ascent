// The number this whole wave exists for, as a PAIRED MARK: do AI-attributed changes fail more often
// than human-authored ones?
//
// It used to be a two-row table plus an accent callout sentence ("AI changes fail more — 3 points
// higher than human-authored changes over the last 30 days: 9% vs 6%"). A difference between two
// rates is the single easiest thing in analytics to draw and the single hardest to hold in a
// sentence, so it is now two bars on one shared 0–100% axis with the gap bracketed between their
// ends. The sentence's content survives as the bracket's label and its `<title>`.
//
// The refusals it inherits, both encoded rather than asserted:
//   • a bucket under the sample floor is a VOID track — dashed, unfilled, em dash for a figure. One
//     bad deploy out of one is not a 100% failure rate, and there is no bar to misread as one.
//   • the human bucket is a RESIDUAL and contaminated in AI's favour; that is the mark's WhyChip,
//     reachable from the comparison itself rather than from a paragraph two scroll-lengths down.
//
// Server-safe — no hooks, no handlers.

import { scoreHex } from "@/lib/ui";
import { VOID_DASH, WhyChip, clamp, isNum, r2, stateTitle } from "@/components/org/viz";
import { MIN_DEPLOYMENTS, type OutcomeBucket } from "@/lib/db/delivery-outcomes";

const W = 320;
const LABEL_W = 78;
const TRACK_W = W - LABEL_W - 34;
const ROW_H = 22;
const BAR_H = 11;
const TOP = 10;

/** (D) The demoted "Human-authored is a residual" paragraph. */
export const RESIDUAL_HINT =
  "Human-authored is a residual: AI assistance a developer did not mark is invisible to the detector and lands in that bucket, so it is contaminated in AI's favour. A measured 'AI fails more' is therefore conservative, and an 'AI fails less' should be read with that in mind.";

const x = (rate: number) => r2(LABEL_W + (clamp(rate, 0, 100) / 100) * TRACK_W);
// Lower is better for a failure rate, so the ramp is inverted (the PrSignalsBand revert precedent).
const tone = (rate: number) => scoreHex(clamp(100 - rate * 4, 0, 100));

function Row({ label, bucket, y }: { label: string; bucket: OutcomeBucket; y: number }) {
  const rate = bucket.failureRate;
  const missing = !isNum(rate);
  return (
    <g data-bucket={label.toLowerCase()} data-state={missing ? "missing" : "measured"}>
      <text x={0} y={y + BAR_H} fontSize={10} className="fill-slate-400 font-mono uppercase tracking-wider">
        {label}
      </text>
      {missing ? (
        <rect x={LABEL_W} y={y + 1} width={TRACK_W} height={BAR_H} rx={2} fill="none" stroke="var(--color-divider)" strokeWidth={1} strokeDasharray={VOID_DASH}>
          <title>{stateTitle("missing", `${label} change-failure rate (under ${MIN_DEPLOYMENTS} attributed deployments)`)}</title>
        </rect>
      ) : (
        <>
          <rect x={LABEL_W} y={y + 1} width={TRACK_W} height={BAR_H} rx={2} fill="var(--color-divider)" fillOpacity={0.5} />
          <rect x={LABEL_W} y={y + 1} width={Math.max(1, x(rate) - LABEL_W)} height={BAR_H} rx={2} fill={tone(rate)}>
            <title>{`${label}: ${rate}% of ${bucket.deployments} attributed deployments failed (${bucket.failed}).`}</title>
          </rect>
        </>
      )}
      <text x={W} y={y + BAR_H} textAnchor="end" fontSize={11} className="fill-slate-200 font-mono tabular-nums">
        {missing ? "—" : `${rate}%`}
      </text>
    </g>
  );
}

export function FailureSplitMark({
  ai,
  human,
  gap,
  periodTitle,
}: {
  ai: OutcomeBucket;
  human: OutcomeBucket;
  /** ai − human in points. Null unless BOTH buckets cleared the floor. */
  gap: number | null;
  periodTitle: string;
}) {
  const bothMeasured = gap != null && isNum(ai.failureRate) && isNum(human.failureRate);
  const H = TOP + ROW_H * 2 + (bothMeasured ? 16 : 4);
  const yAi = TOP;
  const yHuman = TOP + ROW_H;

  const verdict =
    gap == null
      ? `Not comparable: at least one bucket has fewer than ${MIN_DEPLOYMENTS} attributed deployments, so no rate is stated for it.`
      : gap > 0
        ? `AI-attributed changes fail ${Math.abs(gap)} points more often than human-authored ones over ${periodTitle.toLowerCase()}.`
        : gap < 0
          ? `AI-attributed changes fail ${Math.abs(gap)} points less often than human-authored ones over ${periodTitle.toLowerCase()}.`
          : `No measured difference over ${periodTitle.toLowerCase()}.`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Change-failure rate by authorship. ${verdict}`}>
        <title>{`Change-failure rate by authorship. ${verdict}`}</title>
        <Row label="AI" bucket={ai} y={yAi} />
        <Row label="Human" bucket={human} y={yHuman} />
        {bothMeasured && (
          // The gap, bracketed between the two bar ends — the difference the sentence used to carry.
          <g data-gap={gap}>
            <path
              d={`M ${x(ai.failureRate as number)} ${yAi + 1} L ${x(ai.failureRate as number)} ${yHuman + BAR_H + 4} M ${x(human.failureRate as number)} ${yHuman + 1} L ${x(human.failureRate as number)} ${yHuman + BAR_H + 4} M ${x(ai.failureRate as number)} ${yHuman + BAR_H + 4} L ${x(human.failureRate as number)} ${yHuman + BAR_H + 4}`}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={1}
              strokeOpacity={0.7}
            />
            <text
              x={r2((x(ai.failureRate as number) + x(human.failureRate as number)) / 2)}
              y={H - 2}
              textAnchor="middle"
              fontSize={10}
              className="font-mono tabular-nums"
              style={{ fill: "var(--color-accent)" }}
            >
              {`${gap > 0 ? "+" : ""}${gap} pts`}
            </text>
          </g>
        )}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 type-mono-sm text-slate-500">
        {verdict}
        <WhyChip hint={RESIDUAL_HINT} label="what human-authored means here" />
      </div>
    </div>
  );
}
