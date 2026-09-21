// @vitest-environment jsdom
//
// THE COMPARISON, MOUNTED (spark local-model-lanes, WP11). `buildComparisonReport` had no production
// caller and `ComparisonView` was mounted only by its own fixture: the comparison could be run and
// would produce rows nobody could read. These pin the readout where the run's chronicle renders it.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChronicleRow } from "./ChronicleRow";
import { chronicleRun, lane, NOW } from "./ledgerFixture";
import { comparisonReport } from "./comparison/comparisonFixture";
import type { LoopRunDetail } from "../cockpit/loopTypes";

vi.mock("./ledgerClient", () => ({ fetchRunDetail: vi.fn(), fetchRunsPage: vi.fn() }));
const { fetchRunDetail } = await import("./ledgerClient");

const detail = (over: Partial<LoopRunDetail> = {}): LoopRunDetail =>
  ({ run: { id: "run-7", seq: 7 }, lanes: [lane("l1")], outcomes: [], economics: [], itemOutcomes: [], ...over }) as unknown as LoopRunDetail;

const open = async (phase: "done" | "running", over: Partial<LoopRunDetail> = {}) => {
  vi.mocked(fetchRunDetail).mockResolvedValue(detail(over));
  render(
    <ul>
      <ChronicleRow slug="acme" run={chronicleRun(7, { phase })} modes={{}} plans={[]} now={NOW} />
    </ul>,
  );
  fireEvent.click(screen.getByRole("button", { expanded: false, name: /#7/ }));
  await screen.findByTestId("chronicle-lane");
};

beforeEach(() => vi.clearAllMocks());

describe("a run's comparison in the chronicle", () => {
  it("a COMPARE run's report renders beside the lanes it was computed from", async () => {
    await open("done", { comparison: comparisonReport() });
    expect(screen.getByTestId("comparison")).toBeInTheDocument();
    // The settled verdict, not the withheld one.
    expect(screen.getByTestId("comparison-verdict")).toBeInTheDocument();
    expect(screen.queryByTestId("comparison-running")).not.toBeInTheDocument();
  });

  it("a SINGLE run renders nothing new — the section is absent, not empty", async () => {
    await open("done");
    expect(screen.queryByTestId("comparison")).not.toBeInTheDocument();
  });

  it("a run still in flight WITHHOLDS the headline — a provisional winner is a number someone quotes", async () => {
    await open("running", { comparison: comparisonReport() });
    expect(screen.getByTestId("comparison-running")).toBeInTheDocument();
    expect(screen.queryByTestId("comparison-verdict")).not.toBeInTheDocument();
    expect(screen.queryByTestId("comparison-no-advance")).not.toBeInTheDocument();
  });
});
