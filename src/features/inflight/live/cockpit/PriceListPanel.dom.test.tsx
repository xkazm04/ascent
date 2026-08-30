// @vitest-environment jsdom
//
// The price list's two refusals, which are the point of the panel:
//   • no cell is ever rendered without its `n` — a rate from one lane and a rate from nine are
//     different claims, and a table that hides the difference invites the reader to conflate them;
//   • an empty list SAYS WHAT IS MISSING instead of printing zeros.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { RemediationPriceList } from "./loopTypes";

const fetchLoopPrices = vi.fn<(slug: string) => Promise<RemediationPriceList | null>>();
vi.mock("./loopClient", () => ({ fetchLoopPrices: (slug: string) => fetchLoopPrices(slug) }));

import { PriceListPanel } from "./PriceListPanel";

const list = (over: Partial<RemediationPriceList> = {}): RemediationPriceList => ({
  rows: [
    { model: "sonnet", dimId: "D2", n: 4, microsPerPoint: 2_000_000, totalMicros: 8_000_000, totalPoints: 4 },
    { model: "opus", dimId: "D2", n: 3, microsPerPoint: 9_000_000, totalMicros: 27_000_000, totalPoints: 3 },
  ],
  unproductiveMicros: 0,
  unpricedLanes: 0,
  generatedAt: "2026-08-30T00:00:00.000Z",
  ...over,
});

describe("PriceListPanel", () => {
  it("prints n beside every price", async () => {
    render(<PriceListPanel slug="acme" initial={list()} />);
    expect(await screen.findByText(/2\.00¢/)).toBeInTheDocument();
    expect(screen.getByText("n=4")).toBeInTheDocument();
    expect(screen.getByText("n=3")).toBeInTheDocument();
    // Two cells, two counts: no row escapes without one.
    expect(screen.getAllByText(/^n=\d+$/)).toHaveLength(2);
  });

  it("states what a price needs instead of showing a zeroed table", () => {
    render(<PriceListPanel slug="acme" initial={list({ rows: [] })} />);
    expect(screen.getByText(/both scan ends and a recorded cost/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.00¢/)).toBeNull();
  });

  it("names unproductive spend and unpriced lanes rather than dropping them", () => {
    render(<PriceListPanel slug="acme" initial={list({ unproductiveMicros: 5_000_000, unpricedLanes: 2 })} />);
    expect(screen.getByText(/5\.00¢ spent without measured movement/)).toBeInTheDocument();
    expect(screen.getByText(/2 lanes unpriced/)).toBeInTheDocument();
  });

  it("renders nothing at all when the deployment has no price list to give", async () => {
    fetchLoopPrices.mockResolvedValueOnce(null);
    const { container } = render(<PriceListPanel slug="acme" />);
    await waitFor(() => expect(fetchLoopPrices).toHaveBeenCalledWith("acme"));
    // Silence, not an empty table: "we could not read one" is not "nothing has been priced".
    expect(container.querySelector("section")).toBeNull();
  });
});
