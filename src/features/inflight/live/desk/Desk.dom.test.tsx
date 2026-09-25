// @vitest-environment jsdom
//
// THE DESK, whole: L0 renders the five sections from realistic data, the live strip follows the feed
// (and looks stale when it is), a read that failed says so, and the inner layer walks round → lane →
// log from ONE detail read, with Esc back to the desk.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TheaterFeed } from "../theater/useTheaterPulse";
import { lane } from "../ledger/ledgerFixture";
import { Desk } from "./Desk";
import { deskData, NOW, pulse } from "./deskFixture";

const feed: { current: TheaterFeed; stale: boolean } = { current: null as unknown as TheaterFeed, stale: false };
vi.mock("../theater/useTheaterPulse", () => ({
  useTheaterPulse: () => feed.current,
  feedStale: () => feed.stale,
}));
vi.mock("../cockpit/loopClient", () => ({ fetchLoopDetail: vi.fn() }));
const client = await import("../cockpit/loopClient");

const hrefs = { ledger: "?tab=live&view=ledger", cockpit: "?tab=live&view=cockpit", desk: "?tab=live&view=desk", onAir: "/theater/acme?wall=onair" };
const now = Date.parse(NOW);
const live = (over: Partial<TheaterFeed> = {}): TheaterFeed => ({
  pulse: pulse(),
  loaded: true,
  receivedAt: now,
  listeningSince: now - 5_000,
  now,
  error: null,
  arrivedKeys: new Set(),
  ...over,
});

const detail = {
  run: { id: "run-3", seq: 3, phase: "done", repos: ["acme/kp"], maxCycles: 3, startedAt: "2026-09-18T07:00:00.000Z", endedAt: "2026-09-18T08:00:00.000Z", error: null, arms: [], verifyMode: "on", planMode: null, delivery: null, concurrency: 2, batchSize: null, model: "opus" },
  lanes: [
    lane("l3", { runId: "run-3", log: ["17:33:36 Linked node_modules", "17:54:44 Agent failed: timeout"], closedIds: ["r1"] }),
    lane("l4", { runId: "run-3", cycle: 2, closedIds: [] }),
  ],
  outcomes: [],
  economics: [],
  itemOutcomes: [],
  batchTitles: { r1: { title: "Pin the actions", dimId: "D9" }, r2: { title: "Run the browser suite", dimId: "D2" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  feed.current = live();
  feed.stale = false;
  window.location.hash = "";
  vi.mocked(client.fetchLoopDetail).mockResolvedValue(detail as never);
});
afterEach(() => {
  window.location.hash = "";
});

describe("Desk", () => {
  it("draws L0: waiting cards, the live strip, the rounds, the arm league and the next round", () => {
    const { container } = render(<Desk data={deskData()} hrefs={hrefs} />);
    expect(container.querySelectorAll('[data-role="desk-sec"]')).toHaveLength(5);
    const cards = [...container.querySelectorAll('[data-role="desk-card"]')].map((c) => c.getAttribute("data-card"));
    expect(cards).toEqual(["plans", "merge", "rejected", "lessons"]);
    expect(screen.getByTestId("desk-running")).toHaveTextContent("Running");
    expect(screen.getAllByTestId("desk-lane")).toHaveLength(1);
    expect(container.querySelector('[data-role="desk-stage-on"]')).toHaveTextContent("CHECK");
    expect(screen.getAllByTestId("desk-flog-round")).toHaveLength(4);
    expect(screen.getAllByTestId("desk-rtable-row").map((r) => r.textContent?.slice(0, 2))).toEqual(["#4", "#3", "#2", "#1"]);
    expect(screen.getAllByText("not reported", { selector: "span" })).toHaveLength(2);
    expect(container.querySelectorAll('[data-role="desk-arm"]')).toHaveLength(3);
    expect(container.querySelector('[data-role="desk-ticket"]')).toHaveTextContent("#5");
    expect(screen.getByRole("link", { name: "Continue in Cockpit" })).toHaveAttribute("href", hrefs.cockpit);
    expect(screen.getByRole("link", { name: /Desk/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "On Air ↗" })).toHaveAttribute("target", "_blank");
  });

  it("looks stale when the feed is, and says so in one line with nothing running", () => {
    feed.stale = true;
    feed.current = live({ receivedAt: now - 13_000 });
    const { container, unmount } = render(<Desk data={deskData()} hrefs={hrefs} />);
    expect(container.querySelector("[data-stale]")).not.toBeNull();
    expect(screen.getByTestId("desk-running")).toHaveTextContent("Reconnecting…");
    expect(screen.getByTestId("desk-feed")).toHaveTextContent("last heard 13 s ago");
    unmount();
    feed.stale = false;
    feed.current = live({ pulse: pulse({ runner: null, run: null, lanes: [] }) });
    render(<Desk data={deskData()} hrefs={hrefs} />);
    expect(screen.getByTestId("desk-flight-line")).toHaveTextContent("No runner, no run in flight.");
  });

  it("says it could not read the rounds instead of drawing an empty chart", () => {
    render(<Desk data={deskData({ rounds: null, lanes: null, failed: ["rounds"] })} hrefs={hrefs} />);
    expect(screen.getByTestId("desk-rounds-unread")).toHaveTextContent("Could not read the rounds");
    expect(screen.queryByTestId("desk-flog-round")).not.toBeInTheDocument();
  });

  it("walks round → lane → log from one detail read, and Esc goes back", async () => {
    render(<Desk data={deskData()} hrefs={hrefs} />);
    await act(async () => {
      fireEvent.click(screen.getAllByTestId("desk-rtable-row")[1]!);
    });
    const layer = await screen.findByRole("dialog", { name: "Round #3" });
    expect(client.fetchLoopDetail).toHaveBeenCalledWith("acme", "run-3");
    expect(within(layer).getByRole("heading", { level: 1 })).toHaveTextContent("Round #3");
    expect(within(layer).getAllByText("Pin the actions")).toHaveLength(2);
    await act(async () => {
      fireEvent.click(within(layer).getAllByTestId("desk-lanecard")[0]!);
    });
    const lanePage = await screen.findByRole("dialog", { name: "kp · cycle 1" });
    await act(async () => {
      fireEvent.click(within(lanePage).getByRole("button", { name: /Read the log/ }));
    });
    const logPage = await screen.findByRole("dialog", { name: "Log" });
    expect(within(logPage).getByText("Agent failed: timeout")).toBeInTheDocument();
    expect(client.fetchLoopDetail).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a card's evidence, which hands the decision to the Ledger", async () => {
    const { container } = render(<Desk data={deskData()} hrefs={hrefs} />);
    await act(async () => {
      fireEvent.click(container.querySelector('[data-card="merge"]')!);
    });
    const page = await screen.findByRole("dialog", { name: "Merge is yours" });
    expect(within(page).getByText("unknown — git could not say")).toBeInTheDocument();
    expect(within(page).getByRole("link", { name: /Merge on the Ledger/ })).toHaveAttribute("href", `${hrefs.ledger}#ledger-needs-you`);
  });
});
