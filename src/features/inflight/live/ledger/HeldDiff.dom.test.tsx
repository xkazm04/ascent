// @vitest-environment jsdom
//
// THE HELD DIFF IN THE INBOX (challenge-2026-09-23, card live-war-room#B). A held plan's review shows
// the parked commits' files with their +/- counts where the reviewer decides — and, when the branch
// cannot be read, says so and keeps the copy-a-command fallback, never an empty list. Approving held
// work says what it does: it lands these commits.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { plan } from "./ledgerFixture";
import { PlanReview } from "./PlanReview";
import { PlanDecision } from "./PlanDecision";

vi.mock("./ledgerClient", () => ({ decidePlan: vi.fn(), fetchHeldDiff: vi.fn() }));
const { fetchHeldDiff } = await import("./ledgerClient");

const held = plan("p1", { clsReason: "undeclared-moves-in-diff", heldBranch: "ascent/held/p1" });

beforeEach(() => vi.clearAllMocks());

describe("HeldDiff — the held commits, inline", () => {
  it("lists both files with their +/- counts once the GET answers", async () => {
    vi.mocked(fetchHeldDiff).mockResolvedValue({
      heldBranch: "ascent/held/p1",
      commits: 2,
      files: [{ path: "src/a.ts", added: 12, deleted: 3 }, { path: "src/b.ts", added: 1, deleted: 0 }],
    });
    render(<PlanReview plan={held} />);
    const list = await screen.findByTestId("held-diff-files");
    expect(fetchHeldDiff).toHaveBeenCalledWith("p1");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("src/a.ts");
    expect(rows[0]).toHaveTextContent("+12");
    expect(rows[0]).toHaveTextContent("−3");
    expect(rows[1]).toHaveTextContent("src/b.ts");
    expect(screen.getByTestId("plan-held")).toHaveTextContent("2 commits");
  });

  it("says it could not read the branch on a failed GET, and keeps the command to copy", async () => {
    vi.mocked(fetchHeldDiff).mockRejectedValue(new Error("No paired checkout."));
    render(<PlanReview plan={held} />);
    await waitFor(() => expect(screen.getByTestId("plan-held")).toHaveTextContent("Could not read the held branch"));
    expect(screen.queryByTestId("held-diff-files")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("plan-held")).getByTestId("copy-command")).toHaveTextContent(
      "git log --stat ascent/runner..ascent/held/p1",
    );
  });

  it("asks nothing of a plan that holds no work", () => {
    render(<PlanReview plan={plan("p2")} />);
    expect(screen.queryByTestId("plan-held")).not.toBeInTheDocument();
    expect(fetchHeldDiff).not.toHaveBeenCalled();
  });
});

describe("PlanDecision — what approving held work does", () => {
  it("reads 'Approve: land these commits' on a held plan, and 'Approve as a direction' otherwise", () => {
    const { unmount } = render(<PlanDecision plan={held} onDecided={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve…" }));
    expect(screen.getByRole("button", { name: "Approve: land these commits" })).toBeInTheDocument();
    unmount();
    render(<PlanDecision plan={plan("p2")} onDecided={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve…" }));
    expect(screen.getByRole("button", { name: "Approve as a direction" })).toBeInTheDocument();
  });
});
