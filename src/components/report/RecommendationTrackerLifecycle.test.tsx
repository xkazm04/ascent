// @vitest-environment jsdom
//
// The recommendation LIFECYCLE surfaces inside the tracker, split out of RecommendationTracker.test
// so both files stay well under the repo's 300-LOC ceiling:
//   * Direction 1 — dismissing asks WHY, and the reason rides the PATCH's `note` so it becomes a
//     standing decision the next scan's prompt reads.
//   * Direction 2 — a done row shows whether its dimension actually moved, with "not re-measured"
//     as a state of its own.
//   * Direction 3 — the append-only event trail (sandbox notes, status flips) is fetched on expand
//     from GET /api/recommendations/:id/events. Loading, error, empty, and a truncated page are
//     four distinct states; an open trail refetches after a successful save.
// The payoff/meta chips and the orphan panel are stubbed so these target the tracker's own wiring.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PersistedRecommendation, ScanReport } from "@/lib/types";

vi.mock("@/components/report/OrphanedTracking", () => ({ OrphanedTracking: () => null }));
// PARTIAL — see the note in RecommendationTracker.test.tsx: the tracker's own chrome
// (TrackerProgress, RoadmapSortToggle) stays real; only the per-row chips are stubbed.
vi.mock("@/components/report/roadmapPieces", async (orig) => ({
  ...(await orig<typeof import("@/components/report/roadmapPieces")>()),
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

// Direction 3: the tracker writes the event trail (status, sandbox notes, dismissal reasons) and
// never rendered it. Follow-ups already show GET /events on expand; the report row that made the
// change did not. Fetch waits until open so a report does not fire one request per gap on load.
describe("RecommendationTracker event trail", () => {
  function stubEvents(payload: unknown, status = 200) {
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return new Response(JSON.stringify({ status: "done" }), { status: 200 });
      if (String(input).includes("/events")) return new Response(JSON.stringify(payload), { status });
      return new Response("nope", { status: 500 });
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  function openTrail() {
    fireEvent.click(screen.getByRole("button", { name: /Show activity for Add CI gate/ }));
  }

  it("does not fetch the trail until the row is opened", async () => {
    const fetchMock = stubEvents({ events: [], truncated: false, limit: 200 });
    render(<RecommendationTracker items={[item()]} report={report} />);
    expect(fetchMock).not.toHaveBeenCalled();
    openTrail();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/recommendations\/r1\/events$/);
  });

  it("renders who changed what, and the sandbox note the commit stamped", async () => {
    stubEvents({
      events: [
        {
          id: "e1",
          actor: "alice",
          kind: "status",
          from: "open",
          to: "in_progress",
          note: "Committed from sandbox simulation, projected +12 pts overall.",
          at: "2026-09-17T12:00:00.000Z",
        },
      ],
      truncated: false,
      limit: 200,
    });
    render(<RecommendationTracker items={[item()]} report={report} />);
    openTrail();
    expect(await screen.findByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("@alice").closest("li")?.textContent).toMatch(/Status Open → In progress/);
    expect(screen.getByText(/Committed from sandbox simulation, projected \+12 pts overall/)).toBeInTheDocument();
    expect(screen.queryByText(/most recent changes/)).not.toBeInTheDocument();
  });

  it("empty is not an error, and an error is never the empty copy", async () => {
    stubEvents({ events: [], truncated: false, limit: 200 });
    const { unmount } = render(<RecommendationTracker items={[item()]} report={report} />);
    openTrail();
    expect(await screen.findByText(/No changes recorded yet/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    stubEvents({ error: "nope" }, 500);
    render(<RecommendationTracker items={[item()]} report={report} />);
    openTrail();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn’t load history/);
    expect(screen.queryByText(/No changes recorded yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("a truncated page names the route's limit, not a client recount of the array", async () => {
    stubEvents({
      events: [{ id: "e1", actor: null, kind: "note", from: null, to: null, note: "kept", at: "2026-09-17T12:00:00.000Z" }],
      truncated: true,
      limit: 50,
    });
    render(<RecommendationTracker items={[item()]} report={report} />);
    openTrail();
    expect(await screen.findByText(/Showing the 50 most recent changes/)).toBeInTheDocument();
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByText(/noted/)).toBeInTheDocument();
  });

  it("an open trail refetches after a save so the new event is visible", async () => {
    let n = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return new Response(JSON.stringify({ status: "done" }), { status: 200 });
      n += 1;
      const events =
        n === 1
          ? []
          : [{ id: "e2", actor: "alice", kind: "status", from: "open", to: "done", note: null, at: "2026-09-18T00:00:00.000Z" }];
      return new Response(JSON.stringify({ events, truncated: false, limit: 200 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RecommendationTracker items={[item()]} report={report} />);
    openTrail();
    expect(await screen.findByText(/No changes recorded yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Recommendation status" }), { target: { value: "done" } });
    expect(await screen.findByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("@alice").closest("li")?.textContent).toMatch(/Status Open → Done/);
  });
});
