// @vitest-environment jsdom
//
// "Org AI commit share 32%" with no population is the one tile on this grid that used to state a
// rate without saying what it was a rate OF, while every tile beside it carries its own ({aiActive}/
// {total}, "{prs} PRs analyzed"). These pin the denominator at the render layer — including the case
// where it is genuinely unavailable, which must drop the count rather than print a 0 that reads as
// "no commits".

import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import type { AdoptionOverview } from "@/lib/org/adoption";

const { mockBuild } = vi.hoisted(() => ({ mockBuild: vi.fn() }));

vi.mock("@/lib/org/adoption", () => ({ buildAdoptionOverview: mockBuild, adoptionMarkdown: () => "# brief" }));
vi.mock("@/lib/org/scope", () => ({
  resolveOrgScope: async () => ({ segments: [], segmentId: null, techGroups: [], activeStack: null, techGroupId: null }),
}));
vi.mock("@/components/org/shared/ScopeFilterBar", () => ({ ScopeFilterBar: () => <div data-testid="scope-bar" /> }));
vi.mock("@/components/CopyForLlm", () => ({ CopyForLlm: () => <button type="button">Copy</button> }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { AdoptionOverviewPanel } = await import("./AdoptionOverviewPanel");

const overview = (over: Partial<AdoptionOverview> = {}): AdoptionOverview => ({
  org: "acme",
  generatedOn: "2026-09-05",
  contributors: { total: 40, aiActive: 18, aiActiveShare: 45 },
  orgAiShare: 32,
  orgCommits: 4120,
  distribution: { high: 6, some: 12, none: 22 },
  champions: [],
  delivery: null,
  knowledgeLeader: null,
  tools: [],
  teams: [],
  teamPairing: null,
  enablement: [],
  ...over,
});

async function renderPanel(a: AdoptionOverview | null) {
  mockBuild.mockResolvedValue(a);
  return render(await AdoptionOverviewPanel({ slug: "acme", sp: {} }));
}

describe("AdoptionOverviewPanel — the commit-share tile states its population", () => {
  it("puts the commit count beside the share, like every neighbouring tile", async () => {
    const { container } = await renderPanel(overview());
    expect(screen.getByText("32%")).toBeTruthy();
    expect(container.textContent ?? "").toContain("4,120 commits");
  });

  it("drops the count — never a 0 — when the naming floor withheld the rows it is summed from", async () => {
    const { container } = await renderPanel(overview({ orgCommits: null }));
    const text = container.textContent ?? "";
    expect(screen.getByText("32%")).toBeTruthy();
    expect(text).toContain("commit-weighted");
    expect(text).not.toContain("0 commits");
  });

  it("keeps every other tile's population intact beside it", async () => {
    const { container } = await renderPanel(
      overview({ delivery: { typicalHoursToMerge: 12, reviewedRate: 80, mergeRate: 70, aiInvolvedRate: 40, aiGovernedRate: 65, prs: 33 } }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("18/40");
    expect(text).toContain("33 PRs analyzed");
  });
});
