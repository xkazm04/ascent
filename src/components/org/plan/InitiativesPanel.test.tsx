// @vitest-environment jsdom
//
// Pins goals-initiatives #4: a long tracked-initiative title truncates to one line (within its
// min-w-0 flex item) instead of overflowing the row / shoving the status <select>.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InitiativesPanel, type InitiativeView } from "./InitiativesPanel";

function initiative(over: Partial<InitiativeView> = {}): InitiativeView {
  return {
    id: "i1",
    title: "Add tests",
    dimId: "D1",
    dimLabel: "Testing",
    practiceId: null,
    targetScore: 70,
    repos: ["acme/web"],
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    goalId: null,
    goalLabel: null,
    playbookId: null,
    playbookLabel: null,
    progress: { atTarget: 1, total: 3 },
    ...over,
  };
}

describe("InitiativesPanel", () => {
  it("#4: truncates a long initiative title with the full text on hover", () => {
    const long = "L".repeat(200);
    render(<InitiativesPanel slug="acme" initial={[initiative({ title: long })]} seeds={[]} />);
    const title = screen.getByText(long);
    expect(title).toHaveClass("truncate");
    expect(title).toHaveAttribute("title", long);
    expect(title.parentElement).toHaveClass("min-w-0"); // the flex ancestor that lets it shrink
  });
});
