"use client";

// Dependency-free SVG charts (keeps the bundle small and the build fast).

import { useId } from "react";
import type { MaturityLevel, ScoreIntegrity } from "@/lib/types";
import { integrityNotes } from "@/lib/maturity/attribution";
import { LEVEL_GLYPH, scoreHex } from "@/lib/ui";
import { clamp01to100 } from "@/components/report/chartScale";
import { usePrefersReducedMotion } from "@/components/report/chartMotion";
import { MOCK_RING_DASH, MOCK_SR_SUFFIX, isMockEngine } from "@/components/report/chartEngine";

export function ScoreRing({
  score,
  level,
  size = 200,
  engine,
  integrity,
}: {
  score: number;
  level: MaturityLevel;
  size?: number;
  /** Scan engine provider. A mock-scored report draws the arc hollow. */
  engine?: string | null;
  /** Existing scoreIntegrity only. Caption/aria-desc name notes when any fired; a clean run stays unlabeled. */
  integrity?: ScoreIntegrity | null;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // Clamp + NaN-guard: a NaN/out-of-range score would make strokeDashoffset NaN and render the
  // ring as a full circle (reads as a perfect 100). scoreHex already clamps the colour; clamp the
  // geometry too so the arc length can't lie.
  const safeScore = clamp01to100(score);
  // The numeral and the screen-reader desc must use the SAME clamped value as the arc geometry —
  // otherwise the clamp protects the picture but a NaN/out-of-range raw `score` still prints "NaN"
  // or "137" in the headline number and the aria-desc, contradicting a correct-looking arc.
  const displayScore = Math.round(safeScore);
  const offset = c * (1 - safeScore / 100);
  const color = scoreHex(score);
  const cx = size / 2;
  const titleId = useId();
  const descId = useId();
  const maskId = useId();
  const mock = isMockEngine(engine);
  // Gate the arc sweep on reduced-motion. In RoadmapSandbox the score is driven LIVE by the
  // projection sliders, so an un-gated 0.8s transition re-animates the ring on every drag —
  // a WCAG 2.3.3 (Animation from Interactions) violation. Every sibling chart already gates its
  // transitions on this hook; ScoreRing was the un-gated exception.
  const reduced = usePrefersReducedMotion();
  // Same wording as the header chip. G5: disclose what already fired; do not widen the band here.
  const notes = integrityNotes(integrity);
  const noteLine = notes.length ? notes.map((n) => n.label).join(" · ") : "";

  const ring = (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
    >
      {/* Screen-reader title/desc — the arc length already encodes the score without color. */}
      <title id={titleId}>Overall maturity score</title>
      <desc id={descId}>
        {`Score ${displayScore} of 100. Level ${level.id} ${level.name}.`}
        {noteLine ? ` Integrity: ${noteLine}.` : ""}
        {mock ? MOCK_SR_SUFFIX : ""}
      </desc>
      {mock && (
        <defs>
          <mask id={maskId}>
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke="white"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${cx} ${cx})`}
            />
          </mask>
        </defs>
      )}
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--color-divider)" strokeWidth={stroke} />
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={mock ? MOCK_RING_DASH : c}
        strokeDashoffset={mock ? undefined : offset}
        transform={`rotate(-90 ${cx} ${cx})`}
        mask={mock ? `url(#${maskId})` : undefined}
        data-mock={mock || undefined}
        style={{ transition: reduced || mock ? undefined : "stroke-dashoffset 0.8s ease" }}
      />
      <text x={cx} y={cx - 6} textAnchor="middle" className="fill-white" fontSize={size * 0.26} fontWeight={700}>
        {displayScore}
      </text>
      <text x={cx} y={cx + 22} textAnchor="middle" fill={color} fontSize={size * 0.085} fontWeight={600}>
        {LEVEL_GLYPH[level.id]} {level.id} · {level.name}
      </text>
    </svg>
  );

  if (!noteLine) return ring;

  return (
    <figure className="m-0 flex flex-col items-center">
      {ring}
      <figcaption
        className="mt-2 max-w-[16rem] text-center type-body-sm text-amber-300/90"
        title={notes.map((n) => n.hint).join(" ")}
        data-testid="score-ring-integrity"
      >
        {noteLine}
      </figcaption>
    </figure>
  );
}
