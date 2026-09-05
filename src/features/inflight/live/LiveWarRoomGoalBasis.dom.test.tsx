// @vitest-environment jsdom
//
// The wall's goal meter must say WHICH question its percentage answers.
//
// A goal created before baselines existed can only report ATTAINMENT (current over target), so its
// bar opens near-full; a goal with a baseline reports PROGRESS since it was set and opens empty.
// Both of these surfaces are PROJECTED in a room — nobody hovers, nobody has a screen reader — so
// the basis must be VISIBLE text, not only a tooltip or an accessible name. These pin that.

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
    label: "Fleet to 70",
    metric: "avgOverall",
    metricLabel: "Avg overall",
    target: 70,
    current: 63,
    pct: 90,
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

const ATTAINMENT = { pctBasis: "attainment" as const, pctLabel: GOAL_PCT_LABEL.attainment };
const PROGRESS = { pctBasis: "progress" as const, pctLabel: GOAL_PCT_LABEL.progress };

function stageData(g: GoalProgressView | null): TvStageData {
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

describe("GoalBanner — the live wall's goal meter", () => {
  it("shows the attainment marker in VISIBLE text (the wall has no hover)", () => {
    render(<GoalBanner slug="acme" goal={goal(ATTAINMENT)} />);
    expect(screen.getByText(/of target/)).toBeTruthy();
  });

  it("names the meter with the basis caption, verbatim from GOAL_PCT_LABEL", () => {
    render(<GoalBanner slug="acme" goal={goal(ATTAINMENT)} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe(
      `Fleet to 70: 63 of 70 — ${GOAL_PCT_LABEL.attainment}`,
    );
  });

  it("leaves a progress goal unmarked but still names its meter", () => {
    render(<GoalBanner slug="acme" goal={goal(PROGRESS)} />);
    expect(screen.queryByText(/of target/)).toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe(
      `Fleet to 70: 63 of 70 — ${GOAL_PCT_LABEL.progress}`,
    );
  });

  it("still renders an older payload carrying neither basis field", () => {
    render(<GoalBanner slug="acme" goal={goal()} />);
    expect(screen.queryByText(/of target/)).toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("Fleet to 70: 63 of 70");
  });
});

describe("TvStanding — the TV stage's goal card", () => {
  it("shows the attainment marker in VISIBLE text, read from across a room", () => {
    render(<TvStanding data={stageData(goal(ATTAINMENT))} />);
    expect(screen.getByText("of target")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe(
      `Fleet to 70: 63 of 70 — ${GOAL_PCT_LABEL.attainment}`,
    );
  });

  it("leaves a progress goal unmarked — its bar already means what a progress bar means", () => {
    render(<TvStanding data={stageData(goal(PROGRESS))} />);
    expect(screen.queryByText("of target")).toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe(
      `Fleet to 70: 63 of 70 — ${GOAL_PCT_LABEL.progress}`,
    );
  });
});
