// @vitest-environment jsdom
//
// G19 on the projected wall: a goal whose metric nothing has scored has no standing. The banner and
// the TV goal card say so in visible words, draw no meter, and print neither "0/60", "null", nor a
// "to goal" distance computed from a zero that was never observed.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GOAL_PCT_LABEL } from "@/lib/db/plan";
import type { GoalProgressView } from "@/components/org/shared/goalView";
import { GoalBanner } from "@/features/inflight/live/LiveWarRoomGoalBanner";
import { TvStanding, type TvStageData } from "@/features/inflight/live/LiveWarRoomTvStages";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

function goal(over: Partial<GoalProgressView> = {}): GoalProgressView {
  return {
    id: "g1",
    label: "Security to 60",
    metric: "D7",
    metricLabel: "Security",
    target: 60,
    current: null,
    pct: null,
    pctBasis: "unmeasured",
    pctLabel: GOAL_PCT_LABEL.unmeasured,
    achieved: false,
    status: "active",
    targetDate: null,
    pace: "tracking",
    perWeek: 0,
    trajectory: "flat",
    fitQuality: 0,
    etaDays: null,
    etaDate: null,
    requiredPerWeek: null,
    laggards: [],
    belowCount: 0,
    ...over,
  };
}

function stageData(g: GoalProgressView): TvStageData {
  return {
    slug: "acme",
    stats: { avgOverall: 63, avgAdoption: null, avgRigor: null, aiNative: 0, scored: 1, total: 1, postureCounts: {} },
    leaderboard: [],
    ticker: [],
    pct: 0,
    progress: { done: 0, total: 0, current: "" },
    deltas: null,
    goal: g,
    ops: {
      state: { triage: [], inFlight: [], landed: [], counts: { triage: 0, inFlight: 0, landed: 0 }, mockPrs: false },
      busy: {},
      accept: () => {},
      reject: () => {},
      onVerify: () => {},
    },
  };
}

describe("GoalBanner: an unmeasured goal", () => {
  it("states the absence in visible text and draws no meter", () => {
    const { container } = render(<GoalBanner slug="acme" goal={goal()} />);
    expect(screen.getByText(/Security not measured yet/)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container.textContent).not.toMatch(/\bnull\b|0\/60|to goal/);
  });

  it("guard: a measured goal keeps its meter and standing", () => {
    render(<GoalBanner slug="acme" goal={goal({ current: 42, pct: 70, pctBasis: "attainment", pctLabel: GOAL_PCT_LABEL.attainment })} />);
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText(/Security 42\/60/)).toBeTruthy();
  });
});

describe("TvStanding: an unmeasured goal", () => {
  it("states the absence in visible text and draws no meter", () => {
    const { container } = render(<TvStanding data={stageData(goal())} />);
    expect(screen.getByText(/Security not measured yet/)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container.textContent).not.toMatch(/\bnull\b|\b0\/60/);
  });
});
