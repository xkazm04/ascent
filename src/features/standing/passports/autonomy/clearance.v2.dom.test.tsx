// @vitest-environment jsdom
// The Prism clearance ladder and the per-repo tier rail render as Ladder steps.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Ladder } from "@/components/kit";
import { clearanceBands, clearanceEdge } from "./clearanceLadder";
import { clearanceLadderSteps } from "./clearanceSteps";
import { ClearanceEntryV2 } from "./ClearanceEntry.v2";
import type { RepoAutonomy } from "./autonomyModel";

const fleet = [
  { fullName: "acme/a", name: "a", tier: 2, engine: "claude" },
  { fullName: "acme/b", name: "b", tier: 1, engine: "mock" },
] as RepoAutonomy[];

function entry(engine: string | null): RepoAutonomy {
  return {
    fullName: "acme/api",
    name: "api",
    purpose: "API",
    tier: 2,
    nextTier: 3,
    gates: [
      {
        id: "tests",
        label: "Tests",
        short: "Tests",
        status: "pass",
        score: 80,
        evidence: "Suite present.",
        action: "Keep the suite.",
        source: "scan",
        gatesTier: 1,
      },
    ],
    blocking: ["CI does not gate merges."],
    blockingIds: [],
    nextProgress: 40,
    autoScore: 70,
    prodScore: 60,
    band: "beta",
    stack: ["node"],
    confidence: 0.9,
    lastScanAt: null,
    engine,
  };
}

describe("clearance ladder markup", () => {
  it("renders the fleet register as ladder steps, placeholder tier not measured", () => {
    const { container } = render(
      <Ladder label="Clearances held across the fleet" steps={clearanceLadderSteps(clearanceBands(fleet), clearanceEdge(fleet))} />,
    );
    const states = [...container.querySelectorAll("[data-role='ladder-step']")].map((node) => node.getAttribute("data-state"));
    expect(states).toEqual(["open", "unmeasured", "reached", "open", "unmeasured"]);
    expect(container.querySelector("[data-kit='ladder']")?.getAttribute("aria-label")).toBe("Clearances held across the fleet");
  });

  it("renders a graded repo rail with the held rung current", () => {
    const { container } = render(<ClearanceEntryV2 repo={entry("claude")} />);
    const states = [...container.querySelectorAll("[data-role='ladder-step']")].map((node) => node.getAttribute("data-state"));
    expect(states).toEqual(["reached", "reached", "current", "open"]);
    expect(container.querySelector("[aria-current='step']")?.textContent).toContain("T2");
  });

  it("renders a placeholder repo rail as not measured up to the issued floor", () => {
    const { container } = render(<ClearanceEntryV2 repo={entry("mock")} />);
    const states = [...container.querySelectorAll("[data-role='ladder-step']")].map((node) => node.getAttribute("data-state"));
    expect(states).toEqual(["unmeasured", "unmeasured", "unmeasured", "open"]);
    expect(container.textContent).toContain("not measured");
  });
});
