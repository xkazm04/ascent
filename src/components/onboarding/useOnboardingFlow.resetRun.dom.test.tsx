// @vitest-environment jsdom
//
// ambiguity-ui-scan-2026-07-16 first-run-onboarding-wizard #3: "Scan another" reset only the visible
// per-run state (repos/selected/rows/error/sourceInstallId) and leaked the money/checklist state —
// the pre-scan `credit` snapshot (which startScan prefers over a fresh read when the org matches),
// `creditReady`, preview flags, `invitedCount`, `creditSkipped` — into the second run. resetRun()
// must clear ALL of it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/org/credits")) {
        return { ok: true, json: async () => ({ balance: 12, unlimited: false, allowanceRemaining: 2 }) };
      }
      if (url.includes("/api/app/repos")) {
        return {
          ok: true,
          json: async () => ({
            repos: [{ fullName: "acme/web", private: true, language: "TS", stars: 3, pushedAt: null }],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
}

describe("useOnboardingFlow.resetRun — 'Scan another' clears the FULL per-run state", () => {
  it("clears the stale credit snapshot, invite count, and per-run flags along with the visible state", async () => {
    stubFetch();
    const { result } = renderHook(() => useOnboardingFlow());

    // App-path load settles the credit snapshot + repos (the state the old reset left behind).
    await act(async () => {
      await result.current.loadInstallationRepos("acme", "77");
    });
    await waitFor(() => expect(result.current.credit).not.toBeNull());
    expect(result.current.credit).toMatchObject({ org: "acme", balance: 12 });
    expect(result.current.sourceInstallId).toBe("77");
    expect(result.current.repos).toHaveLength(1);
    act(() => result.current.setInvitedCount(2)); // a first-run invite

    act(() => result.current.resetRun());

    expect(result.current.phase).toBe("pick");
    expect(result.current.repos).toEqual([]);
    expect(result.current.selected.size).toBe(0);
    expect(result.current.rows).toEqual({});
    expect(result.current.error).toBeNull();
    expect(result.current.sourceInstallId).toBeNull();
    // The previously-leaked state: a second run must not trust a pre-scan balance snapshot,
    // arrive with "Invite your team" pre-ticked, or inherit preview/skip flags.
    expect(result.current.credit).toBeNull();
    expect(result.current.invitedCount).toBe(0);
    expect(result.current.previewCause).toBeNull();
    expect(result.current.creditSkipped).toBe(0);
  });
});
