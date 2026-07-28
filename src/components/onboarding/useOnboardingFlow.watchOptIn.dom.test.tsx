// @vitest-environment jsdom
//
// G1-10 (3/3), the wire: the select step's opt-in must reach the import POST. Before this, startScan
// omitted `watch` — runImportScan then defaulted it to Boolean(installationId) (true on every App-path
// run) and the SERVER defaults it to true as well, so "not opted in" has to travel as an explicit
// false, never as an omission. These pin both directions plus the per-run reset.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { getAutoWatchOptIn, resetAutoWatchOptIn, setAutoWatchOptIn } from "./OnboardingSelectStep.watchOptIn";

const REPOS = [{ fullName: "acme/api", private: true, language: "TS", stars: 5, pushedAt: null }];

let bodies: Record<string, unknown>[] = [];

beforeEach(() => {
  bodies = [];
  resetAutoWatchOptIn();
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/app/repos")) return { ok: true, json: async () => ({ repos: REPOS }) };
      if (url.includes("/api/org/credits"))
        return { ok: true, json: async () => ({ balance: 10, unlimited: false, allowanceRemaining: 0 }) };
      if (url.includes("/api/org/import")) {
        bodies.push(JSON.parse(String(init?.body)));
        // Fail the POST right after the body is captured — the assertion is about what was SENT.
        return { ok: false, status: 500, body: null, json: async () => ({ error: "stub" }) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAutoWatchOptIn();
});

async function loadAndScan(result: { current: ReturnType<typeof useOnboardingFlow> }) {
  await act(async () => {
    await result.current.loadInstallationRepos("acme", "42");
  });
  await waitFor(() => expect(result.current.repos).toHaveLength(1));
  await act(async () => {
    await result.current.startScan();
  });
}

describe("onboarding import — recurring autoscan enrolment is opt-in", () => {
  it("sends watch:false (and no schedule) when the user never ticked the box", async () => {
    const { result } = renderHook(() => useOnboardingFlow());
    await loadAndScan(result);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.watch).toBe(false);
    expect(bodies[0]!.schedule).toBeUndefined();
  });

  it("sends watch:true with the disclosed weekly cadence once the box is ticked", async () => {
    setAutoWatchOptIn(true);
    const { result } = renderHook(() => useOnboardingFlow());
    await loadAndScan(result);
    expect(bodies[0]!.watch).toBe(true);
    expect(bodies[0]!.schedule).toBe("weekly");
  });

  it("clears the opt-in on 'Scan another' so one run's consent can't leak into the next", async () => {
    setAutoWatchOptIn(true);
    const { result } = renderHook(() => useOnboardingFlow());
    act(() => result.current.resetRun());
    expect(getAutoWatchOptIn()).toBe(false);
  });
});
