// Score provenance micro-viz — makes ONE dimension's number auditable instead of a black box.
//
// It draws the mechanism that actually produced the score, and only that mechanism (scoring/
// provenance.ts). Three shapes, because the engine has three branches:
//
//   blended      a shaded clamp zone (±band, DOUBLED on a dimension the model flagged) with the
//                narrower REACH zone inside it — the clamp is not the whole story, the realized blend
//                weight shrinks it — plus ticks for the signal, the model's raw judgment, and the
//                blended result.
//   claim-scored NO band and NO "LLM judgment" tick: on D1/D4 the model cannot move the number by
//                judgment at all. What moved it is verified citations, so that is what is drawn.
//   signal-only  NO band and NO tick: D9's score IS the deterministic battery's, and the model only
//                narrates it.
//
// Drawing the same ±6 ribbon on all nine was a diagram of a lever that half of them do not have, and
// it contradicted the report header's own integrity chip on a widened dimension. Every `<title>` here
// is generated from the same `ScoreProvenance` the geometry is, so the accessible text and the picture
// cannot disagree.

import type { ScanReport, ScoreIntegrity } from "@/lib/types";
import { blendWeightPercent, scoreProvenance, type ScoreProvenance } from "@/lib/scoring/provenance";
import { scoreHex } from "@/lib/ui";
import { linScale } from "@/components/report/chartScale";

const W = 240;
const H = 22;
const PAD_X = 2;
const TRACK_Y = 14;

type Dim = Pick<ScanReport["dimensions"][number], "id" | "score" | "signalScore" | "llmScore">;

export function ProvenanceTrack({ d, integrity }: { d: Dim; integrity?: ScoreIntegrity | null }) {
  const p = scoreProvenance(d, integrity);
  const x = linScale(100, PAD_X, W - PAD_X * 2);
  const color = scoreHex(d.score);
  const lo = clampScore(d.signalScore - reachOf(p));
  const hi = clampScore(d.signalScore + reachOf(p));

  return (
    <div className="mt-1 max-w-sm">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel(d, p)}>
        {/* baseline track */}
        <line x1={x(0)} x2={x(100)} y1={TRACK_Y} y2={TRACK_Y} stroke="var(--color-divider)" strokeWidth={3} strokeLinecap="round" />

        {p.kind === "blended" && (
          <>
            {/* the CLAMP zone — how far the model's raw score was allowed to sit from the signal */}
            <rect
              x={x(clampScore(d.signalScore - p.clampBand))}
              y={TRACK_Y - 5}
              width={x(clampScore(d.signalScore + p.clampBand)) - x(clampScore(d.signalScore - p.clampBand))}
              height={10}
              rx={2}
              fill="var(--color-accent)"
              opacity={0.08}
            >
              {/* Single template-literal child: React 19 special-cases <title> as metadata and only
                  renders a lone text child — mixed text+number children make it drop on the server but
                  render on the client (a hydration mismatch). Keep every SVG <title> a single string. */}
              <title>{clampTitle(p)}</title>
            </rect>
            {/* the REACH zone — how far the RENDERED score can sit from the signal once the blend
                weight is applied. Equal to the clamp only at full weight. */}
            <rect x={x(lo)} y={TRACK_Y - 4} width={x(hi) - x(lo)} height={8} rx={2} fill="var(--color-accent)" opacity={0.16}>
              <title>{reachTitle(p, d.signalScore)}</title>
            </rect>
          </>
        )}

        {/* filled bar from signal → the score actually rendered */}
        <line x1={x(d.signalScore)} x2={x(d.score)} y1={TRACK_Y} y2={TRACK_Y} stroke={color} strokeWidth={3} strokeLinecap="round" />

        {/* signal tick */}
        <g>
          <line x1={x(d.signalScore)} x2={x(d.signalScore)} y1={TRACK_Y - 6} y2={TRACK_Y + 6} stroke="#94a3b8" strokeWidth={2} />
          <title>{`Signal (deterministic): ${d.signalScore}`}</title>
        </g>

        {/* the model's raw judgment — drawn ONLY where judgment is a lever on this number */}
        {p.kind === "blended" && (
          <g>
            <circle cx={x(d.llmScore)} cy={TRACK_Y} r={3} fill="#cbd5e1" stroke="var(--color-surface)" strokeWidth={1} />
            <title>{`LLM judgment (before the clamp and the blend weight): ${d.llmScore}`}</title>
          </g>
        )}

        {/* the rendered result */}
        <g>
          <circle cx={x(d.score)} cy={TRACK_Y} r={3.5} fill={color} stroke="var(--color-surface-strong)" strokeWidth={1} />
          <title>{`${resultWord(p)}: ${d.score}`}</title>
        </g>
      </svg>
      {/* The mechanism in words, on screen — the ribbon alone cannot say "the model has no lever here",
          and a reader auditing a number should not have to hover an SVG to learn it. */}
      <p className="type-note text-slate-500">{caption(d, p)}</p>
    </div>
  );
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function reachOf(p: ScoreProvenance): number {
  return p.kind === "blended" ? p.reach : 0;
}

