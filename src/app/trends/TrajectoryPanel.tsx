// The repo trends page's forecast panel — and the honesty layer around it.
//
// TWO THINGS THIS FIXES (G5-01 display side / G4-16 data side — one defect, filed twice):
//
//  1. WHAT THE FIT IS OVER. The forecast is fit over the full history the viewer's read returned and
//     is stated as such, right on the panel: "full recorded history" when no plan window applies, and
//     the window ("last N days, the <plan> plan's history window") when one does. The plan window is
//     the read's access boundary, not a display filter, so the fit never sees older rows and the panel
//     never calls the window "all-time". It deliberately does NOT follow the 5d/30d/90d/All toggle in the
//     section below: a projection that changes when the viewer changes a zoom control is not a
//     projection, it is an artefact of the control. Anchoring to full history also means flipping to
//     "5d" can no longer collapse the fit input to two noisy points.
//  2. WHEN NOT TO PROJECT AT ALL. Below the shared floor (`forecastInsufficiency` — 3 distinct scan
//     days AND a 14-day span) the ETA is suppressed entirely rather than dressed in a confidence
//     percentage. A straight line through a busy Tuesday is not a trajectory.
//
// Server component (no hooks) — it renders inside the server-rendered trends page.

import { Card } from "@/components/org/shared/ui";
import { Trajectory } from "@/features/standing/overview/Trajectory";
import { forecastInsufficiency, type Forecast } from "@/lib/maturity/forecast";

/** The fit was cut at a rubric change (see `rubricTruncation`): points used, of how many, under which rubric. */
export type RubricRun = { used: number; total: number; rubric: string };

/** The plan history window the read was clamped to (plain values only; null/absent = unclamped). */
export type TrajectoryWindow = { days: number; planLabel: string };

/** The line that tells the reader exactly what the number above it was computed from. */
function FitBasis({ scanCount, forecast, rubricRun, window }: { scanCount: number; forecast: Forecast | null; rubricRun?: RubricRun | null; window?: TrajectoryWindow | null }) {
  const span = forecast ? `${forecast.points} distinct scan ${forecast.points === 1 ? "day" : "days"} across ${forecast.spanDays} ${forecast.spanDays === 1 ? "day" : "days"}` : null;
  const compacted = forecast?.compactedPoints ?? 0;
  const windowName = window ? `the last ${window.days} days, the ${window.planLabel} plan's history window` : null;
  const unit = compacted > 0 ? "history points" : scanCount === 1 ? "scan" : "scans";
  return (
    <p className="mt-2 type-body-sm text-slate-500">
      {rubricRun
        ? `Fit over the ${rubricRun.used} of ${rubricRun.total} history points scored under ${rubricRun.rubric}${windowName ? `, within ${windowName}` : ""}`
        : windowName
          ? `Fit over the ${scanCount} ${unit} in ${windowName}`
          : <>Fit over this repository&rsquo;s full recorded history: all {scanCount}{" "}{unit}</>}
      {span ? ` (${span}${compacted > 0 ? `, ${compacted} of them compacted` : ""})` : ""}.
      {" "}It does not follow the 5d / 30d / 90d range toggle below.
    </p>
  );
}

export function TrajectoryPanel({
  forecast,
  scanCount,
  rubricRun,
  window,
}: {
  /** Fit over the full history the read returned (the plan window when one applies), never the displayed range. Null when < 2 distinct scan days. */
  forecast: Forecast | null;
  /** History rows the fit saw, including compacted summaries when present. */
  scanCount: number;
  /** Set when the fit was cut at a rubric change: earlier points measured a different ruler. */
  rubricRun?: RubricRun | null;
  /** Set when the viewer's plan clamps the history read: the fit saw only that window, and says so. */
  window?: TrajectoryWindow | null;
}) {
  const heading = window ? `${window.days}-day trajectory` : "All-time trajectory";
  // A fit cut at a rubric change that is still too short says so in those terms: the history is not
  // missing, it was scored under a different rubric and is not mixed in.
  const insufficient = forecastInsufficiency(forecast) && rubricRun
    ? `History under the current rubric (${rubricRun.rubric}) is too short to project: ${rubricRun.used} of ${rubricRun.total} history points were scored under it. Earlier points used a different rubric, so a line through them would measure the rubric, not the repository.`
    : forecastInsufficiency(forecast);

  if (insufficient || !forecast) {
    return (
      <section aria-labelledby="trajectory-heading">
        <h2 id="trajectory-heading" className="type-mono-sm uppercase tracking-[0.2em] text-slate-500">
          {heading}
        </h2>
        <Card className="mt-2">
          <p className="type-body text-slate-300">{insufficient}</p>
          <p className="mt-2 type-body-sm text-slate-500">
            Scan again over the coming weeks. The projection appears once there is enough spread to
            read a trend rather than noise.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section aria-labelledby="trajectory-heading">
      <h2 id="trajectory-heading" className="type-mono-sm uppercase tracking-[0.2em] text-slate-500">
        {heading}
      </h2>
      <div className="mt-2">
        <Trajectory forecast={forecast} />
      </div>
      <FitBasis scanCount={scanCount} forecast={forecast} rubricRun={rubricRun} window={window} />
    </section>
  );
}
