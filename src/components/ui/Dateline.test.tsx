// @vitest-environment jsdom
//
// Dateline #4 (mobile reflow): the right-hand metadata used to be `hidden sm:inline`, so on a narrow
// viewport the information silently VANISHED. The fix drops `hidden` and wraps the container so the
// metadata reflows onto its own line instead. These pin that the right node renders unconditionally
// (no `hidden` class) and the container is a wrapping flex row.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dateline } from "./Dateline";

describe("Dateline right-hand metadata on a narrow viewport", () => {
  it("renders the right metadata with no `hidden` class so it reflows rather than disappearing", () => {
    render(<Dateline left="The index" right="Vol. 01, 5 levels" />);
    const right = screen.getByText("Vol. 01, 5 levels");
    expect(right).toBeInTheDocument();
    // The regression was a literal `hidden` utility on the right Kicker — it must be gone.
    expect(right.className).not.toMatch(/\bhidden\b/);
  });

  it("wraps the row so the metadata can drop to its own line", () => {
    const { container } = render(<Dateline left="The index" right="meta" />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toMatch(/\bflex-wrap\b/);
  });

  it("omits the right slot entirely when none is supplied", () => {
    render(<Dateline left="Only left" />);
    expect(screen.getByText("Only left")).toBeInTheDocument();
  });
});
