// @vitest-environment jsdom
//
// The rendered half of governanceGaps.test.ts: that the `declared` cell actually reaches the drawing
// as a dashed, unfilled mark rather than being flattened back into a tick. A rule that requires a
// pull request and zero approving reviews gates nothing, and the whole reason to draw this grid
// instead of listing ✓ glyphs is that "declared, not enforced" has a shape.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { GovernanceGapMatrix } from "./GovernanceGapMatrix";
import { governanceGapRows } from "./governanceGaps";
import type { RepoGovernance } from "@/lib/db";

const repo = (over: Partial<RepoGovernance> = {}): RepoGovernance =>
  ({
    fullName: "acme/web",
    name: "web",
    protected: true,
    requiresPullRequest: true,
    requiredApprovals: 1,
    requiresStatusChecks: false,
    requiresSignatures: false,
    ruleCount: 2,
    ...over,
  }) as RepoGovernance;

describe("GovernanceGapMatrix", () => {
  it("draws a self-mergeable PR rule as declared: dashed outline, no fill", () => {
    const { container } = render(<GovernanceGapMatrix rows={governanceGapRows([repo({ requiredApprovals: 0 })])} />);
    const cell = container.querySelector('[data-cell="acme/web:Reviews"]');
    expect(cell?.getAttribute("data-state")).toBe("declared");
    const mark = cell?.querySelector("[data-mark]");
    expect(mark?.getAttribute("fill")).toBe("none");
    expect(mark?.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("draws an observed absence as a measured OFF, not as a missing measurement", () => {
    const { container } = render(<GovernanceGapMatrix rows={governanceGapRows([repo({ protected: false })])} />);
    expect(container.querySelector('[data-cell="acme/web:Protected"]')?.getAttribute("data-state")).toBe("measured");
  });

  it("carries an sr-only equivalent naming the declared state in words", () => {
    const { container } = render(<GovernanceGapMatrix rows={governanceGapRows([repo({ requiredApprovals: 0 })])} />);
    expect(container.querySelector("table.sr-only")?.textContent).toMatch(/Declared, not enforced/);
  });

  it("degrades to a labelled placeholder when no repository is missing a guardrail", () => {
    const { container } = render(<GovernanceGapMatrix rows={[]} />);
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toMatch(/no repository is missing a guardrail/i);
  });
});
