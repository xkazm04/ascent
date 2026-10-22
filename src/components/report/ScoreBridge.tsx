import { dimShort, fmtPts, scoreHex } from "@/lib/ui";
import { deltaHex } from "@/components/ui";
import { AGGREGATE_HEX } from "@/components/report/scoreWaterfallSegments";
import { RESIDUAL_LABEL, type BridgeStep, type ScoreBridgeResult } from "@/components/report/scoreBridgeModel";

/**
 * The waterfall's "Since last scan" body: the previous overall, one signed row per step, the current
 * overall. Presentational only (the arithmetic lives in scoreBridgeModel, the mode toggle in
 * ScoreWaterfall). Caveats sit ABOVE the steps and never hide them: a label, not a block.
 */
export function ScoreBridge({ bridge }: { bridge: Extract<ScoreBridgeResult, { kind: "bridge" }> }) {
  const { from, to, delta, steps, caveats } = bridge;
  const maxAbs = Math.max(1, ...steps.map((s) => Math.abs(s.points ?? 0)));
  return (
    <div className="mt-4" data-bridge>
      <p className="font-mono type-body tabular-nums text-slate-300">
        {from} → {to} <span className={delta > 0 ? "text-emerald-300" : delta < 0 ? "text-red-300" : "text-slate-400"}>({signed(delta)})</span>
        <span className="ml-2 type-body-sm text-slate-500">overall points since last scan, by dimension</span>
      </p>

      {caveats.map((c) => (
        <p
          key={c.id}
          role="note"
          data-caveat={c.id}
          className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 type-body-sm text-amber-100"
        >
          <span className="font-semibold">{c.label}.</span> {c.note}
        </p>
      ))}

      {steps.length === 0 ? (
        <p className="mt-3 type-body-sm text-slate-500">No dimension moved since the last scan.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {steps.map((s) => (
            <StepRow key={s.dimension ?? s.kind} step={s} maxAbs={maxAbs} />
          ))}
        </ul>
      )}
    </div>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${fmtPts(n)}` : n < 0 ? `-${fmtPts(Math.abs(n))}` : "0";
}

function stepName(s: BridgeStep): string {
  return s.dimension ? dimShort(s.dimension) : s.label;
}

function stepDetail(s: BridgeStep): string {
  if (s.kind === "moved") return `${s.scoreBefore} → ${s.scoreNow} × ${Math.round((s.share ?? 0) * 100)}%`;
  if (s.kind === "entered") return `new: ${s.scoreNow} × ${Math.round((s.share ?? 0) * 100)}%`;
  if (s.kind === "left") return `no longer scored (was ${s.scoreBefore}); its effect is in ${RESIDUAL_LABEL}`;
  return "headline rounding, plus weights that moved between scans";
}

function srSentence(s: BridgeStep): string {
  if (s.points === null) return "its weight on the last scan is not recorded";
  if (s.points === 0) return "did not move the overall";
  return `${s.points > 0 ? "raised" : "lowered"} the overall by ${fmtPts(Math.abs(s.points))} points`;
}

function StepRow({ step: s, maxAbs }: { step: BridgeStep; maxAbs: number }) {
  const pts = s.points ?? 0;
  const ink = s.kind === "residual" || s.points === null ? AGGREGATE_HEX : deltaHex(pts);
  const pct = (Math.abs(pts) / maxAbs) * 50;
  return (
    <li className="flex items-center gap-3 type-body" data-step={s.dimension ?? s.kind} data-kind={s.kind}>
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: s.scoreNow !== null ? scoreHex(s.scoreNow) : AGGREGATE_HEX }}
      />
      <span className="w-40 shrink-0 truncate text-slate-300">{stepName(s)}</span>
      <span className="flex-1 truncate type-mono-sm text-slate-400">{stepDetail(s)}</span>
      {/* A centred diverging bar: gains grow right of the axis, losses left. */}
      <span aria-hidden className="relative hidden h-2 w-24 shrink-0 sm:block">
        <span className="absolute inset-y-0 left-1/2 w-px bg-slate-600" />
        <span
          className="absolute inset-y-0 rounded-sm"
          style={{ backgroundColor: ink, width: `${pct}%`, left: pts >= 0 ? "50%" : `${50 - pct}%` }}
        />
      </span>
      <span className="w-14 shrink-0 text-right font-mono tabular-nums text-slate-200">
        <span aria-hidden>{s.points === null ? "?" : signed(pts)}</span>
        <span className="sr-only">{srSentence(s)}</span>
      </span>
    </li>
  );
}
