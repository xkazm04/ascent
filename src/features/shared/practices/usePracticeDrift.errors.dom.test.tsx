// @vitest-environment jsdom
//
// The adoption-ledger rollout reads its two practice-route answers through readApiResponse (council r2
// robustness-5): a non-JSON error body becomes the hook's own copy, a server error keeps its text.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { usePracticeDrift } from "./usePracticeDrift";
import type { AdoptionTile } from "./practiceAdoptionRows";
import type { PracticeAdoptionSummary } from "@/lib/db/practice-adoption";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const summary = { adoptedRepos: 1, behindRepos: 1, driftedRepos: 0, widestGap: null, perPractice: {}, total: 1 } as unknown as PracticeAdoptionSummary;
const tile = { bucket: "behind", rollout: { practiceId: "ci-gates", mode: "behind" } } as unknown as AdoptionTile;
const timeoutPage = {
  ok: false,
  status: 504,
  json: async () => {
    throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
  },
};

describe("usePracticeDrift: errors", () => {
  it("a non-JSON 504 on the target-set read is the hook's copy, not a SyntaxError", async () => {
    fetchMock.mockResolvedValue(timeoutPage);
    const { result } = renderHook(() => usePracticeDrift("acme", summary));
    await act(() => result.current.openConfirm(tile));
    expect(result.current.error).toBe("Could not read the rollout target set.");
    expect(result.current.confirming).toBeNull();
  });

  it("the rollout POST keeps the server's error, and a non-JSON body falls back", async () => {
    const { result } = renderHook(() => usePracticeDrift("acme", summary));
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: "Failed to mint an installation token for this org." }) });
    await act(() => result.current.rollOut(tile));
    expect(result.current.error).toBe("Failed to mint an installation token for this org.");
    fetchMock.mockResolvedValue(timeoutPage);
    await act(() => result.current.rollOut(tile));
    expect(result.current.error).toBe("Failed to open the rollout PRs.");
  });
});
