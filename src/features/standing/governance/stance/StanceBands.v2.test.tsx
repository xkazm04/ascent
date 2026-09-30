// @vitest-environment jsdom

// The published bands render as a ladder. The seeded org has no published stance, so this
// fixture is the reading the page cannot show.
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { RepoStanceCompliance } from "@/lib/org/stance";
import type { StanceOverview } from "@/lib/org/stance-overview";
import { StanceBandsV2 } from "./StanceBands.v2";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function repo(fullName: string, tier: RepoStanceCompliance["tier"]): RepoStanceCompliance {
  return {
    name: fullName.split("/")[1] ?? fullName,
    fullName,
    level: "L3",
    overall: 70,
    tier,
    ack: "current",
    ackedVersion: 1,
    provenancePct: null,
    sealed: false,
    findings: [],
    compliant: true,
  };
}

const overview = {
  org: "acme",
  stanceVersion: 1,
  repos: [repo("acme/api", "T0"), repo("acme/web", "T0"), repo("acme/docs", "T1"), repo("acme/bare", null)],
  stance: {
    permittedTools: [],
    permittedModels: [],
    noAiZones: [],
    reviewTiers: [
      { tier: "T0", review: "Normal review." },
      { tier: "T1", review: "One approval." },
      { tier: "T2", review: "Two approvals." },
    ],
    provenance: { requireTrailer: false, requireHumanApproval: false },
  },
} as unknown as StanceOverview;

describe("StanceBandsV2", () => {
  it("draws the four tiers as ladder steps and keeps unassessed repos out of them", () => {
    render(<StanceBandsV2 overview={overview} canEdit={false} />);
    const ladder = screen.getByRole("list", { name: "Autonomy tiers" });
    const steps = [...ladder.querySelectorAll("[data-role='ladder-step']")];
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual(["reached", "current", "open", "unmeasured"]);
    expect(screen.getByText("Normal review.")).toBeTruthy();
    expect(screen.getByText("Two approvals.")).toBeTruthy();
    expect(screen.getByText("No review requirement declared for this tier.")).toBeTruthy();
    expect(screen.getAllByText("No repo currently sits in this band.")).toHaveLength(2);
    const unassessed = screen.getByRole("region", { name: "Tier not assessed" });
    expect(within(unassessed).getByRole("link", { name: "bare" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Tier not assessed" })).toBeTruthy();
  });
});
