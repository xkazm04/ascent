// @vitest-environment jsdom
//
// The commit bar writes ONCE (roadmap-1). It used to fire one PATCH per rec through a status-only
// path that wrote no claim column, then report a count; now it POSTs the batch to the hand-off door
// (claimFollowups), previews the extent before it writes, and reports per row after.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LlmRoadmapItem, PersistedRecommendation } from "@/lib/types";
import { SandboxCommitBar } from "./RoadmapSandboxCommit";

function rec(id: string, dimension: string, title: string, over: Partial<PersistedRecommendation> = {}) {
  return {
    id,
    title,
    dimension,
    impact: "high",
    effort: "low",
    rationale: "",
    explore: [],
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    ...over,
  } as PersistedRecommendation;
}

const roadmap = [
  { dimension: "D1", title: "One" },
  { dimension: "D2", title: "Two" },
  { dimension: "D3", title: "Three" },
  { dimension: "D4", title: "Four" },
] as unknown as LlmRoadmapItem[];
const recs = [
  rec("A", "D1", "One"),
  rec("B", "D2", "Two"),
  rec("C", "D3", "Three"),
  rec("D", "D4", "Four", { status: "in_progress", assigneeLogin: "ana" }),
];

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderBar(onCommitted = vi.fn()) {
  render(
    <SandboxCommitBar
      roadmap={roadmap}
      recs={recs}
      appliedItems={new Set([0, 1, 2, 3])}
      projectedDelta={4.4}
      onRecommendationCommitted={onCommitted}
    />,
  );
  return onCommitted;
}

describe("SandboxCommitBar: one POST, per-item outcomes", () => {
  it("previews what it will start and what it skips (with the holder) before writing", () => {
    renderBar();
    expect(screen.getByText(/Start 3 · 1 already on the tracker \(1 in progress\)/)).toBeTruthy();
    expect(screen.getByText(/@ana/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("commits 3 startable recs with exactly ONE fetch to the hand-off door and zero PATCHes", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ marked: ["A", "C"], skipped: [{ id: "B", reason: "held" }] }, { status: 200 }),
    );
    const onCommitted = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Commit 3 to tracker/ }));
    await waitFor(() => expect(screen.getByText(/2 of 3 recommendations marked in progress/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/org/followups/handoff");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ ids: ["A", "B", "C"], origin: "sandbox", projectedDelta: 4.4 });
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(false);
    expect(onCommitted.mock.calls.map(([r]) => r.id)).toEqual(["A", "C"]);
    expect(onCommitted.mock.calls[0]![0].status).toBe("in_progress");
    expect(screen.getAllByText(/^tracked$/)).toHaveLength(2);
    expect(screen.getByText(/^held by someone else$/)).toBeTruthy();
  });

  it("a 403 lands in the blocked state with no per-item rows", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    const onCommitted = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Commit 3 to tracker/ }));
    await waitFor(() => expect(screen.getByText(/read-only public report/)).toBeTruthy());
    expect(screen.queryByText(/^tracked$/)).toBeNull();
    expect(screen.queryByText(/^failed$/)).toBeNull();
    expect(onCommitted).not.toHaveBeenCalled();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a network failure names every started row as failed", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Commit 3 to tracker/ }));
    await waitFor(() => expect(screen.getAllByText(/^failed$/)).toHaveLength(3));
  });
});
