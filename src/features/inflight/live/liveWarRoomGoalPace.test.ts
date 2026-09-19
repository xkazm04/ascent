// THE WALL PACECHIP USES THE SHARED PRESENTABILITY GATE.
//
// GoalBanner / TvStanding used to mount PaceChip unconditionally, so a fit resting on two scan
// days still printed "On pace" / "Behind" on the projected wall — the same unpresentable slope
// the briefing refuses. The gate is `composeTrajectory`, not `series !== undefined`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeTrajectory,
  forecastTrajectory,
  isProjectable,
  MIN_FORECAST_POINTS,
  MIN_FORECAST_SPAN_DAYS,
} from "@/lib/maturity/forecast";
import { wallGoalTrajectoryRead } from "./liveWarRoomGoalPace";

const live = (...parts: string[]) => readFileSync(join(process.cwd(), "src/features/inflight/live", ...parts), "utf8");

function series(n: number, stepDays: number): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    out.push({
      date: new Date(start + i * stepDays * 86_400_000).toISOString().slice(0, 10),
      value: 50 + i * 2,
    });
  }
  return out;
}

describe("wallGoalTrajectoryRead", () => {
  it("is the same composed read the briefing uses", () => {
    const pts = series(MIN_FORECAST_POINTS + 3, 10);
    expect(wallGoalTrajectoryRead(pts)).toEqual(composeTrajectory(forecastTrajectory(pts)));
    expect(isProjectable(forecastTrajectory(pts))).toBe(true);
    expect(wallGoalTrajectoryRead(pts).headline).not.toBeNull();
  });

  it("refuses a thin span the same way the briefing does", () => {
    const read = wallGoalTrajectoryRead(series(MIN_FORECAST_POINTS, 1));
    expect(read.headline).toBeNull();
    expect(read.insufficiency).toContain(`at least ${MIN_FORECAST_SPAN_DAYS}`);
  });

  it("refuses a two-point fit — a line through two points fits perfectly", () => {
    const read = wallGoalTrajectoryRead(series(MIN_FORECAST_POINTS - 1, 60));
    expect(read.headline).toBeNull();
    expect(read.insufficiency).not.toBeNull();
  });

  it("says nothing at all when there is no fit — absence is not a refusal", () => {
    expect(wallGoalTrajectoryRead(undefined)).toEqual({
      headline: null,
      confidence: null,
      basis: null,
      insufficiency: null,
    });
    expect(wallGoalTrajectoryRead([]).insufficiency).toBeNull();
  });
});

describe("the wall mounts WallPaceChip, not an ungated PaceChip", () => {
  it("GoalBanner composes the read rather than always printing goal.pace", () => {
    const src = live("LiveWarRoomGoalBanner.tsx");
    expect(src).toContain("WallPaceChip");
    expect(src).not.toContain("<PaceChip");
  });

  it("TvStanding uses the same chip so TV cannot contradict the banner", () => {
    const src = live("LiveWarRoomTvStages.tsx");
    expect(src).toContain("WallPaceChip");
    expect(src).not.toContain("<PaceChip");
  });
});
