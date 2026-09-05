// @vitest-environment jsdom
//
// Direction 1 — the public-preview funnel must survive the auth wall. On a Supabase-configured
// deploy the advertised free org preview dead-ended at its FINAL click: /api/org/import runs
// requireOrgAccess BEFORE reading `mock`, so an anonymous scan gets a 401 and the wizard rendered the
// raw server string with zero sign-in affordance. This pins 401 → gate → (sign-in round-trip) → resume.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { RESUME_KEY } from "./OnboardingFlow.model";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const REPOS = [
  { fullName: "vercel/next.js", private: false, language: "TS", stars: 100, pushedAt: null },
  { fullName: "vercel/turbo", private: false, language: "Rust", stars: 50, pushedAt: null },
];

/** Public-handle listing succeeds; the import POST is refused by the auth wall with `status`. */
function stubFetch(importStatus: number, importError: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/org/repos")) return { ok: true, json: async () => ({ repos: REPOS }) };
      if (url.includes("/api/org/import")) {
        return { ok: false, status: importStatus, body: null, json: async () => ({ error: importError }) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
}

describe("useOnboardingFlow — the import auth wall becomes a gate, not a raw string", () => {
  it("turns a 401 into the sign-in gate, keeps the selection, and never surfaces the API string", async () => {
    stubFetch(401, "Sign in to manage this organization.");
    const { result, unmount } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.loadRepos(undefined, "vercel");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(2));
    expect(result.current.selected.size).toBe(2);

    await act(async () => {
      await result.current.startScan();
    });

    expect(result.current.gate).toEqual({ kind: "signin", org: "vercel" });
    // The raw API string must NOT be the thing the user reads.
    expect(result.current.error).toBeNull();
    // The selection survives behind the gate — "Back to repositories" returns to it untouched.
    expect(result.current.phase).toBe("select");
    expect([...result.current.selected].sort()).toEqual(["vercel/next.js", "vercel/turbo"]);

    // …and the resume snapshot is on disk, so the sign-in round-trip back to /onboarding rehydrates.
    const snap = JSON.parse(sessionStorage.getItem(RESUME_KEY)!);
    expect(snap.sourceLabel).toBe("vercel");
    expect(snap.selected.sort()).toEqual(["vercel/next.js", "vercel/turbo"]);

    // The user signs in and lands back on /onboarding: a fresh mount rebuilds the select step.
    unmount();
    const second = renderHook(() => useOnboardingFlow());
    await waitFor(() => expect(second.result.current.repos).toHaveLength(2));
    expect(second.result.current.phase).toBe("select");
    expect([...second.result.current.selected].sort()).toEqual(["vercel/next.js", "vercel/turbo"]);
    expect(second.result.current.gate).toBeNull();
  });

  it("turns a 403 into the no-access gate", async () => {
    stubFetch(403, "You don't have access to this organization.");
    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await result.current.loadRepos(undefined, "netflix");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(2));
    await act(async () => {
      await result.current.startScan();
    });
    expect(result.current.gate).toEqual({ kind: "no-access", org: "netflix" });
    expect(result.current.error).toBeNull();
  });

  it("still surfaces a GENUINE failure's server message (no gate)", async () => {
    stubFetch(500, "Import failed (500).");
    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await result.current.loadRepos(undefined, "vercel");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(2));
    await act(async () => {
      await result.current.startScan();
    });
    expect(result.current.gate).toBeNull();
    expect(result.current.error).toBe("Import failed (500).");
  });
});