function clampTitle(p: Extract<ScoreProvenance, { kind: "blended" }>): string {
  return p.widened
    ? `Guardband DOUBLED to ±${p.clampBand}: the model flagged this detector as suspect, so its judgment was clamped to ±${p.clampBand} of the signal instead of the usual ±${p.clampBand / 2}`
    : `Guardband: the model's judgment was clamped to within ±${p.clampBand} of the signal`;
}

function reachTitle(p: Extract<ScoreProvenance, { kind: "blended" }>, signal: number): string {
  return p.blend === null
    ? `This score can sit up to ±${p.reach} from the signal ${signal} (the realized blend weight was not recorded on this scan, so the full clamp is shown)`
    : `Blend weight ${blendWeightPercent(p.blend)}%: after weighting, the model can move this score at most ±${p.reach} from the signal ${signal}`;
}

function resultWord(p: ScoreProvenance): string {
  switch (p.kind) {
    case "blended":
      return "Blended result";
    case "claim-scored":
      return "Score (signal + verified citations)";
    case "signal-only":
      return "Score (deterministic, unmoved)";
  }
}

function ariaLabel(d: Dim, p: ScoreProvenance): string {
  switch (p.kind) {
    case "blended":
      return `Score provenance: signal ${d.signalScore}, LLM judgment ${d.llmScore} clamped to ±${p.clampBand}, blended ${d.score}`;
    case "claim-scored":
      return `Score provenance: signal ${d.signalScore}, ${signedPoints(p.claimPoints)} from verified citations, score ${d.score}. No LLM judgment band on this dimension.`;
    case "signal-only":
      return `Score provenance: deterministic score ${d.score}. The model does not move this number.`;
  }
}

function caption(d: Dim, p: ScoreProvenance): string {
  switch (p.kind) {
    case "blended":
      return p.blend === null
        ? `Signal ${d.signalScore} · model judgment clamped to ±${p.clampBand}${p.widened ? " (doubled — detector flagged)" : ""}`
        : `Signal ${d.signalScore} · model judgment clamped to ±${p.clampBand}${p.widened ? " (doubled — detector flagged)" : ""}, weighted ${blendWeightPercent(p.blend)}% → can move the score at most ±${p.reach}`;
    case "claim-scored":
      return p.claimPoints === 0
        ? `Cited-claim scored: no guardband and no judgment blend. The model moves this score only by citing evidence the detector missed; nothing was verified, so the score is the detector's ${d.signalScore}.`
        : `Cited-claim scored: no guardband and no judgment blend. Verified citations awarded ${signedPoints(p.claimPoints)} over the detector's ${d.signalScore}.`;
    case "signal-only":
      return `Signal-only: this score IS the deterministic check battery's ${d.signalScore}. The model narrates this dimension and never moves the number.`;
  }
}

function signedPoints(n: number): string {
  return `${n > 0 ? "+" : ""}${n} point${Math.abs(n) === 1 ? "" : "s"}`;
}
