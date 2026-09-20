// @vitest-environment jsdom
//
// The trade this component makes: the standing explanation leaves the page and stays REACHABLE on the
// title, and the header row spends the freed space on the section's own figure. Both halves are pinned
// here, because losing either one silently is what would make the change a deletion rather than a move.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LedgerSectionHeader } from "./LedgerSectionHeader";

afterEach(cleanup);

describe("LedgerSectionHeader", () => {
  it("keeps the explanation one click away, not on the page", () => {
    render(<LedgerSectionHeader id="h" title="Directions" about="An approved plan becomes a direction." />);
    // Not rendered as page prose…
    expect(screen.queryByText("An approved plan becomes a direction.")).not.toBeInTheDocument();
    // …and reachable, announced, from the title it belongs to.
    const tip = screen.getByRole("button", { name: "About directions" });
    expect(tip).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(tip);
    expect(screen.getByRole("tooltip")).toHaveTextContent("An approved plan becomes a direction.");
    expect(tip).toHaveAttribute("aria-expanded", "true");
  });

  it("names the heading for the section's aria-labelledby", () => {
    render(<LedgerSectionHeader id="ledger-directions-h" title="Directions" about="…" />);
    expect(document.getElementById("ledger-directions-h")).toHaveTextContent("Directions");
  });

  it("spends the header row on the section's figure, and draws nothing when there is none", () => {
    const { unmount } = render(<LedgerSectionHeader id="h" title="Chronicle" about="…" count="20+ runs" />);
    expect(screen.getByText("20+ runs")).toBeInTheDocument();
    unmount();
    render(<LedgerSectionHeader id="h" title="Chronicle" about="…" count={null} />);
    expect(screen.queryByText(/runs/)).not.toBeInTheDocument();
  });

  it("gives a status the header row when both a status and a count are offered — state outranks a figure", () => {
    render(
      <LedgerSectionHeader id="h" title="Runner branch" about="…" count="2 repos" right={<span>Stopped — its branches keep what it landed</span>} />,
    );
    expect(screen.getByText(/Stopped/)).toBeInTheDocument();
    expect(screen.queryByText("2 repos")).not.toBeInTheDocument();
  });
});
