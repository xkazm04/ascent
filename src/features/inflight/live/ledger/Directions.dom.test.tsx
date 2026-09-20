// @vitest-environment jsdom
//
// DIRECTIONS — active first, then the ended ones; each with its fence, its budget meters (cycles, and
// spend only when a spend budget was set), the plans that ran under it, and — for an owner, on a
// direction that can still end — Revoke and Mark done, which update from the SERVER's answer.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { direction, NOW, plan } from "./ledgerFixture";
import { Directions, sortDirections } from "./Directions";

vi.mock("./ledgerClient", () => ({ settleDirection: vi.fn() }));
const { settleDirection } = await import("./ledgerClient");

beforeEach(() => vi.clearAllMocks());

describe("Directions", () => {
  it("orders active first, then exhausted, done and revoked — newest first within each", () => {
    const ds = [
      direction("done", { status: "done", createdAt: "2026-09-18T01:00:00Z" }),
      direction("old-active", { createdAt: "2026-09-01T00:00:00Z" }),
      direction("revoked", { status: "revoked" }),
      direction("new-active", { createdAt: "2026-09-17T00:00:00Z" }),
      direction("exhausted", { status: "exhausted" }),
    ];
    expect(sortDirections(ds).map((d) => d.id)).toEqual(["new-active", "old-active", "exhausted", "done", "revoked"]);
  });

  it("shows the fence, the cycle meter, the spend meter only when budgeted, and the plans under it", () => {
    render(
      <Directions
        directions={[direction("d1", { budgetMicros: 500_000_000, usedMicros: 125_000_000 }), direction("d2", { status: "done" })]}
        plans={[plan("p1", { directionId: "d1", status: "landed" }), plan("p2", { directionId: "other" })]}
        now={NOW}
        isOwner
        onSettled={vi.fn()}
      />,
    );
    const [d1, d2] = screen.getAllByTestId("direction");
    expect(within(d1!).getByText("src/scoring/")).toBeInTheDocument();
    expect(d1).toHaveTextContent("1/3 cycles");
    expect(d1).toHaveTextContent("$1.25 of $5.00");
    expect(within(d1!).getAllByRole("progressbar")).toHaveLength(2);
    expect(within(d1!).getByTestId("direction-plans")).toHaveTextContent("landed · Split the scoring engine");
    expect(d1).toHaveTextContent("Approved by alice 10 h ago");
    // No spend budget → no spend meter; an ended direction offers no action.
    expect(within(d2!).getAllByRole("progressbar")).toHaveLength(1);
    expect(within(d2!).queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("revokes from the server's answer, and says why when it cannot", async () => {
    const revoked = direction("d1", { status: "revoked" });
    vi.mocked(settleDirection).mockResolvedValueOnce(revoked).mockRejectedValueOnce(new Error("This direction has already ended."));
    const onSettled = vi.fn();
    render(<Directions directions={[direction("d1"), direction("d3")]} plans={[]} now={NOW} isOwner onSettled={onSettled} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(revoked, "revoke"));
    expect(settleDirection).toHaveBeenCalledWith("d1", "revoke");
    fireEvent.click(screen.getAllByRole("button", { name: "Mark done" })[1]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("This direction has already ended.");
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("offers a viewer no actions", () => {
    render(<Directions directions={[direction("d1")]} plans={[]} now={NOW} isOwner={false} onSettled={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
  });

  it("designs the empty state and says when the read failed", () => {
    const { unmount } = render(<Directions directions={[]} plans={[]} now={NOW} isOwner onSettled={vi.fn()} />);
    expect(screen.getByText(/None yet — approving a plan in Needs you creates one/)).toBeInTheDocument();
    unmount();
    render(<Directions directions={null} plans={[]} now={NOW} isOwner onSettled={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not read the directions.");
  });
});
