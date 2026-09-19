// The trajectory GPS — a forward-looking read of the org maturity trend. Reads the linear
// forecast computed on the rollup (forecastTrajectory) and renders where the fleet is now,
// where it is heading by the horizon, the weekly rate, the promotion/demotion ETA, and how
// trustworthy the straight-line read is. Server-safe (no client hooks).
// Headline and confidence come from composeTrajectory so an unpresentable fit cannot print a slope (G4).
import { Card, Meter, SectionHeader, DIRECTION_TONE } from "@/components/org/shared/ui";
import { composeTrajectory, forecastConfidenceNote, humanizeDays, type Forecast } from "@/lib/maturity/forecast";
import { LEVEL_BY_ID } from "@/lib/maturity/model";
import { LEVEL_GLYPH, scoreHex } from "@/lib/ui";

function LevelStamp({ score, levelId }: { score: number; levelId: keyof typeof LEVEL_GLYPH }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="type-figure font-bold" style={{ color: scoreHex(score) }}>
        {score}
      </span>
      <span className="type-mono-sm text-slate-400" aria-hidden>
        {LEVEL_GLYPH[levelId]}
      </span>
      <span className="type-mono-sm text-slate-400">
        {levelId} · {LEVEL_BY_ID[levelId].name}
      </span>
    </span>
  );
}

export function Trajectory({ forecast }: { forecast: Forecast }) {
  const read = composeTrajectory(forecast);
  const dir = DIRECTION_TONE[forecast.trajectory];
  const rate = `${forecast.perWeek > 0 ? "+" : ""}${forecast.perWeek}/wk`;
  const confidenceNote = forecastConfidenceNote(read.confidence);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Trajectory"
        right={
          <span className="inline-flex items-center gap-1.5 type-mono-sm" style={{ color: dir.color }}>
            <span aria-hidden>{dir.arrow}</span>
            {dir.label} · {rate}
          </span>
        }
      />

      {read.headline ? <p className="mt-3 type-body text-slate-200">{read.headline}</p> : null}

      {/* Now → projected at the horizon */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <div className="type-mono-sm uppercase tracking-widest text-slate-500">Now</div>
          <LevelStamp score={forecast.current} levelId={forecast.currentLevel} />
        </div>
        <span className="font-mono type-lede text-slate-600" aria-hidden>
          →
        </span>
        <div>
          <div className="type-mono-sm uppercase tracking-widest text-slate-500">
            In {forecast.horizonDays}d
          </div>
          <LevelStamp score={forecast.projected} levelId={forecast.projectedLevel} />
        </div>
      </div>

      {/* Current position with the next band boundary marked */}
      <Meter
        className="mt-4"
        value={forecast.current}
        color={scoreHex(forecast.current)}
        threshold={forecast.eta?.boundary}
      />

      {/* ETA + fit confidence */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {forecast.eta ? (
          <span
            className="rounded-full border px-2.5 py-1 type-mono-sm"
            style={{ borderColor: `${dir.color}66`, color: dir.color }}
          >
            ETA {forecast.eta.kind === "promotion" ? "→" : "↘"} {forecast.eta.toLevel} ·{" "}
            {humanizeDays(forecast.eta.days)} ({forecast.eta.date})
          </span>
        ) : (
          <span className="rounded-full border border-slate-700 px-2.5 py-1 type-mono-sm text-slate-400">
            no level change projected within the year
          </span>
        )}
        {confidenceNote ? (
          <span
            className="type-mono-sm text-slate-500"
            title="R² of the linear fit: how closely the trend follows a straight line"
          >
            {confidenceNote}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
