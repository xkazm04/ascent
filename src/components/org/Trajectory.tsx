// The trajectory GPS — a forward-looking read of the org maturity trend. Reads the linear
// forecast computed on the rollup (forecastTrajectory) and renders where the fleet is now,
// where it is heading by the horizon, the weekly rate, the promotion/demotion ETA, and how
// trustworthy the straight-line read is. Server-safe (no client hooks).
import { Card, Meter, SectionHeader } from "@/components/org/ui";
import { forecastHeadline, humanizeDays, type Forecast } from "@/lib/maturity/forecast";
import { LEVEL_BY_ID } from "@/lib/maturity/model";
import { LEVEL_GLYPH, scoreHex } from "@/lib/ui";

const DIR = {
  rising: { arrow: "▲", color: "#84cc16", label: "rising" },
  falling: { arrow: "▼", color: "#f97316", label: "falling" },
  flat: { arrow: "→", color: "#94a3b8", label: "holding" },
} as const;

function LevelStamp({ score, levelId }: { score: number; levelId: keyof typeof LEVEL_GLYPH }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: scoreHex(score) }}>
        {score}
      </span>
      <span className="font-mono text-sm text-slate-400" aria-hidden>
        {LEVEL_GLYPH[levelId]}
      </span>
      <span className="font-mono text-sm text-slate-400">
        {levelId} · {LEVEL_BY_ID[levelId].name}
      </span>
    </span>
  );
}

export function Trajectory({ forecast }: { forecast: Forecast }) {
  const dir = DIR[forecast.trajectory];
  const confidence = Math.round(forecast.fitQuality * 100);
  const rate = `${forecast.perWeek > 0 ? "+" : ""}${forecast.perWeek}/wk`;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Trajectory"
        right={
          <span className="inline-flex items-center gap-1.5 font-mono text-sm" style={{ color: dir.color }}>
            <span aria-hidden>{dir.arrow}</span>
            {dir.label} · {rate}
          </span>
        }
      />

      <p className="mt-3 text-base text-slate-200">{forecastHeadline(forecast)}</p>

      {/* Now → projected at the horizon */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Now</div>
          <LevelStamp score={forecast.current} levelId={forecast.currentLevel} />
        </div>
        <span className="font-mono text-lg text-slate-600" aria-hidden>
          →
        </span>
        <div>
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">
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
            className="rounded-full border px-2.5 py-1 font-mono text-sm"
            style={{ borderColor: `${dir.color}66`, color: dir.color }}
          >
            ETA {forecast.eta.kind === "promotion" ? "→" : "↘"} {forecast.eta.toLevel} ·{" "}
            {humanizeDays(forecast.eta.days)} ({forecast.eta.date})
          </span>
        ) : (
          <span className="rounded-full border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-400">
            no level change projected within the year
          </span>
        )}
        {/* On < 3 distinct scan days the R² is mathematically 1 regardless of noise, so a raw
            "100% confidence" overstates a 2-point blip. Surface a low-data caveat instead of the
            inflated percentage (forecast-overconfidence #1). */}
        {forecast.lowData ? (
          <span
            className="font-mono text-sm text-slate-500"
            title="Too few distinct scan days to gauge a trend — a straight line through ≤ 2 points always fits perfectly"
          >
            trend confidence — low data (n={forecast.points})
          </span>
        ) : (
          <span
            className="font-mono text-sm text-slate-500"
            title="R² of the linear fit — how closely the trend follows a straight line"
          >
            trend confidence {confidence}%{confidence < 50 ? " · noisy" : ""}
          </span>
        )}
      </div>
    </Card>
  );
}
