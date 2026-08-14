// The repo trends page's forecast panel — and the honesty layer around it.
//
// TWO THINGS THIS FIXES (G5-01 display side / G4-16 data side — one defect, filed twice):
//
//  1. WHAT THE FIT IS OVER. The forecast is fit over the repo's FULL available history and is stated
//     as such, right on the panel. It deliberately does NOT follow the 5d/30d/90d/All toggle in the
//     section below: a projection that changes when the viewer changes a zoom control is not a
//     projection, it is an artefact of the control. Anchoring to full history also means flipping to
//     "5d" can no longer collapse the fit input to two noisy points.
//  2. WHEN NOT TO PROJECT AT ALL. Below the shared floor (`forecastInsufficiency` — 3 distinct scan
//     days AND a 14-day span) the ETA is suppressed entirely rather than dressed in a confidence
//     percentage. A straight line through a busy Tuesday is not a trajectory.
//
// Server component (no hooks) — it renders inside the server-rendered trends page.

import { Card } from "@/components/org/shared/ui";
import { Trajectory } from "@/components/org/overview/Trajectory";
import { forecastInsufficiency, type Forecast } from "@/lib/maturity/forecast";

/** The line that tells the reader exactly what the number above it was computed from. */
function FitBasis({ scanCount, forecast }: { scanCount: number; forecast: Forecast | null }) {
  const span = forecast ? `${forecast.points} distinct scan ${forecast.points === 1 ? "day" : "days"} across ${forecast.spanDays} ${forecast.spanDays === 1 ? "day" : "days"}` : null;
  return (
    <p className="mt-2 text-sm text-slate-500">
      Fit over this repository&rsquo;s full recorded history: all {scanCount}{" "}
      {scanCount === 1 ? "scan" : "scans"}
      {span ? ` (${span})` : ""}. It does not follow the 5d / 30d / 90d range toggle below.
    </p>
  );
}

export function TrajectoryPanel({
  forecast,
  scanCount,
}: {
  /** Fit over the FULL history, never the displayed range. Null when < 2 distinct scan days. */
  forecast: Forecast | null;
  /** Scans the fit saw — the same series the page fetched. */
  scanCount: number;
}) {
  const insufficient = forecastInsufficiency(forecast);

  if (insufficient || !forecast) {
    return (
      <section aria-labelledby="trajectory-heading">
        <h2 id="trajectory-heading" className="font-mono text-sm uppercase tracking-[0.2em] text-slate-500">
          All-time trajectory
        </h2>
        <Card className="mt-2">
          <p className="text-base text-slate-300">{insufficient}</p>
          <p className="mt-2 text-sm text-slate-500">
            Scan again over the coming weeks. The projection appears once there is enough spread to
            read a trend rather than noise.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section aria-labelledby="trajectory-heading">
      <h2 id="trajectory-heading" className="font-mono text-sm uppercase tracking-[0.2em] text-slate-500">
        All-time trajectory
      </h2>
      <div className="mt-2">
        <Trajectory forecast={forecast} />
      </div>
      <FitBasis scanCount={scanCount} forecast={forecast} />
    </section>
  );
}
