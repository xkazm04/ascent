// @vitest-environment jsdom
//
// Pins the "honest simulated-mode verdicts" UI gate on the Map view's action rail. The rail turns the
// concern cohorts into work lists; two of them are money- & plan-framed ("Reclaim seats on" for idle,
// "Bring under a plan" for shadow). Those dollars are a placeholder until a provider is connected, so in
// simulated mode the rail must WITHHOLD them and offer a connect prompt instead — while still showing
// the git-real governance cohort ("Require review on" for ungoverned). measured mode shows them all.
//
// The model is built by hand (not via buildAiDeliveryModel) with idle/shadow repos PRESENT even in the
// simulated fixture, so the assertion proves the presentation layer suppresses them independent of the
// model's own classify() gating.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AiRoiQuadrant } from "./AiRoiQuadrant";
import type { AiDeliveryModel, AiRepoRoi, ModelFidelity, Verdict } from "./aiDeliveryModel";

function repo(over: Partial<AiRepoRoi> & { name: string; verdict: Verdict }): AiRepoRoi {
  return {
    fullName: `acme/${over.name}`,
    prs: 100,
    aiInvolvedRate: 40,
    aiPRs: 40,
    governedRate: 50,
    reviewedRate: 60,
    tool: "Claude",
    planned: true,
    seats: 10,
    monthlySpend: 800,
    costPerAiPr: 20,
    ...over,
  };
}

function model(fidelity: ModelFidelity): AiDeliveryModel {
  const repos = [
    repo({ name: "risky", verdict: "ungoverned", governedRate: 20, monthlySpend: 900 }),
    repo({ name: "waste", verdict: "idle", aiInvolvedRate: 4, aiPRs: 4, monthlySpend: 1200 }),
    repo({ name: "ghost", verdict: "shadow", planned: false, monthlySpend: 0, seats: 0 }),
    repo({ name: "good", verdict: "working", governedRate: 90 }),
  ];
  const counts: Record<Verdict, number> = { working: 1, ungoverned: 1, idle: 1, shadow: 1, starter: 0 };
  return {
    fidelity,
    tools: [{ name: "Claude", count: 4 }],
    repos,
    summary: {
      repos: repos.length,
      totalMonthlySpend: 2900,
      annualSpend: 34_800,
      totalSeats: 30,
      totalAiPRs: 84,
      totalPRs: 400,
      aiShareOfPRs: 21,
      governedAiShare: 55,
      idleSpend: 1200,
      ungovernedSpend: 900,
      shadowRepos: 1,
      costPerAiPr: 35,
      counts,
    },
  };
}

afterEach(cleanup);

describe("AiRoiQuadrant action rail — simulated mode", () => {
  it("withholds the money-framed cohorts (idle 'Reclaim seats', shadow 'Bring under a plan')", () => {
    render(<AiRoiQuadrant model={model("simulated")} slug="acme" />);
    expect(screen.queryByText(/Reclaim seats on/i)).toBeNull();
    expect(screen.queryByText(/Bring under a plan/i)).toBeNull();
  });

  it("keeps the git-real governance cohort ('Require review on')", () => {
    render(<AiRoiQuadrant model={model("simulated")} slug="acme" />);
    expect(screen.getByText(/Require review on/i)).toBeInTheDocument();
  });

  it("offers a connect-a-provider prompt in place of the withheld cohorts (invitation pattern intact)", () => {
    render(<AiRoiQuadrant model={model("simulated")} slug="acme" />);
    expect(screen.getByText(/reclaimable seats and unplanned AI/i)).toBeInTheDocument();
  });
});

describe("AiRoiQuadrant action rail — measured mode (unchanged)", () => {
  it("renders every concern cohort including the money-framed ones", () => {
    render(<AiRoiQuadrant model={model("measured")} slug="acme" />);
    expect(screen.getByText(/Require review on/i)).toBeInTheDocument();
    expect(screen.getByText(/Reclaim seats on/i)).toBeInTheDocument();
    expect(screen.getByText(/Bring under a plan/i)).toBeInTheDocument();
    // The measured rail shows real spend and no simulated connect prompt.
    expect(screen.queryByText(/reclaimable seats and unplanned AI/i)).toBeNull();
  });
});
