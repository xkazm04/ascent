// @vitest-environment jsdom
//
// The recommendation LIFECYCLE surfaces inside the tracker, split out of RecommendationTracker.test
// so both files stay well under the repo's 300-LOC ceiling:
//   * Direction 1 — dismissing asks WHY, and the reason rides the PATCH's `note` so it becomes a
//     standing decision the next scan's prompt reads.
//   * Direction 2 — a done row shows whether its dimension actually moved, with "not re-measured"
//     as a state of its own.
// The payoff/meta chips and the orphan panel are stubbed so these target the tracker's own wiring.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PersistedRecommendation, ScanReport } from "@/lib/types";

vi.mock("@/components/report/OrphanedTracking", () => ({ OrphanedTracking: () => null }));
vi.mock("@/components/report/roadmapPieces", () => ({
  RoadmapMeta: () => null,
  PayoffChip: () => null,
  ExploreList: () => null,
  ExemplarPointer: () => null,
}));

import { RecommendationTracker } from "./RecommendationTracker";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const report = { repo: { owner: "acme", name: "web" } } as unknown as ScanReport;

function item(over: Partial<PersistedRecommendation> = {}): PersistedRecommendation {
  return {
    id: "r1",
    title: "Add CI gate",
    dimension: "D1" as PersistedRecommendation["dimension"],
    impact: "high" as PersistedRecommendation["impact"],
    effort: "low" as PersistedRecommendation["effort"],
    rationale: "",
    explore: [],
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    ...over,
  };
}

// Direction 1 (dismissal becomes evidence): dismissing is the one moment a team volunteers the
// context the next scan lacks, so the pick opens an inline reason prompt instead of firing the PATCH
// immediately. The reason rides the existing `note` contract. Skipping stays a first-class choice —
// and a skipped reason must send NO note, because a reason-less dismissal must never become a
// permanent suppression server-side.
describe("RecommendationTracker dismissal reason", () => {
  const okFetch = () =>
    vi.fn(async () => new Response(JSON.stringify({ status: "dismissed" }), { status: 200 }));

  function body(fetchMock: ReturnType<typeof okFetch>) {
    const call = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH");
    return call ? (JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>) : null;
  }

  it("asks why before saving — no PATCH is sent on the pick alone", () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<RecommendationTracker items={[item()]} report={report} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Recommendation status" }), {
      target: { value: "dismissed" },
    });

    expect(screen.getByLabelText("Why is this gap not for you?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the reason as the note so it becomes a standing decision the next scan reads", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<RecommendationTracker items={[item()]} report={report} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Recommendation status" }), {
      target: { value: "dismissed" },
    });
    fireEvent.change(screen.getByLabelText("Why is this gap not for you?"), {
      target: { value: "  We build with Bazel.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss with this reason" }));

    await screen.findByRole("combobox", { name: "Recommendation status" });
    expect(body(fetchMock)).toEqual({ status: "dismissed", note: "We build with Bazel." });
  });

  it("skipping the reason still dismisses, but sends NO note (silence is not suppression)", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<RecommendationTracker items={[item()]} report={report} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Recommendation status" }), {
      target: { value: "dismissed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss without a reason" }));

    await screen.findByRole("combobox", { name: "Recommendation status" });
    expect(body(fetchMock)).toEqual({ status: "dismissed" });
  });

  it("cancelling closes the prompt and sends nothing", () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<RecommendationTracker items={[item()]} report={report} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Recommendation status" }), {
      target: { value: "dismissed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Why is this gap not for you?")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a non-dismissed pick still saves straight away", () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<RecommendationTracker items={[item()]} report={report} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Recommendation status" }), {
      target: { value: "done" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Why is this gap not for you?")).not.toBeInTheDocument();
  });
});

// Direction 2: the reconciliation is surfaced WHERE the user marked the item done, not only in a
// compare view they may never open. "Not re-measured" must read as its own state.
describe("RecommendationTracker done reconciliation", () => {
  const reportWith = (scores: Record<string, number>) =>
    ({
      repo: { owner: "acme", name: "web" },
      dimensions: Object.entries(scores).map(([id, score]) => ({ id, score })),
    }) as unknown as ScanReport;

  it("shows the dimension's movement on the row the user marked done", () => {
    render(
      <RecommendationTracker
        items={[item({ status: "done" })]}
        report={reportWith({ D1: 62 })}
        prevDimScores={new Map([["D1", 55]])}
      />,
    );
    expect(screen.getByText(/D1 rose \+7 since the previous scan \(55 → 62\)/)).toBeInTheDocument();
  });

  it("says 'not re-measured' — never 'didn't move' — with no previous scan", () => {
    render(
      <RecommendationTracker items={[item({ status: "done" })]} report={reportWith({ D1: 62 })} prevDimScores={null} />,
    );
    expect(screen.getByText(/wasn’t scored in both scans/)).toBeInTheDocument();
    expect(screen.queryByText(/held at/)).not.toBeInTheDocument();
  });

  it("says 'held at' when both scans measured it and it did not move", () => {
    render(
      <RecommendationTracker
        items={[item({ status: "done" })]}
        report={reportWith({ D1: 62 })}
        prevDimScores={new Map([["D1", 62]])}
      />,
    );
    expect(screen.getByText(/D1 held at 62 since the previous scan/)).toBeInTheDocument();
  });

  it("says nothing at all on a row that is not done", () => {
    render(
      <RecommendationTracker
        items={[item({ status: "in_progress" })]}
        report={reportWith({ D1: 62 })}
        prevDimScores={new Map([["D1", 55]])}
      />,
    );
    expect(screen.queryByText(/You marked this done/)).not.toBeInTheDocument();
  });
});
