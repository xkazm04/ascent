// @vitest-environment jsdom
//
// THE APPROVAL INBOX — what the reviewer sees and the verdicts that need words. The row names why the
// plan waits; the open row shows the REAL plan (items, moves `from → to`, the partition, risks, what it
// will not do, the check, the raw text) and, for a held plan, the parked branch with the command that
// shows its commits. Revise and reject cannot be sent without a note. A viewer reads, never decides.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, plan } from "./ledgerFixture";
import { PlanInbox } from "./PlanInbox";

vi.mock("./ledgerClient", () => ({ decidePlan: vi.fn() }));
const { decidePlan } = await import("./ledgerClient");

const openFirst = () => fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]!);

beforeEach(() => vi.clearAllMocks());

describe("PlanInbox — review", () => {
  it("lists the row's repo, items and the classifier's reason, and opens onto the real plan", () => {
    render(<PlanInbox plans={[plan("p1")]} now={NOW} isOwner onDecided={vi.fn()} />);
    expect(screen.getByText("kp")).toBeInTheDocument();
    expect(screen.getByText("Split the scoring engine")).toBeInTheDocument();
    expect(screen.getByText("moves architecture")).toBeInTheDocument();
    openFirst();
    const review = screen.getByTestId("plan-review");
    expect(within(review).getByText("Move the rubric out of engine.ts")).toBeInTheDocument();
    expect(within(review).getByTestId("plan-moves")).toHaveTextContent("src/scoring/ → src/rubric/ · splits a module");
    expect(review).toHaveTextContent("Measured against the repo's context map (2 modules).");
    expect(review).toHaveTextContent("imports churn");
    expect(review).toHaveTextContent("no behaviour change");
    expect(review).toHaveTextContent("npm test passes");
    expect(within(review).getByTestId("plan-text").textContent).toContain('"v": 1');
  });

  it("shows a held plan's parked branch and the command that lists its commits", () => {
    const held = plan("p2", { clsReason: "undeclared-moves-in-diff", heldBranch: "ascent/held/p2" });
    render(<PlanInbox plans={[held]} now={NOW} isOwner onDecided={vi.fn()} />);
    expect(screen.getByText("the lane made a move its plan did not declare — work held on ascent/held/p2")).toBeInTheDocument();
    openFirst();
    const ev = screen.getByTestId("plan-held");
    expect(ev).toHaveTextContent("ascent/held/p2");
    expect(within(ev).getByTestId("copy-command")).toHaveTextContent("git log --stat ascent/runner..ascent/held/p2");
  });

  it("says so when the plan could not be read, and still shows the raw text", () => {
    render(<PlanInbox plans={[plan("p3", { plan: null, clsReason: "unreadable", planText: "garbled output" })]} now={NOW} isOwner onDecided={vi.fn()} />);
    expect(screen.getByText("the plan could not be read — review the text")).toBeInTheDocument();
    openFirst();
    expect(screen.getByText(/could not be parsed into a plan/)).toBeInTheDocument();
    expect(screen.getByTestId("plan-text")).toHaveTextContent("garbled output");
  });

  it("will not send a revise or a reject without a note", async () => {
    vi.mocked(decidePlan).mockResolvedValue({ plan: plan("p1", { status: "revise" }), direction: null });
    const onDecided = vi.fn();
    render(<PlanInbox plans={[plan("p1")]} now={NOW} isOwner onDecided={onDecided} />);
    openFirst();
    fireEvent.click(screen.getByRole("button", { name: "Revise…" }));
    const send = screen.getByRole("button", { name: "Send back for revision" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("What should change (required)"), { target: { value: "   " } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("What should change (required)"), { target: { value: "Keep the public API stable" } });
    fireEvent.click(send);
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
    expect(decidePlan).toHaveBeenCalledWith("p1", { decision: "revise", note: "Keep the public API stable" });
  });

  it("requires a reason to reject, and sends it verbatim", async () => {
    vi.mocked(decidePlan).mockResolvedValue({ plan: plan("p1", { status: "rejected" }), direction: null });
    render(<PlanInbox plans={[plan("p1")]} now={NOW} isOwner onDecided={vi.fn()} />);
    openFirst();
    fireEvent.click(screen.getByRole("button", { name: "Reject…" }));
    expect(screen.getByRole("button", { name: "Reject the plan" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Why reject (required)"), { target: { value: "We keep scoring in one module" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject the plan" }));
    await waitFor(() => expect(decidePlan).toHaveBeenCalledWith("p1", { decision: "reject", note: "We keep scoring in one module" }));
  });

  it("gives a viewer the whole plan and no verdict", () => {
    render(<PlanInbox plans={[plan("p1")]} now={NOW} isOwner={false} onDecided={vi.fn()} />);
    openFirst();
    expect(screen.getByTestId("plan-review")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-decision")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve…" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only an owner can decide a plan/)).toBeInTheDocument();
  });

  it("offers no batch verdict — nothing is selectable", () => {
    render(<PlanInbox plans={[plan("p1"), plan("p2")]} now={NOW} isOwner onDecided={vi.fn()} />);
    for (const box of screen.getAllByRole("checkbox").slice(1)) expect(box).toBeDisabled();
  });

  it("designs the empty inbox", () => {
    render(<PlanInbox plans={[]} now={NOW} isOwner onDecided={vi.fn()} />);
    expect(screen.getByText(/No plan waits for you/)).toBeInTheDocument();
  });
});
