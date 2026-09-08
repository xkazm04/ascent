// The transition programme's frozen origin, drawn.
//
// The panel used to open with: "The named, dated thing this org is actually doing: the frame the
// goals below hang off. Its baseline is frozen the moment it starts, so every later number is
// measured against a fixed origin." The second half is the whole mechanism, and a mechanism is
// exactly the thing a sentence explains worst — nothing in the old panel showed that the origin
// never moves, so a reader had to take it on trust.
//
// Here the origin IS a fixed mark on a 0-100 maturity axis, drawn in the `decided` encoding (an
// accent ring — a person started this programme; the scores around it are derived measurements), the
// current standing is a filled dot, and the movement between them is the rule that connects the two.
// The target rung is the dashed edge the programme is steering at. Re-targeting moves the rung and
// leaves the ring exactly where it is, which is the contract startProgram states in words.
//
// Server-safe: no hooks, no handlers, no motion.

import { LEVEL_BANDS } from "@/components/report/chartScale";
import { deltaHex } from "@/components/ui";
import { KICKER_SVG_CLASS, stateStroke, stateStrokeWidth, stateTitle } from "@/components/org/viz";
import { LEVELS } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

const W = 320;
const H = 44;
const PAD = 6;
const AXIS_Y = 26;
const BAND_H = 10;

export function ProgramBaseline({
  baseline,
  baselineAt,
  now,
  targetLevel,
  className = "",
}: {
  /** The frozen origin — the fleet's overall standing the moment the programme started. */
  baseline: number;
  /** ISO date the origin was frozen. */
  baselineAt: string;
  /** Today's fleet standing. Null ⇒ no current measurement, so no "now" dot is drawn. */
  now: number | null;
  targetLevel: LevelId;
  className?: string;
}) {
  const span = W - PAD * 2;
  const x = (v: number) => PAD + (Math.max(0, Math.min(100, v)) / 100) * span;
  const target = LEVELS.find((l) => l.id === targetLevel);
  const targetAt = target ? target.band[0] : null;
  const hasNow = typeof now === "number" && Number.isFinite(now);
  const delta = hasNow ? now - baseline : 0;
  const frozen = baselineAt.slice(0, 10);

  const ariaLabel =
    `Transition programme on the 0-100 maturity axis: origin frozen at ${baseline} on ${frozen}` +
    (hasNow ? `, now ${now} (${delta > 0 ? "+" : ""}${delta} since the origin)` : ", no current standing measured") +
    (targetAt !== null ? `, target rung ${targetLevel} at ${targetAt}.` : ".") +
    " The origin is never recomputed; re-targeting moves the rung and leaves it where it is.";

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        {/* The maturity ramp behind the axis, from the ONE band definition every chart shares. */}
        {LEVEL_BANDS.map((b, i) => {
          const upper = i === 0 ? 100 : LEVEL_BANDS[i - 1]!.min;
          return (
            <rect
              key={b.min}
              x={x(b.min)}
              y={AXIS_Y - BAND_H}
              width={x(upper) - x(b.min)}
              height={BAND_H}
              fill={b.color}
            />
          );
        })}
        <line x1={PAD} y1={AXIS_Y} x2={W - PAD} y2={AXIS_Y} stroke="var(--color-divider)" strokeWidth={1} />

        {/* The target rung — dashed, because it is a commitment, not a measurement. */}
        {targetAt !== null && (
          <>
            <line
              x1={x(targetAt)}
              y1={AXIS_Y - BAND_H - 4}
              x2={x(targetAt)}
              y2={AXIS_Y + 4}
              stroke="var(--color-accent)"
              strokeWidth={1}
              strokeDasharray="3 2"
            />
            <text x={x(targetAt)} y={AXIS_Y + 14} fontSize={8} textAnchor="middle" className={KICKER_SVG_CLASS}>
              {targetLevel}
            </text>
          </>
        )}

        {/* The movement from the fixed origin. Drawn only when there is a current standing to move to. */}
        {hasNow && (
          <line
            x1={x(baseline)}
            y1={AXIS_Y - BAND_H / 2}
            x2={x(now)}
            y2={AXIS_Y - BAND_H / 2}
            stroke={deltaHex(delta)}
            strokeWidth={2.5}
          />
        )}

        {/* The origin, in the `decided` encoding: a person froze this, and it never moves again. */}
        <circle
          data-origin="baseline"
          cx={x(baseline)}
          cy={AXIS_Y - BAND_H / 2}
          r={4}
          fill="none"
          stroke={stateStroke("decided")}
          strokeWidth={stateStrokeWidth("decided")}
        >
          <title>{stateTitle("decided", `Baseline ${baseline}, frozen ${frozen}`)}</title>
        </circle>
        <text x={x(baseline)} y={AXIS_Y - BAND_H - 4} fontSize={8} textAnchor="middle" className={KICKER_SVG_CLASS}>
          origin {baseline}
        </text>

        {hasNow && (
          <>
            <circle cx={x(now)} cy={AXIS_Y - BAND_H / 2} r={3.5} fill={scoreHex(now)}>
              <title>{`Now ${now} — ${delta > 0 ? "+" : ""}${delta} against the frozen origin`}</title>
            </circle>
            <text
              x={x(now)}
              y={AXIS_Y + 14}
              fontSize={8}
              textAnchor="middle"
              className="font-mono tabular-nums"
              fill={scoreHex(now)}
            >
              {now}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
