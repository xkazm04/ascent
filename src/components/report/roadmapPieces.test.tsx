// @vitest-environment jsdom
//
// The roadmap card's EXPLORATION framing, pinned where it can be pinned deterministically.
//
// This lived in the org e2e suite as `getByText("Explore")` on a live report. That assertion could
// not survive a real provider: ExploreList renders nothing unless the model emitted `explore` items
// for a recommendation, so a perfectly good live scan that happened to produce none turned the suite
// red. Whether the model emits them is the model's call; whether the UI frames them as OPEN QUESTIONS
// rather than commands is the product's, and that is what these tests hold.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExploreList } from "./roadmapPieces";

describe("ExploreList", () => {
  // The null case is the one the e2e assertion tripped over, so it is pinned first: absent/empty
  // explore items must render NOTHING, not an empty labelled box implying the model had nothing to ask.
  it("renders nothing without items", () => {
    const { container } = render(<ExploreList />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<ExploreList items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels the block 'Explore' and lists every question", () => {
    render(<ExploreList items={["Which tests cover the payment path?", "Who owns the deploy runbook?"]} />);
    expect(screen.getByText("Explore")).toBeTruthy();
    expect(screen.getByText("Which tests cover the payment path?")).toBeTruthy();
    expect(screen.getByText("Who owns the deploy runbook?")).toBeTruthy();
  });

  // The framing itself: these are prompts to investigate, not a task list. A regression that reworded
  // them into imperatives ("Add tests for the payment path") would pass a count assertion and quietly
  // change what the product claims to be, so the shape is asserted rather than the count.
  it("presents items as list entries under the Explore label, not as actions", () => {
    render(<ExploreList items={["What breaks if the cache is cold?"]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("What breaks if the cache is cold?");
    // No button/link affordance — an exploration is read, not executed.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
