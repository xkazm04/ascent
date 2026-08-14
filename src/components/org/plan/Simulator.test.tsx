// @vitest-environment jsdom
//
// Pins investment-simulator-forecast 07-09 #2 and #3:
//  #2 — "Suggest moves" must keep a band-PROMOTING move whose fleet-average lift rounds to 0
//       (gain=0 but promotions>0), not silently drop the single most valuable recommendation.
//  #3 — editing an input after "Simulate" must INVALIDATE the on-screen projection, so a stale
//       projection can't be reviewed/tracked against a scenario the form no longer describes.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import { Simulator } from "@/components/org/plan/Simulator";
import type { FleetProjection } from "@/lib/scoring/orgsim";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const dims = [
  { id: "D2", label: "Testing", avg: 40 },
  { id: "D3", label: "Docs", avg: 50 },
];
const repos = [{ fullName: "acme/app", name: "app" }];

const projection: FleetProjection = {
  fixes: [{ dimId: "D2", target: 70 }],
  scopeCount: 1,
  affected: 1,
  before: { repos: 1, avgOverall: 40, avgAdoption: 40, avgRigor: 40, level: "L2", postureCounts: {} },
  after: { repos: 1, avgOverall: 55, avgAdoption: 55, avgRigor: 55, level: "L3", postureCounts: {} },
  repos: [
    { fullName: "acme/app", name: "app", overallBefore: 40, overallAfter: 55, delta: 15, levelBefore: "L2", levelAfter: "L3", levelUp: true },
  ],
  promotions: 1,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Simulator (DOM)", () => {
  it('keeps a promotion-only move (gain 0, promotions>0) in "Suggest moves" (#2)', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ranking: [
              { dimId: "D2", name: "Testing", target: 70, gain: 5, promotions: 0, affected: 3 },
              { dimId: "D3", name: "Docs", target: 70, gain: 0, promotions: 1, affected: 1 }, // rounds to 0 avg but promotes
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<Simulator slug="acme" dims={dims} repos={repos} />);
    await act(async () => {
      screen.getByRole("button", { name: /Suggest/ }).click();
    });
    // The gain=0 / promotions=1 move must survive the filter (title is the stable, single-node handle).
    await waitFor(() => expect(screen.getByTitle(/Load D3/)).toBeInTheDocument());
    expect(screen.getByTitle(/Load D2/)).toBeInTheDocument(); // the higher-average move is there too
    expect(screen.getByText(/1↑/)).toBeInTheDocument(); // D3's promotion count rendered
  });

  it("marks the ranking stale when the target changes after Suggest (07-16 #1)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ ranking: [{ dimId: "D2", name: "Testing", target: 70, gain: 5, promotions: 0, affected: 3 }] }),
          { status: 200 },
        ),
      ),
    );
    render(<Simulator slug="acme" dims={dims} repos={repos} />);
    await act(async () => {
      screen.getByRole("button", { name: /Suggest/ }).click();
    });
    await waitFor(() => expect(screen.getByTitle(/Load D2/)).toBeInTheDocument());
    expect(screen.queryByText(/Stale:/)).toBeNull(); // fresh ranking carries no stale badge

    // Editing the target makes the ranking describe a different scenario → it must say so visibly.
    const input = screen.getByLabelText("Target score") as HTMLInputElement;
    await act(async () => {
      // Set via the native prototype setter so React's value tracker registers the change.
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "90");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(screen.getByText(/Stale: computed for all scanned repos at target 70/)).toBeInTheDocument();
    expect(screen.getByTitle(/Load D2/)).toBeInTheDocument(); // the list itself stays (dimmed), not wiped
  });

  it("invalidates the projection when the dimension changes after Simulate (#3)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ projection, goalImpacts: [] }), { status: 200 })),
    );
    render(<Simulator slug="acme" dims={dims} repos={repos} />);

    await act(async () => {
      screen.getByText("Simulate").click();
    });
    await waitFor(() => expect(screen.getByText(/Applies to/)).toBeInTheDocument());

    // Changing the dimension makes the shown projection stale → it must be cleared, forcing a re-simulate.
    const select = screen.getByLabelText("Dimension to raise") as HTMLSelectElement;
    await act(async () => {
      select.value = "D3";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(screen.queryByText(/Applies to/)).toBeNull();
  });
});
