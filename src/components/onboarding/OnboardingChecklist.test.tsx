// @vitest-environment jsdom
//
// G6-11: the checklist's suggested-next `<li>` was signaled ONLY visually (an accent border + a
// "next" pill), and the done/not-done state was carried ONLY by an aria-hidden ✓/number glyph — a
// screen-reader user got zero non-visual signal for either. This pins: the next item carries
// `aria-current="step"` (and non-next items don't), and each item's accessible name includes a
// "Completed:"/"To do:" prefix mirroring the glyph.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OnboardingChecklist, type ChecklistStep } from "./OnboardingChecklist";

const STEPS: ChecklistStep[] = [
  { label: "Install the GitHub App", done: true },
  { label: "Pick repositories", done: true },
  { label: "Run your first scan", done: false, href: "/onboarding" },
  { label: "Set a watch schedule", done: false, href: "/connect" },
];

describe("OnboardingChecklist — non-visual next-step + done state (G6-11)", () => {
  it("marks the first not-done item aria-current='step' and no other item", () => {
    render(<OnboardingChecklist steps={STEPS} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(STEPS.length);
    expect(items[2]).toHaveAttribute("aria-current", "step"); // "Run your first scan" — first not-done
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[1]).not.toHaveAttribute("aria-current");
    expect(items[3]).not.toHaveAttribute("aria-current");
  });

  it("prefixes completed items with a non-visual 'Completed:' label", () => {
    render(<OnboardingChecklist steps={STEPS} />);
    // Two done steps → two "Completed:" prefixes.
    expect(screen.getAllByText("Completed:")).toHaveLength(2);
  });

  it("prefixes not-done items with a non-visual 'To do:' label", () => {
    render(<OnboardingChecklist steps={STEPS} />);
    expect(screen.getAllByText("To do:")).toHaveLength(2);
  });

  it("when every step is done, no item carries aria-current", () => {
    const allDone = STEPS.map((s) => ({ ...s, done: true }));
    render(<OnboardingChecklist steps={allDone} />);
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).not.toHaveAttribute("aria-current");
    }
  });
});
