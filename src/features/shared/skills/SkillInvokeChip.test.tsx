// @vitest-environment jsdom
//
// Neighbouring Registry copy labels sink totals "invokes 30d". This chip is all-time volume across
// sink A (events API) and sink B (registry usage/ over each contributor's declared window). Pinning
// the title so it cannot quietly pick up that 30d rate. The source chip is the UI consumer of
// `skillEventSourceLabel` — a helper that existed with no surface until the last-use client landed
// next to "N ran".

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { INVOKE_CHIP_TITLE, INVOKE_CHIP_WINDOW, SOURCE_CHIP_TITLE, SkillInvokeChip } from "./SkillInvokeChip";
import { skillEventSourceLabel, SKILL_EVENT_SOURCES } from "@/lib/org/skill-event-source";
import type { SkillUsage } from "@/lib/org/skill-usage";

function usage(invokes: number, over: Partial<SkillUsage> = {}): SkillUsage {
  return {
    skillId: "s1",
    verdict: "active",
    state: "active",
    lastUsedAt: invokes > 0 ? "2026-09-05T00:00:00.000Z" : null,
    lastUsedType: invokes > 0 ? "invoke" : null,
    lastUsedSource: invokes > 0 ? "hook" : null,
    daysSinceUse: invokes > 0 ? 3 : null,
    useCount: invokes + 2,
    invokes,
    eventCount: invokes + 2,
    anchorAt: "2026-07-01T00:00:00.000Z",
    ageDays: 69,
    windowDays: 30,
    ...over,
  };
}

describe("SkillInvokeChip", () => {
  it("renders nothing when usage is missing or there is no invoke and no last use", () => {
    const { container: a } = render(<SkillInvokeChip usage={undefined} />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(<SkillInvokeChip usage={usage(0)} />);
    expect(b).toBeEmptyDOMElement();
  });

  it("names sinks and the all-time window, and does not label the volume a 30d rate", () => {
    render(<SkillInvokeChip usage={usage(12)} />);
    const chip = screen.getByText("12 ran");
    expect(chip).toHaveAttribute("data-invoke-window", INVOKE_CHIP_WINDOW);
    expect(chip).toHaveAttribute("data-invoke-sinks", "A B");
    expect(chip).toHaveAttribute("title", INVOKE_CHIP_TITLE);
    expect(INVOKE_CHIP_WINDOW).toBe("all-time");
    expect(chip.textContent).not.toMatch(/30d/i);
    expect(INVOKE_CHIP_TITLE).toMatch(/sink A/i);
    expect(INVOKE_CHIP_TITLE).toMatch(/sink B/i);
    expect(INVOKE_CHIP_TITLE).toMatch(/all-time/i);
    expect(INVOKE_CHIP_TITLE).toMatch(/not the Registry tab's 30d rate/i);
    expect(INVOKE_CHIP_TITLE).not.toMatch(/^invokes 30d/i);
  });

  it("surfaces the last-use source via skillEventSourceLabel, including Unattributed", () => {
    const { rerender } = render(<SkillInvokeChip usage={usage(12)} />);
    expect(screen.getByText("Hook")).toHaveAttribute("data-event-source", "hook");
    expect(screen.getByText("Hook")).toHaveAttribute("title", SOURCE_CHIP_TITLE);
    for (const source of SKILL_EVENT_SOURCES) {
      rerender(<SkillInvokeChip usage={usage(1, { lastUsedSource: source })} />);
      expect(screen.getByText(skillEventSourceLabel(source))).toHaveAttribute("data-event-source", source);
    }
    rerender(
      <SkillInvokeChip
        usage={usage(0, { lastUsedAt: "2026-09-05T00:00:00.000Z", lastUsedType: "download", lastUsedSource: null })}
      />,
    );
    expect(screen.queryByText(/ran/)).toBeNull();
    expect(screen.getByText("Unattributed")).toHaveAttribute("data-event-source", "unattributed");
  });
});
