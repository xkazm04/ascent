"use client";

// WHY this row ranked where it did — the three ranking factors, drawn per row.
//
// The recall panel used to state the formula once, in a paragraph above 40 rows: "confidence ×
// per-kind decay × how often it has been delivered (capped)". A reader could then look at a row
// scoring 0.31 and not know whether it was distrusted, old, or simply never delivered. Three
// segments answer that at a glance, and they answer it for every row rather than once for the page.
//
// THE RULE THIS FILE DOES NOT BREAK: the SCORE is never recomputed here. `score` and `ageDays` come
// verbatim from the response (memoryRecall.ts), and this bar draws the three FACTORS — it never
// multiplies them back together and never prints a number the server did not send. The factor
// geometry is derived through the SAME exported constants the server scored with
// (`halfLifeDays`, `ACCESS_BONUS_WEIGHT`, `MAX_DELIVERY_BONUS` in src/lib/memory/recall.ts), so the
// picture cannot drift from the model by re-typing it.
//
// The citation term (`citedCount`) is deliberately absent: it is not on the wire row, and drawing a
// factor from a field we do not have would be a fabricated measurement.

import { clamp, r2 } from "@/components/org/viz";
import {
  ACCESS_BONUS_WEIGHT,
  MAX_DELIVERY_BONUS,
  halfLifeDays,
} from "@/lib/memory/recall";

const W = 96;
const H = 8;
const GAP = 3;
const SEG_W = (W - GAP * 2) / 3;

type Factor = { id: string; label: string; value: number; detail: string };

/** The three factors, each normalised to 0..1 for LENGTH only. No product is taken. */
export function recallFactors(input: {
  confidence: number;
  ageDays: number;
  kind: string;
  accessCount: number;
}): Factor[] {
  const hl = halfLifeDays(input.kind);
  const trust = clamp(input.confidence, 0, 1);
  const freshness = clamp(Math.pow(0.5, clamp(input.ageDays, 0, Number.MAX_SAFE_INTEGER) / hl), 0, 1);
  const raw = 1 + ACCESS_BONUS_WEIGHT * Math.log(1 + Math.max(0, input.accessCount));
  // 0 deliveries is a measured zero, not an absence: the counter exists and reads zero.
  const delivery = clamp(
    (Math.min(MAX_DELIVERY_BONUS, raw) - 1) / (MAX_DELIVERY_BONUS - 1),
    0,
    1,
  );
  return [
    {
      id: "trust",
      label: "trust",
      value: trust,
      detail: `confidence ${trust.toFixed(2)} of 1.00`,
    },
    {
      id: "freshness",
      label: "freshness",
      value: freshness,
      detail: `${Math.round(input.ageDays)}d old against a ${hl}-day half-life for ${input.kind}`,
    },
    {
      id: "delivery",
      label: "delivery",
      value: delivery,
      detail:
        input.accessCount === 0
          ? "never delivered — a counted zero, not a missing measurement"
          : `${input.accessCount} deliveries, against a bonus capped at ×${MAX_DELIVERY_BONUS}`,
    },
  ];
}

export function RecallContribution({
  confidence,
  ageDays,
  kind,
  accessCount,
  className = "",
}: {
  confidence: number;
  ageDays: number;
  kind: string;
  accessCount: number;
  className?: string;
}) {
  const factors = recallFactors({ confidence, ageDays, kind, accessCount });
  const ariaLabel =
    "Ranking factors — " + factors.map((f) => `${f.label}: ${f.detail}`).join("; ") + ".";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      {factors.map((f, i) => {
        const x = i * (SEG_W + GAP);
        return (
          <g key={f.id} data-factor={f.id}>
            {/* the track: the factor's full reach, so a short fill reads as a shortfall */}
            <rect x={r2(x)} y={0} width={r2(SEG_W)} height={H} rx={2} fill="var(--color-surface-strong)" stroke="var(--color-divider)" strokeWidth={0.5} />
            <rect
              data-fill={f.id}
              data-value={f.value.toFixed(3)}
              x={r2(x)}
              y={0}
              width={r2(SEG_W * f.value)}
              height={H}
              rx={2}
              fill="var(--color-accent)"
              fillOpacity={0.6}
            />
            <title>{`${f.label} — ${f.detail}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
