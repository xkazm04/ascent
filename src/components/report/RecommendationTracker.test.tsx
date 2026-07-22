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
  });

  it("#4: wraps a long recommendation title (min-w-0 + break-words), never overflowing the row", () => {
    const long = "R".repeat(200);
    render(<RecommendationTracker items={[item({ title: long })]} report={report} />);
    const h3 = screen.getByRole("heading", { level: 3, name: long });
    expect(h3).toHaveClass("min-w-0");
    expect(h3).toHaveClass("break-words");
  });
});
