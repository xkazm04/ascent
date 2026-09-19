// @vitest-environment jsdom
//
// Gate: an invalid owner segment 404s. A register miss does not — persistence-off, a thrown
// read, and an empty-but-valid owner each keep the H1 and render a distinct non-404 body.
// Failure is not "this owner does not exist"; absence is not a score of 0.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getPublicOrgScorecard, notFound } = vi.hoisted(() => ({
  getPublicOrgScorecard: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/register/data", () => ({ getPublicOrgScorecard }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/Brand", () => ({
  SiteHeader: () => <header />,
  SiteFooter: () => <footer />,
}));
vi.mock("@/components/leaderboard/ScorecardSummary", () => ({
  ScorecardSummary: ({ card }: { card: { owner: string; avgOverall: number } }) => (
    <div>
      summary {card.owner} {card.avgOverall}/100
    </div>
  ),
}));
vi.mock("@/components/leaderboard/LeaderboardTable", () => ({
  LeaderboardTable: () => <div>table</div>,
}));
vi.mock("@/components/leaderboard/RegisterPager", () => ({
  RegisterCta: () => <div>cta</div>,
}));

import ScorecardPage from "./page";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";

const params = (owner: string) => ({ params: Promise.resolve({ owner }) });

beforeEach(() => vi.clearAllMocks());

describe("/scorecard/[owner] — invalid owner is a 404; a register miss is not", () => {
  it("404s an invalid owner segment and does not read the register", async () => {
    await expect(ScorecardPage(params("acme/api"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(getPublicOrgScorecard).not.toHaveBeenCalled();
  });

  it("renders Scorecard unavailable (not 404) when the register read is unavailable", async () => {
    getPublicOrgScorecard.mockResolvedValue({ kind: "unavailable" });
    render(await ScorecardPage(params("acme")));

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "acme" })).toBeTruthy();
    expect(screen.getByText("Scorecard unavailable")).toBeTruthy();
    expect(screen.queryByText("No public scans yet")).toBeNull();
    expect(screen.queryByText(/\/100/)).toBeNull();
  });

  it("renders Scorecard unavailable (not 404) when the register read throws", async () => {
    getPublicOrgScorecard.mockRejectedValue(new Error("too many clients"));
    render(await ScorecardPage(params("acme")));

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByText("Scorecard unavailable")).toBeTruthy();
    expect(screen.queryByText("No public scans yet")).toBeNull();
  });

  it("renders No public scans yet (not 404, not a score of 0) for an empty-but-valid owner", async () => {
    getPublicOrgScorecard.mockResolvedValue({ kind: "empty", owner: "acme" });
    render(await ScorecardPage(params("acme")));

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "acme" })).toBeTruthy();
    expect(screen.getByText("No public scans yet")).toBeTruthy();
    expect(screen.getByText(/absence is not a score of 0/i)).toBeTruthy();
    expect(screen.queryByText("Scorecard unavailable")).toBeNull();
    expect(screen.queryByText(/\/100/)).toBeNull();
  });

  it("renders the scored card when the register read is ok", async () => {
    getPublicOrgScorecard.mockResolvedValue({
      kind: "ok",
      card: {
        owner: "Acme",
        avgOverall: 80,
        avgAdoption: 70,
        avgRigor: 90,
        dimensions: {},
        level: "L3",
        levelName: "Established",
        repoCount: 1,
        verifiedCount: 1,
        scannedAt: "2026-07-20T00:00:00.000Z",
        repos: [
          {
            owner: "Acme",
            name: "api",
            fullName: "Acme/api",
            level: "L3",
            levelName: "Established",
            overall: 80,
            adoption: 70,
            rigor: 90,
            dimensions: {},
            primaryLanguage: "TypeScript",
            stars: 1,
            scannedAt: "2026-07-20T00:00:00.000Z",
            href: "/report/Acme/api",
            engineProvider: "anthropic",
            verified: true,
            confidence: 0.9,
            hasProcessSignals: true,
            rubricVersion: SCORING_RUBRIC_VERSION,
            currentRubric: true,
          },
        ],
        rubricVersion: SCORING_RUBRIC_VERSION,
        staleRubricCount: 0,
      },
    });
    render(await ScorecardPage(params("acme")));

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Acme" })).toBeTruthy();
    expect(screen.getByText("summary Acme 80/100")).toBeTruthy();
    expect(screen.queryByText("Scorecard unavailable")).toBeNull();
    expect(screen.queryByText("No public scans yet")).toBeNull();
  });
});
