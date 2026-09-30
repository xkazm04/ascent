// States the seeded org does not show: unscored fleet, null percentile, null impact, null leverage, goals, prior, ladder.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { executiveGoals } from "./ExecutiveLists.v2";
import { executiveMasthead } from "./ExecutiveMasthead.v2";
import { executivePrior } from "./ExecutivePrior.v2";
import { impactLedgerV2 } from "./ImpactLedger.v2";
import { leverageMovesV2 } from "./LeverageMoves.v2";
import { ProgramPanelV2 } from "./ProgramPanel.v2";
import { briefingGoal, execBriefing, execView, impactLedger, impactRow, orgRec } from "./executiveFixtures";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("./ExecutiveTabActions", () => ({ ExecutiveTabActions: () => null }));

const html = (node: ReactNode) => renderToStaticMarkup(node);

describe("executive prism fixtures", () => {
  it("shows an unscored fleet as not measured, not as 0", () => {
    const markup = html(executiveMasthead(execView()));
    expect(markup).toContain("No live score");
    expect(markup.split("not measured").length - 1).toBeGreaterThanOrEqual(4);
    expect(markup).not.toContain(">0<");
  });

  it("keeps a missing corpus percentile unknown beside real scores", () => {
    const markup = html(executiveMasthead(execView({
      briefing: execBriefing({
        realScoredCount: 4,
        mockCount: 0,
        maturity: { overall: 89, levelId: "L5", levelName: "Autonomous", adoption: 86, rigor: 91 },
        benchmark: { percentile: null, corpusRepos: 0, corpusAvgOverall: 0, cohort: null },
      }),
    })));
    expect(markup).toContain("The fleet stands at");
    expect(markup).toContain("L5 Autonomous");
    expect(markup).toContain("not measured");
    expect(markup).toContain("no corpus yet");
  });

  it("does not print an unverified delta or a null point total as zero", () => {
    const markup = html(impactLedgerV2("acme", impactLedger({
      mergedCount: 2,
      rows: [
        impactRow({ verified: false, impactDim: 5, impactOverall: 2 }),
        impactRow({ prNumber: 8, verified: true, impactDim: null, impactOverall: null, repoName: "web", repoFullName: "acme/web" }),
      ],
    }), "Last 90 days"));
    expect(markup).toContain("not measured");
    expect(markup).toContain("awaiting rescan");
    expect(markup).toContain("2026-09-01");
    expect(markup).not.toContain("+5");
    expect(markup).not.toContain("+2");
  });

  it("prints a verified zero as 0", () => {
    const markup = html(impactLedgerV2("acme", impactLedger({
      dimPoints: 0,
      verifiedCount: 1,
      awaitingRescan: 0,
      byDim: [{ dimId: "D1", points: 0, prs: 1 }],
      rows: [impactRow({ verified: true, impactDim: 0, impactOverall: 0 })],
    }), "Last 90 days"));
    expect(markup).toContain("tabular-nums text-white\">0");
  });

  it("draws an unprojected gap as not measured", () => {
    const markup = html(leverageMovesV2([orgRec()], "acme"));
    expect(markup).toContain("not measured");
    expect(markup).toContain("AI Tooling and Conventions");
    expect(markup).not.toContain("—");
  });

  it("treats a null goal percent as unknown and 0% as a real zero", () => {
    expect(html(executiveGoals([briefingGoal()]))).toContain("not measured");
    const zero = html(executiveGoals([briefingGoal({ current: 0, pct: 0, pctBasis: "attainment", pctLabel: "of target" })]));
    expect(zero).toContain("0%");
    expect(zero).not.toContain("not measured");
  });

  it("renders the previous window in paper figures", () => {
    const markup = html(executivePrior(
      {
        overall: 80, adoption: 70, rigor: 75, dOverall: 9, dAdoption: 0, dRigor: -2, realScoredCount: 4,
        dims: [{ dimId: "D4", label: "Agentic Workflows", now: 66, prior: 70, delta: -4 }],
      },
      { overall: 89, adoption: 70, rigor: 73 },
    ));
    expect(markup).toContain("from 80");
    expect(markup).toContain("Agentic Workflows");
    expect(markup).toContain(">66<");
  });

  it("shows the programme ladder as unmeasured when nothing is scored", () => {
    const markup = html(<ProgramPanelV2 slug="acme" initial={null} now={null} />);
    expect(markup).toContain("data-tour=\"transition-program\"");
    expect(markup).toContain("id=\"program-name\"");
    expect(markup).toContain("Start programme");
    expect(markup.split("not measured").length - 1).toBeGreaterThanOrEqual(5);
  });
});
