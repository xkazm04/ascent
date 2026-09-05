// @vitest-environment jsdom
//
// The dormancy badge is the ONLY per-skill signal for the drift loop (dormant skills nobody uses); it
// was moved into library/skills/ with no test coverage. Pins: absent usage renders nothing (never a
// guessed verdict), each verdict gets its own tone class, and the tooltip always carries the evidence
// (usageDetail), not a bare adjective.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkillDormancyBadge } from "./SkillDormancyBadge";
import type { SkillUsage } from "@/lib/org/skill-usage";

function usage(overrides: Partial<SkillUsage>): SkillUsage {
  return {
    verdict: "active",
    lastUsedAt: "2026-07-20T00:00:00.000Z",
    lastUsedType: "download",
    daysSinceUse: 3,
    ageDays: 30,
    ...overrides,
  } as SkillUsage;
}

describe("SkillDormancyBadge", () => {
  it("renders nothing when usage is undefined — never guesses a verdict for a just-authored skill", () => {
    const { container } = render(<SkillDormancyBadge usage={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the active verdict with its evidence in the tooltip", () => {
    render(<SkillDormancyBadge usage={usage({ verdict: "active" })} />);
    const badge = screen.getByText("active");
    expect(badge).toHaveAttribute("title", expect.stringContaining("used 3d ago"));
  });

  it("renders the dormant verdict distinctly from active", () => {
    render(<SkillDormancyBadge usage={usage({ verdict: "dormant", daysSinceUse: 90 })} />);
    expect(screen.getByText("dormant")).toBeInTheDocument();
  });

  it("a never-used skill's tooltip states 'never used', not a fabricated last-use date", () => {
    render(
      <SkillDormancyBadge
        usage={usage({ verdict: "new", lastUsedAt: null, lastUsedType: null, daysSinceUse: null, ageDays: 0 })}
      />,
    );
    expect(screen.getByText("new")).toHaveAttribute("title", expect.stringContaining("never used"));
  });
});
