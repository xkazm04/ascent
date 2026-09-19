// D11: what a reconcile tick reports, and how many queries it costs.
//
// The tick used to say only what it wrote and considered, so an org whose tail it could not reach read
// exactly like an org that had none. It now carries `remaining`/`truncated` up from the candidate
// read, so the caller — and the docs — can state coverage instead of implying completeness.
//
// And the writes: a 50-candidate tick issued one `scan.findFirst` per candidate plus TWO
// `scan.findUnique` reads inside the per-pair writer, ~150 sequential round trips. Every measurable
// pair now goes to the batch writer in ONE call.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockList, mockRecordPairs } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockRecordPairs: vi.fn(),
}));

vi.mock("@/lib/db/outcomes", () => ({
  RECONCILE_MAX: 50,
  listDoneRecCandidates: mockList,
  recordOutcomesForScanPairs: mockRecordPairs,
}));

import { reconcileRecommendationOutcomes } from "./reconcile-recs";

function candidate(i: number, over: Record<string, unknown> = {}) {
  return {
    recommendationId: `r${i}`,
    repoFullName: "acme/web",
    dimId: "D2",
    title: `gap ${i}`,
    doneAt: new Date("2026-06-01T00:00:00Z"),
    beforeScanId: `before_${i}`,
    beforeDimScore: 40,
    afterScanId: `after_${i}`,
    afterDimScore: 51,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRecordPairs.mockImplementation(async (pairs: unknown[]) => pairs.map(() => true));
});

describe("reconcileRecommendationOutcomes — one batched write per tick", () => {
  it("hands every measurable pair to the batch writer in a single call", async () => {
    const candidates = Array.from({ length: 50 }, (_, i) => candidate(i));
    mockList.mockResolvedValue({ candidates, remaining: 12, truncated: false });

    const result = await reconcileRecommendationOutcomes("org_1");

    expect(mockRecordPairs).toHaveBeenCalledTimes(1);
    expect(mockRecordPairs.mock.calls[0]![0]).toHaveLength(50);
    expect(result).toEqual({ written: 50, considered: 50, unmeasured: 0, remaining: 12, truncated: false });
  });

  it("reports the coverage it did NOT reach, rather than implying it saw every close", async () => {
    mockList.mockResolvedValue({ candidates: [candidate(1)], remaining: 200, truncated: true });
    const result = await reconcileRecommendationOutcomes("org_1");
    expect(result.remaining).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it("keeps the unmeasured refusals out of the writer entirely", async () => {
    mockList.mockResolvedValue({
      candidates: [
        candidate(1),
        candidate(2, { afterScanId: null }), // no rescan yet
        candidate(3, { beforeDimScore: null }), // dimension absent on a bookend ⇒ not-measured
      ],
      remaining: 0,
      truncated: false,
    });
    const result = await reconcileRecommendationOutcomes("org_1");
    expect(mockRecordPairs.mock.calls[0]![0]).toHaveLength(1);
    expect(result).toMatchObject({ written: 1, considered: 3, unmeasured: 2 });
  });

  it("counts a writer refusal (the instrument disagreed) as unmeasured, never as written", async () => {
    mockList.mockResolvedValue({ candidates: [candidate(1), candidate(2)], remaining: 0, truncated: false });
    mockRecordPairs.mockResolvedValue([true, false]);
    const result = await reconcileRecommendationOutcomes("org_1");
    expect(result).toMatchObject({ written: 1, unmeasured: 1, considered: 2 });
  });

  it("never throws into the loop that verifies PRs", async () => {
    mockList.mockRejectedValue(new Error("db gone"));
    expect(await reconcileRecommendationOutcomes("org_1")).toEqual({
      written: 0,
      considered: 0,
      unmeasured: 0,
      remaining: 0,
      truncated: false,
    });
  });
});
