// @vitest-environment jsdom
//
// THE LEDGER, whole: a fresh org gets designed empty states and a way to start a runner; a returning
// operator gets the briefing (each line a door with its predicate), and the presence stamp fires after
// five visible seconds — but never over a briefing that could not be derived.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger } from "./Ledger";
import { SEEN_DWELL_MS } from "./useSeenStamp";
import { at, chronicleRun, keptLesson, ledgerData, plan, repoState, runnerDrive } from "./ledgerFixture";

vi.mock("./ledgerClient", () => ({
  stampLiveSeen: vi.fn(async () => true),
  resumeRepo: vi.fn(),
  revokeLesson: vi.fn(),
  decidePlan: vi.fn(),
}));
const client = await import("./ledgerClient");

const hrefs = { ledgerHref: "?tab=live&view=ledger", cockpitHref: "?tab=live&view=cockpit" };

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => vi.useRealTimers());

describe("Ledger", () => {
  it("designs a fresh org: no runner, no news card, an empty state in every section", () => {
    render(<Ledger data={ledgerData({ runner: null, lastRunner: null, driveModes: {}, ahead: {} })} {...hrefs} />);
    expect(screen.getByTestId("ledger-runner-status")).toHaveTextContent("No runner");
    const starts = screen.getAllByRole("link", { name: "Start one from the Cockpit" });
    expect(starts.every((a) => a.getAttribute("href") === hrefs.cockpitHref)).toBe(true);
    expect(screen.getByRole("navigation", { name: "Live views" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ledger" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("ledger-briefing")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ledger-briefing-error")).not.toBeInTheDocument();
    expect(screen.getByText(/No plan waits for you/)).toBeInTheDocument();
    expect(screen.getByText(/None yet — approving a plan/)).toBeInTheDocument();
    expect(screen.getByText(/No run yet/)).toBeInTheDocument();
    expect(screen.getByText(/The runner has kept no lessons yet/)).toBeInTheDocument();
  });

  it("briefs a returning operator, each line linking to its proof, and updates the awaiting count from the server", async () => {
    const p1 = plan("p1");
    vi.mocked(client.decidePlan).mockResolvedValue({ plan: { ...p1, status: "rejected" }, direction: null });
    render(<Ledger data={ledgerData({ pending: [p1, plan("p2")], runs: [chronicleRun(9, { verifiedCloses: 2, endedAt: at(1) })] })} {...hrefs} />);
    const card = screen.getByTestId("ledger-briefing");
    expect(within(card).getByText("Since you last looked")).toBeInTheDocument();
    const awaiting = card.querySelector('[data-line="awaiting"]')!;
    expect(awaiting).toHaveTextContent("2 plans wait for your approval now");
    expect(awaiting).toHaveAttribute("href", "#ledger-needs-you");
    expect(awaiting.getAttribute("title")).toMatch(/pending right now/);
    expect(card.querySelector('[data-line="closes"]')).toHaveAttribute("href", "#ledger-chronicle");
    expect(document.getElementById("ledger-needs-you")).not.toBeNull();
    expect(document.getElementById("ledger-chronicle")).not.toBeNull();

    // Named, because every section title now carries an InfoTip trigger that is also collapsed.
    fireEvent.click(screen.getAllByRole("button", { expanded: false, name: /Split scoring/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Reject…" }));
    fireEvent.change(screen.getByLabelText("Why reject (required)"), { target: { value: "not now" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject the plan" }));
    await waitFor(() => expect(card.querySelector('[data-line="awaiting"]')).toHaveTextContent("1 plan waits for your approval now"));
  });

  it("says it could not derive the briefing — and does not stamp over it", () => {
    vi.useFakeTimers();
    render(<Ledger data={ledgerData({ runs: null, failed: ["runs"] })} {...hrefs} />);
    expect(screen.getByTestId("ledger-briefing-error")).toHaveTextContent("Could not derive the briefing — the runs could not be read.");
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS * 3);
    });
    expect(client.stampLiveSeen).not.toHaveBeenCalled();
  });

  it("stamps the anchor once after five visible seconds", () => {
    vi.useFakeTimers();
    render(<Ledger data={ledgerData()} {...hrefs} />);
    act(() => {
      vi.advanceTimersByTime(SEEN_DWELL_MS);
    });
    expect(client.stampLiveSeen).toHaveBeenCalledTimes(1);
    expect(client.stampLiveSeen).toHaveBeenCalledWith("acme");
  });

  it("resumes a paused repo from the server's answer", async () => {
    const paused = runnerDrive({ repoState: [repoState("acme/kp", { paused: "branch-conflict", note: "src/a.ts conflicts" })] });
    vi.mocked(client.resumeRepo).mockResolvedValue(runnerDrive());
    render(<Ledger data={ledgerData({ runner: paused, lastRunner: paused })} {...hrefs} />);
    const box = screen.getByTestId("ledger-paused");
    expect(box).toHaveTextContent("the base would not merge into the runner branch");
    expect(box).toHaveTextContent("src/a.ts conflicts");
    fireEvent.click(within(box).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(screen.queryByTestId("ledger-paused")).not.toBeInTheDocument());
    expect(client.resumeRepo).toHaveBeenCalledWith("acme", "acme/kp");
  });

  it("revokes a lesson the runner kept, owner-only", async () => {
    vi.mocked(client.revokeLesson).mockResolvedValue(keptLesson("c1", { state: "revoked", revokedBy: "alice" }));
    const { unmount } = render(<Ledger data={ledgerData({ lessons: [keptLesson("c1")] })} {...hrefs} />);
    const row = screen.getByTestId("runner-lesson");
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.getByTestId("runner-lesson")).toHaveTextContent("revoked by alice"));
    expect(client.revokeLesson).toHaveBeenCalledWith("acme", "c1");
    unmount();
    render(<Ledger data={ledgerData({ isOwner: false, lessons: [keptLesson("c1")] })} {...hrefs} />);
    expect(within(screen.getByTestId("runner-lesson")).queryByRole("button")).not.toBeInTheDocument();
  });
});
