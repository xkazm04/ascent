// @vitest-environment jsdom
//
// The ?org= intent handoff. The connect page's "discovered from your GitHub" chips used to link at a bare
// /onboarding, dropping the org the user had just clicked and landing them on a blank "choose a source"
// step. The wizard now consumes ?org=<handle> on mount — but never at the expense of an in-progress
// resume snapshot, which is the more specific intent.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { RESUME_KEY } from "./OnboardingFlow.model";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/onboarding");
});

function stubRepoListing(seen: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/org/repos")) {
        seen.push(url);
        return {
          ok: true,
          json: async () => ({
            repos: [{ fullName: "x/one", private: false, language: "TS", stars: 5, pushedAt: "2026-07-01" }],
            truncated: true,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
}

describe("useOnboardingFlow — ?org= preselection handoff", () => {
  it("loads the linked org's repos and lands on the select step", async () => {
    const seen: string[] = [];
    stubRepoListing(seen);
    window.history.replaceState({}, "", "/onboarding?org=acme");

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.sourceLabel).toBe("acme"));
    expect(result.current.phase).toBe("select");
    expect(seen.some((u) => u.includes("org=acme"))).toBe(true);
    expect(result.current.repos).toHaveLength(1);
    // The listing's own truncation flag is now read, so the step can disclose a partial list.
    expect(result.current.listTruncated).toBe(true);
  });

  it("yields to an in-progress resume snapshot", async () => {
    const seen: string[] = [];
    stubRepoListing(seen);
    sessionStorage.setItem(
      RESUME_KEY,
      JSON.stringify({ org: "beta", sourceLabel: "beta", sourceInstallId: null, selected: [] }),
    );
    window.history.replaceState({}, "", "/onboarding?org=acme");

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.sourceLabel).toBe("beta"));
    expect(seen.some((u) => u.includes("org=acme"))).toBe(false);
  });
});
