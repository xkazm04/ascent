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

  // ── The three dormant states, which the badge used to render as one amber adjective ────────────
  // `abandoned` (tried, then silence), `unused` (never used, pathway works) and `unmeasured` (this
  // org has never emitted a skill event at all) call for three different actions, and only the first
  // is a prune candidate. A badge that says "dormant" for all three is a recommendation to delete a
  // skill on the strength of an instrument nobody switched on.

  it("says 'never used' rather than 'dormant' where the pathway works and nobody reached for it", () => {
    render(
      <SkillDormancyBadge
        usage={usage({ verdict: "dormant", state: "unused", lastUsedAt: null, lastUsedType: null, daysSinceUse: null })}
      />,
    );
    expect(screen.getByText("never used")).toBeInTheDocument();
    expect(screen.queryByText("dormant")).toBeNull();
  });

  it("an unmeasured skill is 'not measured' and its tooltip never claims it went unused", () => {
    render(
      <SkillDormancyBadge
        usage={usage({
          verdict: "dormant",
          state: "unmeasured",
          lastUsedAt: null,
          lastUsedType: null,
          daysSinceUse: null,
          ageDays: 200,
        })}
      />,
    );
    const badge = screen.getByText("not measured");
    expect(badge).toHaveAttribute("title", expect.stringContaining("no skill events recorded in this org"));
    expect(badge.getAttribute("title")).not.toMatch(/never used/);
  });

  it("carries the state as the mark, so the badge and the tab's charts paint one vocabulary", () => {
    const { container, rerender } = render(
      <SkillDormancyBadge usage={usage({ verdict: "dormant", state: "unmeasured", lastUsedAt: null, daysSinceUse: null })} />,
    );
    // not-judged is the hatch: the swatch paints from the shared pattern, never a re-typed one.
    expect(container.querySelector("[data-swatch]")?.getAttribute("fill")).toMatch(/url\(#/);
    rerender(<SkillDormancyBadge usage={usage({ verdict: "active", state: "active" })} />);
    expect(container.querySelector("[data-swatch]")?.getAttribute("fill")).not.toMatch(/url\(#/);
  });

  it("reserves the amber warning for a skill the fleet really tried and dropped", () => {
    const { container: dropped } = render(
      <SkillDormancyBadge usage={usage({ verdict: "dormant", state: "abandoned", daysSinceUse: 90 })} />,
    );
    const { container: silent } = render(
      <SkillDormancyBadge usage={usage({ verdict: "dormant", state: "unmeasured", lastUsedAt: null, daysSinceUse: null })} />,
    );
    expect(dropped.firstElementChild?.className).toMatch(/amber/);
    expect(silent.firstElementChild?.className).not.toMatch(/amber/);
  });
});
