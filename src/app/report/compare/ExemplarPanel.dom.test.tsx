// @vitest-environment jsdom
//
// The exemplar panel's on-screen honesty rules (moonshot #34). Three things must always be true:
//  - both directions render (has AND lacks) — a one-directional panel reads as a ranking of teams;
//  - the basis and the "signal-level, not semantic" caveat are ALWAYS present, because the whole
//    panel is built on textual set-difference and the reader has to know that;
//  - every failure state says the comparison was NOT made and names no substitute exemplar.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExemplarFailureNotice, ExemplarPanel } from "./ExemplarPanel";
import { diffAcrossRepos, transferJoin, type ExemplarProfile } from "@/lib/report/exemplar";
import type { ComparableDimension, ComparableScan } from "@/lib/db/scans";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

function dim(dimId: string, o: { score?: number; evidence?: string[]; gaps?: string[] } = {}): ComparableDimension {
  return {
    dimId,
    name: dimId === "D2" ? "Testing" : `${dimId} name`,
    score: o.score ?? 50,
    signalScore: o.score ?? 50,
    evidence: o.evidence ?? [],
    gaps: o.gaps ?? [],
  };
}

function subject(dimensions: ComparableDimension[]): ComparableScan {
  return {
    id: "s1", scannedAt: "2026-08-01T00:00:00.000Z", overallScore: 61, level: "L3", levelName: "Established",
    archetype: "team", adoptionScore: 55, rigorScore: 66, posture: "balanced", confidence: 0.8,
    engineProvider: "claude-cli", engineModel: "sonnet", headSha: null, dimensions, recommendations: [],
  };
}

function profile(dimensions: ComparableDimension[], over: Partial<ExemplarProfile> = {}): ExemplarProfile {
  return {
    key: "repo:acme/api", kind: "repo", label: "acme/api", repoFullName: "acme/api",
    scannedAt: "2026-08-02T00:00:00.000Z", overallScore: 75, dimensions, population: null,
    basis: { rubric: "r10", excludesMockEngine: true, minSupport: null },
    ...over,
  };
}

const richDiff = diffAcrossRepos(
  subject([
    dim("D2", { score: 40, evidence: ["Snapshot suite present"], gaps: ["No coverage gate"] }),
    dim("D5", { score: 55 }),
  ]),
  profile([dim("D2", { score: 62, evidence: ["Coverage tracking configured"] })]),
);

function renderPanel(diff = richDiff) {
  return render(<ExemplarPanel diff={diff} transfers={transferJoin(diff, [], "acme")} markdown="## Against exemplar" />);
}

describe("ExemplarPanel", () => {
  it("renders BOTH directions — what they have and what this repo has that they don't", () => {
    renderPanel();
    expect(screen.getByText(/they have · you lack/i)).toBeInTheDocument();
    expect(screen.getByText("Coverage tracking configured")).toBeInTheDocument();
    expect(screen.getByText(/you have that they don't \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Snapshot suite present")).toBeInTheDocument();
  });

  it("always carries the basis and the signal-level caveat", () => {
    renderPanel();
    expect(screen.getByText(/rubric r10 · mock-engine scans excluded/i)).toBeInTheDocument();
    expect(screen.getByText(/signal-level, not semantic/i)).toBeInTheDocument();
    expect(screen.getByText(/has \/ lacks/i)).toBeInTheDocument();
  });

  it("marks a one-sided dimension not comparable and claims no gap for it", () => {
    renderPanel();
    expect(screen.getByText(/D5 — scored on only one side, so no gap is claimed/i)).toBeInTheDocument();
  });

  it("names the practice that transfers the missing signals", () => {
    renderPanel();
    expect(screen.getByText("Test discipline")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open in practices/i })).toBeInTheDocument();
  });

  it("says the cohort population and support threshold instead of naming a repo", () => {
    const cohort = diffAcrossRepos(
      subject([dim("D2", { score: 40 })]),
      profile([dim("D2", { score: 70, evidence: ["SAST in CI"] })], {
        kind: "cohort", key: "cohort:lang:Go", label: "Go · top decile", repoFullName: null,
        scannedAt: null, population: 31, basis: { rubric: "r10", excludesMockEngine: true, minSupport: 3 },
      }),
    );
    renderPanel(cohort);
    expect(screen.getByText(/31 repos in the cohort/)).toBeInTheDocument();
    expect(screen.getByText(/signal carried by ≥3 of the top decile/)).toBeInTheDocument();
  });

  it("gives a real answer, not an empty panel, when nothing transfers", () => {
    const flat = diffAcrossRepos(subject([dim("D2", { evidence: ["x"] })]), profile([dim("D2", { evidence: ["X"] })]));
    renderPanel(flat);
    expect(screen.getByText(/nothing this exemplar has is missing here/i)).toBeInTheDocument();
  });

  it("states an ineligible subject rather than hiding the mismatch", () => {
    const d = diffAcrossRepos(subject([dim("D2")]), profile([dim("D2")]), { subjectEligible: false });
    renderPanel(d);
    expect(screen.getByText(/measured with different instruments/i)).toBeInTheDocument();
  });
});

describe("ExemplarFailureNotice", () => {
  it("renders the floor and the population for a below-floor cohort", () => {
    render(<ExemplarFailureNotice failure={{ kind: "below-floor", population: 4, min: 5 }} />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("4");
    expect(notice).toHaveTextContent("5");
    expect(notice).toHaveTextContent(/no comparison was made/i);
  });

  it.each([
    [{ kind: "unparseable", raw: "org:worst" } as const, /isn't an exemplar we recognise/i],
    [{ kind: "not-found" } as const, /nothing was substituted/i],
    [{ kind: "forbidden" } as const, /can't be its own exemplar/i],
    [{ kind: "unavailable" } as const, /unavailable right now/i],
  ])("says the comparison was not made for %j", (failure, pattern) => {
    render(<ExemplarFailureNotice failure={failure} />);
    expect(screen.getByRole("status")).toHaveTextContent(pattern);
  });
});
