// @vitest-environment jsdom
//
// THE CHRONICLE — runs by stable number, a runner / drive / manual badge, "Older runs" paging strictly
// below the smallest number on screen, and a row that reads its detail ONCE and draws each lane's
// proposed → armed → delivered flow from the lane's own record.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Chronicle } from "./Chronicle";
import { chronicleRun, lane, NOW, plan, runDetail } from "./ledgerFixture";

vi.mock("./ledgerClient", () => ({ fetchRunDetail: vi.fn(), fetchRunsPage: vi.fn() }));
const { fetchRunDetail, fetchRunsPage } = await import("./ledgerClient");

const modes = { drive_runner: "continuous" as const, drive_b: "bounded" as const };

beforeEach(() => vi.clearAllMocks());

describe("Chronicle", () => {
  it("labels runs by their stable number (a date when there is none) and badges who dispatched them", () => {
    const runs = [
      chronicleRun(12, { driveId: "drive_runner", planMode: "on", verifiedCloses: 4, landedAt: ["a", "b"], lanes: 3 }),
      chronicleRun(11, { driveId: "drive_b" }),
      chronicleRun(null, { startedAt: "2026-09-01T10:00:00.000Z" }),
    ];
    render(<Chronicle slug="acme" initial={runs} initialHasMore={false} modes={modes} plans={[]} now={NOW} />);
    const [r12, r11, rx] = screen.getAllByTestId("chronicle-run");
    expect(r12).toHaveTextContent("#12");
    expect(r12).toHaveTextContent("runner");
    expect(r12).toHaveTextContent("planned");
    expect(r12).toHaveTextContent("3 lanes");
    expect(r12).toHaveTextContent("4 verified");
    expect(r12).toHaveTextContent("2 landed");
    expect(r11).toHaveTextContent("drive");
    expect(rx).toHaveTextContent("2026-09-01");
    expect(rx).toHaveTextContent("manual");
  });

  it("reads a run's detail once, however often it is opened", async () => {
    vi.mocked(fetchRunDetail).mockResolvedValue(runDetail([lane("l1")]));
    render(<Chronicle slug="acme" initial={[chronicleRun(7)]} initialHasMore={false} modes={modes} plans={[]} now={NOW} />);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(await screen.findByTestId("chronicle-lane")).toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(await screen.findByTestId("chronicle-lane")).toBeInTheDocument();
    expect(fetchRunDetail).toHaveBeenCalledTimes(1);
    expect(fetchRunDetail).toHaveBeenCalledWith("acme", "run-7");
  });

  it("draws proposed → armed → delivered from the lane, and names what was passed over", async () => {
    vi.mocked(fetchRunDetail).mockResolvedValue(runDetail([lane("l1")]));
    render(<Chronicle slug="acme" initial={[chronicleRun(7)]} initialHasMore={false} modes={modes} plans={[plan("plan-1", { status: "landed", directionId: "d1" })]} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const row = await screen.findByTestId("chronicle-lane");
    const flow = within(row).getByTestId("lane-flow");
    // 3 offered, 2 armed, 1 verified closed — and landed, so the last stage says so.
    const cells = [...flow.querySelectorAll("tbody tr")].map((tr) => tr.textContent);
    expect(cells).toEqual(["ProposedMeasured3", "ArmedMeasured2", "LandedMeasured1"]);
    expect(flow.getAttribute("title")).toMatch(/1 deferred, 0 held by a plan, 2 not measurable here/);
    expect(row).toHaveTextContent("verified · primary");
    expect(row).toHaveTextContent("1 verified closed");
    expect(row).toHaveTextContent("$0.42");
    expect(within(row).getByRole("link", { name: "plan landed · major" })).toHaveAttribute("href", "#direction-d1");
    expect(row).toHaveTextContent("Split the rubric out");
    expect(within(row).getByTestId("lane-log").textContent?.split("\n")).toHaveLength(40);
    expect(within(row).getByTestId("lane-log").textContent).toContain("line 50");
    expect(row).toHaveTextContent("Prefer the narrow import.");
  });

  it("draws an unrecorded proposal as a break, never as zero", async () => {
    vi.mocked(fetchRunDetail).mockResolvedValue(runDetail([lane("l1", { proposed: null, landedAt: null })]));
    render(<Chronicle slug="acme" initial={[chronicleRun(7)]} initialHasMore={false} modes={modes} plans={[]} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const flow = within(await screen.findByTestId("chronicle-lane")).getByTestId("lane-flow");
    expect(flow.querySelector('[data-stage="proposed"]')?.getAttribute("data-state")).toBe("missing");
    expect([...flow.querySelectorAll("tbody tr")].map((tr) => tr.textContent)[2]).toBe("DeliveredMeasured1");
  });

  it("pages older runs strictly below the smallest number shown, and stops when a page runs short", async () => {
    const first = Array.from({ length: 20 }, (_, i) => chronicleRun(40 - i));
    vi.mocked(fetchRunsPage).mockResolvedValue([chronicleRun(20), chronicleRun(19)]);
    render(<Chronicle slug="acme" initial={first} initialHasMore modes={modes} plans={[]} now={NOW} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Older runs" }));
    });
    expect(fetchRunsPage).toHaveBeenCalledWith("acme", 21, 20);
    await waitFor(() => expect(screen.getAllByTestId("chronicle-run")).toHaveLength(22));
    expect(screen.queryByRole("button", { name: "Older runs" })).not.toBeInTheDocument();
  });

  it("designs the empty chronicle and says when the read failed", () => {
    const { unmount } = render(<Chronicle slug="acme" initial={[]} initialHasMore={false} modes={modes} plans={[]} now={NOW} />);
    expect(screen.getByText(/No run yet/)).toBeInTheDocument();
    unmount();
    render(<Chronicle slug="acme" initial={null} initialHasMore={false} modes={modes} plans={[]} now={NOW} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not read the runs.");
  });
});
