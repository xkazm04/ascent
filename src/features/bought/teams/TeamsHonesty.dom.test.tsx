// @vitest-environment jsdom
//
// Teams' half of "Teams and Contributors get Delivery's honesty":
//   - the Δ footnote is derived from the same label the column uses (it used to hard-code "each
//     repo's two latest scans" under a period-scoped Δ);
//   - the AI% cell carries the population it rests on in the ROW, not only in the expanded detail;
//   - the standings provenance stamp says when a fleet-wide capture is being shown under a filter;
//   - the panel degrades per section instead of blanking the tab (asserted at the source level, the
//     way champion-overflow.test.ts pins its fix: the panel is an async server component whose four
//     db reads cannot be rendered here).

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { deltaFootnote } from "./teamsShared";
import { TeamsMatrix } from "./TeamsMatrix";
import { TeamsStandings } from "./TeamsStandings";
import type { TeamRollup } from "@/lib/db";
import type { TeamStandings as TeamStandingsModel } from "@/lib/org/teamStandings";

const PANEL = fs.readFileSync(path.resolve(__dirname, "TeamsRollupPanel.tsx"), "utf8");

const team = (over: Partial<TeamRollup> = {}): TeamRollup =>
  ({
    slug: "platform",
    name: "platform",
    repoCount: 3,
    totalOwned: 3,
    defaultOwnerCount: 1,
    avgOverall: 70,
    avgAdoption: 60,
    avgRigor: 65,
    aiCommitShare: 50,
    contributors: 12,
    aiContributors: 4,
    champions: [],
    knowledgeScore: 55,
    comparedRepos: 0,
    improving: 0,
    declining: 0,
    avgDelta: 0,
    dimAverages: [],
    repos: [],
    ...over,
  }) as unknown as TeamRollup;

describe("deltaFootnote", () => {
  it("names the two-latest-scans semantics only when the rollup was NOT windowed", () => {
    expect(deltaFootnote("since last scan")).toBe("each repo's two latest scans");
  });

  it("names the selected period when the Δ column is period-scoped", () => {
    expect(deltaFootnote("vs 30d ago")).toBe("the selected period (vs 30d ago)");
  });

  it("is what the panel actually renders — no second hand-written copy of the claim", () => {
    expect(PANEL).toMatch(/Δ compares \{deltaFootnote\(deltaLabel\)\}/);
    expect(PANEL).not.toMatch(/compares each repo&apos;s two latest scans/);
  });
});

describe("TeamsMatrix AI% cell", () => {
  it("carries the contributor population in the row, visibly and in the title", () => {
    render(<TeamsMatrix teams={[team()]} dims={[]} />);
    expect(screen.getByText("4/12")).toBeTruthy();
    expect(document.querySelector('[title*="4 of 12 contributors"]')).toBeTruthy();
  });

  it("says 'contributor' in the singular for a one-person team", () => {
    render(<TeamsMatrix teams={[team({ contributors: 1, aiContributors: 1 })]} dims={[]} />);
    expect(document.querySelector('[title*="1 of 1 contributor "]')).toBeTruthy();
  });
});

describe("TeamsStandings provenance stamp", () => {
  const standings = {
    teamCount: 3,
    fleetAvgOverall: 60,
    spread: 20,
    maxAbsDelta: 10,
    leader: { slug: "platform", avgOverall: 70, factors: [], contributors: 10, aiContributors: 4, champions: [], comparedRepos: 0, avgDelta: 0, improving: 0, declining: 0 },
    laggard: { slug: "mobile", avgOverall: 50, factors: [], contributors: 8, aiContributors: 1, champions: [], comparedRepos: 0, avgDelta: 0, improving: 0, declining: 0 },
  } as unknown as TeamStandingsModel;

  it("says the capture is fleet-wide when a scope filter is active", () => {
    const { container } = render(
      <TeamsStandings
        standings={standings}
        capturedAt={new Date("2026-09-01T00:00:00Z")}
        capturedScopeNote="captured fleet-wide, not for this filter"
      />,
    );
    expect(container.textContent).toMatch(/captured fleet-wide, not for this filter/);
  });

  it("adds nothing when the standings are unfiltered", () => {
    const { container } = render(<TeamsStandings standings={standings} capturedAt={new Date()} />);
    expect(container.textContent).not.toMatch(/fleet-wide, not for this filter/);
  });
});

describe("TeamsRollupPanel degrades per section", () => {
  it("settles each read instead of rejecting the whole tab on one blip", () => {
    expect(PANEL).toMatch(/Promise\.allSettled/);
    expect(PANEL).not.toMatch(/await Promise\.all\(/);
    expect(PANEL).toMatch(/import \{ settle \} from "@\/features\/bought\/delivery\/deliveryLoad"/);
  });

  it("distinguishes a failed rollup from an org with no CODEOWNERS attribution", () => {
    expect(PANEL).toMatch(/Team attribution couldn&apos;t load right now/);
  });

  it("says the decisions annotations are missing rather than showing none silently", () => {
    expect(PANEL).toMatch(/Recorded decisions couldn&apos;t load right now/);
  });

  it("joins the provenance read into the settled set instead of awaiting it serially", () => {
    // `\r?\n`, not `\n`: this assertion reads the panel's SOURCE TEXT, so a bare `\n`
    // makes the test pass or fail on the checkout's line endings rather than on the
    // code. It was green in CI (Linux, LF) and red on Windows (CRLF) until 2026-09-08.
    expect(PANEL).toMatch(/getTeamStandingsProvenance\(slug\),\r?\n\s*\]\)/);
  });

  it("takes its window from orgWindowBounds, not a hand-written inclusive pair", () => {
    expect(PANEL).toMatch(/orgWindowBounds\(period\)/);
    expect(PANEL).not.toMatch(/\{ start: period\.start, end: period\.end \}/);
  });
});
