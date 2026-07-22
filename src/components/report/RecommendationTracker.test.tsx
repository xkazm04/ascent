// @vitest-environment jsdom
//
// Pins roadmap-recommendation-tracking #2: the status <select> must NOT be `disabled` while a save is
// in flight — disabling the focused control blurs it, dropping keyboard/SR focus to <body> on every
// save. It is marked `aria-busy` instead, and setStatus no-ops an overlapping change, so focus stays on
// the control the user is operating. The payoff/meta chips are stubbed so this test targets the
// tracker's own save/focus wiring (not the scoring engine those chips pull in).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PersistedRecommendation, ScanReport } from "@/lib/types";

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

describe("RecommendationTracker status <select> (roadmap #2)", () => {
  it("stays focusable — aria-busy, never disabled — while a save is in flight, so focus is not dropped", () => {
    // A never-resolving fetch keeps `saving` true for the assertion window.
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<RecommendationTracker items={[item()]} report={report} />);
    const select = screen.getByRole("combobox", { name: "Recommendation status" }) as HTMLSelectElement;
    select.focus();
    expect(document.activeElement).toBe(select);

    fireEvent.change(select, { target: { value: "done" } });

    // Save is now in flight:
    expect(select).not.toBeDisabled();
    expect(select).toHaveAttribute("aria-busy", "true");
    expect(document.activeElement).toBe(select); // focus preserved, not thrown to <body>
  });

  it("ignores an overlapping change on the same row while a save is in flight (re-entrancy guard)", () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<RecommendationTracker items={[item()]} report={report} />);
    const select = screen.getByRole("combobox", { name: "Recommendation status" }) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "done" } });
    fireEvent.change(select, { target: { value: "dismissed" } });

    // The second change is a no-op while the first is still saving — only one PATCH went out.
    const patchCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PATCH");
    expect(patchCalls).toHaveLength(1);

    // …but the swallow must not be SILENT (07-16 #4): the controlled select snaps back to the
    // in-flight value with no visual cue, so the row's live region has to explain the drop.
    const statuses = screen.getAllByRole("status").map((el) => el.textContent);
    expect(statuses.some((t) => /still saving the previous change/i.test(t ?? ""))).toBe(true);
  });

  // Pins ambiguity-ui-scan-2026-07-16 roadmap-recommendation-tracking #2: the persisted tracker must
  // keep the public roadmap's prioritization — quick-wins-first ordering (impact desc, effort asc),
  // 1..N numbering, and the "⚡ Quick win" badge — instead of rendering raw createdAt order.
  it("orders rows quick-wins-first with numbering and a quick-win badge (parity with RoadmapSteps)", () => {
    const rows = [
      item({ id: "a", title: "Slog", impact: "low", effort: "high" }),
      item({ id: "b", title: "Medium lift", impact: "medium", effort: "medium" }),
      item({ id: "c", title: "Quick win", impact: "high", effort: "low" }),
    ];
    render(<RecommendationTracker items={rows} report={report} />);

    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Quick win", "Medium lift", "Slog"]); // NOT the incoming createdAt order
    expect(screen.getByText(/quick win/i, { selector: "span" })).toBeInTheDocument(); // ⚡ badge
    expect(screen.getByText("1")).toBeInTheDocument(); // priority numbering survives persistence
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  // Pins ambiguity-ui-scan-2026-07-16 roadmap-recommendation-tracking #3: after a 409, the recovery
  // refetch hits the LIST endpoint, which serves the repo's LATEST scan. When this page's scan has
  // been superseded, the conflicted row's id is absent from the response — the old code silently kept
  // the rolled-back value under a "Retry to reapply" message whose Retry 409s forever. It must instead
  // show a NON-retryable "reload the page" error.
  it("#3 (07-16): 409 whose refetch misses the row shows a non-retryable reload error, not a Retry loop", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(new Response(JSON.stringify({ error: "conflict" }), { status: 409 }));
      }
      // The list refetch returns a NEWER scan's recommendations — this row's id is gone.
      return Promise.resolve(new Response(JSON.stringify({ items: [item({ id: "newer-scan-row" })] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RecommendationTracker items={[item()]} report={report} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Recommendation status" }), { target: { value: "done" } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/newer scan.*reload the page/i);
    // Retrying would deterministically 409 again — the error must NOT offer Retry, only Dismiss.
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("#3 (07-16): 409 whose refetch FINDS the row keeps the retryable rebase flow (Retry offered)", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(new Response(JSON.stringify({ error: "conflict" }), { status: 409 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ items: [item({ status: "in_progress" as PersistedRecommendation["status"] })] }), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RecommendationTracker items={[item()]} report={report} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Recommendation status" }), { target: { value: "done" } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/changed elsewhere.*Retry/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  // Pins ambiguity-ui-scan-2026-07-16 roadmap-recommendation-tracking #5: an all-dismissed backlog
  // used to hit the zero-denominator 100 fallback and show "0 of 0 done" beside a full green 100%
  // bar. It must read as a neutral "all dismissed" state instead of triumphant success.
  it("#5 (07-16): all-dismissed backlog renders a neutral state, not '0 of 0 done' at 100%", () => {
    const rows = [item({ id: "a", status: "dismissed" }), item({ id: "b", status: "dismissed" })];
    render(<RecommendationTracker items={rows} report={report} />);

    expect(screen.getByText(/All 2 recommendations dismissed/)).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 of 0 done/)).not.toBeInTheDocument();
  });

  it("#5 (07-16): a mixed backlog keeps the normal done/actionable header and percentage", () => {
    const rows = [item({ id: "a", status: "done" }), item({ id: "b", status: "dismissed" }), item({ id: "c" })];
    render(<RecommendationTracker items={rows} report={report} />);
    expect(screen.getByText(/1 of 2 done/)).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("#4: wraps a long recommendation title (min-w-0 + break-words), never overflowing the row", () => {
    const long = "R".repeat(200);
    render(<RecommendationTracker items={[item({ title: long })]} report={report} />);
    const h3 = screen.getByRole("heading", { level: 3, name: long });
    expect(h3).toHaveClass("min-w-0");
    expect(h3).toHaveClass("break-words");
  });
});
