// @vitest-environment jsdom
//
// THE APPROVAL INBOX — approving. The fence is the plan's own modules as removable chips plus any the
// owner adds; the budget is cycles (default 3) and optional dollars; what reaches the route is exactly
// what was on screen. A failed decision keeps the row pending and says why — never a phantom removal.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { direction, NOW, plan } from "./ledgerFixture";
import { PlanInbox } from "./PlanInbox";

vi.mock("./ledgerClient", () => ({ decidePlan: vi.fn() }));
const { decidePlan } = await import("./ledgerClient");

const open = () => fireEvent.click(screen.getByRole("button", { name: /Split scoring into its own module/ }));

beforeEach(() => vi.clearAllMocks());

describe("PlanInbox — approve", () => {
  it("sends the edited fence and the budget, and hands back the server's plan and direction", async () => {
    const decided = { ...plan("p1"), status: "approved" as const };
    const d = direction("d9");
    vi.mocked(decidePlan).mockResolvedValue({ plan: decided, direction: d });
    const onDecided = vi.fn();
    render(<PlanInbox plans={[plan("p1")]} now={NOW} isOwner onDecided={onDecided} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Approve…" }));

    // Prefilled from plan.modules; one removed, one added.
    expect(screen.getByText("src/rubric/")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove src/rubric/ from the fence" }));
    fireEvent.change(screen.getByLabelText("Add a module prefix"), { target: { value: "src/engine/" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.queryByText("src/rubric/")).not.toBeInTheDocument();

    const cycles = screen.getByLabelText("Budget · cycles") as HTMLInputElement;
    expect(cycles.value).toBe("3");
    fireEvent.change(cycles, { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Budget · USD (optional)"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve as a direction" }));

    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(decided, d));
    expect(decidePlan).toHaveBeenCalledWith("p1", {
      decision: "approve",
      note: "",
      fence: ["src/scoring/", "src/engine/"],
      budgetCycles: 5,
      budgetUsd: 2.5,
    });
  });

  it("omits the dollar budget when none is given", async () => {
    vi.mocked(decidePlan).mockResolvedValue({ plan: plan("p1"), direction: direction("d1") });
    render(<PlanInbox plans={[plan("p1")]} now={NOW} isOwner onDecided={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Approve…" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve as a direction" }));
    await waitFor(() => expect(decidePlan).toHaveBeenCalled());
    expect(vi.mocked(decidePlan).mock.calls[0]![1]).toEqual({ decision: "approve", note: "", fence: ["src/scoring/", "src/rubric/"], budgetCycles: 3 });
  });

  it("refuses an empty fence and a non-numeric budget before anything is sent", () => {
    render(<PlanInbox plans={[plan("p1")]} now={NOW} isOwner onDecided={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Approve…" }));
    fireEvent.change(screen.getByLabelText("Budget · cycles"), { target: { value: "two" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve as a direction" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/whole number/);
    fireEvent.change(screen.getByLabelText("Budget · cycles"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove src/scoring/ from the fence" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove src/rubric/ from the fence" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve as a direction" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/empty fence/);
    expect(decidePlan).not.toHaveBeenCalled();
  });

  it("keeps the row pending and shows the server's reason when the decision fails", async () => {
    vi.mocked(decidePlan).mockRejectedValue(new Error("This plan is already approved — only a pending plan can be decided."));
    const onDecided = vi.fn();
    render(<PlanInbox plans={[plan("p1")]} now={NOW} isOwner onDecided={onDecided} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Approve…" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve as a direction" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This plan is already approved");
    expect(alert).toHaveTextContent("still pending");
    expect(onDecided).not.toHaveBeenCalled();
    // The row, its open review and what was typed are all still there.
    expect(screen.getByTestId("plan-review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve as a direction" })).toBeEnabled();
  });
});
